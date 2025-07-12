//imort modules, declare variables
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, screen } = require('electron');
if (require('electron-squirrel-startup')) {
  app.quit();
}

const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

let mainWindow, overlayWindow, tray, watcher, resizeTimeout;
let fileContentChanges = [];
let config = {
  watchPath: '',
  overlayOn: false,
  overlaySize: [],
  overlayPosition: [],
  cullRate: 60,
  maxLength: 10,
};
let isResizable = false;
let ignoringMouseEvents = true;
let objectCatalog = {}
let showIds = false;
let initialWidth, initialHeight, initialX, initialY;

// load names of weapons and zones from objectcatalog.json
try {
  const catalogPath = path.join(__dirname, 'objectcatalog.json');
  const data = fs.readFileSync(catalogPath, 'utf-8');
  objectCatalog = JSON.parse(data);
} catch (error) {
  console.error('Error loading object catalog:', error);
  objectCatalog = {
    'weapon': {},
    'damageType': {},
    'zone': {}
  };
}

// create main window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 530,
    height: 630,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  // mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.loadFile('main.html');
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    app.quit();
  });
}


// function to set initial positions and sizes of the overlay window
function setOverlayWindowProperties() {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;

  const defaultOverlayWidth = Math.round(screenWidth / 8);
  const defaultOverlayHeight = Math.round(screenHeight / 8);

  const defaultOverlayX = Math.round((screenWidth - defaultOverlayWidth) / 2);
  const defaultOverlayY = Math.round((screenHeight - defaultOverlayHeight) / 2);

  initialX = config.overlayPosition && config.overlayPosition[0] !== undefined ? config.overlayPosition[0] : defaultOverlayX;
  initialY = config.overlayPosition && config.overlayPosition[1] !== undefined ? config.overlayPosition[1] : defaultOverlayY;

  initialWidth = config.overlaySize && config.overlaySize[0] !== undefined ? config.overlaySize[0] : defaultOverlayWidth;
  initialHeight = config.overlaySize && config.overlaySize[1] !== undefined ? config.overlaySize[1] : defaultOverlayHeight;

  if (overlayWindow) {
    overlayWindow.setResizable(isResizable);
    overlayWindow.setIgnoreMouseEvents(ignoringMouseEvents);
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setPosition(initialX, initialY);
    overlayWindow.setSize(initialWidth, initialHeight);
    overlayWindow.webContents.send('send-overlay-settings', {
      cullRate: config.cullRate,
      maxLength: config.maxLength
    });
  }
}

function createOverlayWindow() {
  setOverlayWindowProperties();
  overlayWindow = new BrowserWindow({
    // setting initial vales even though is in setOverlayWindowProperties because overlaywindow doesnt exist when setoverlayWindowProperties is called because
    // setoverlayWindowProperties needs to be called before the overlay window is created so that the initial positions are calculated and applied during the creation of the overlay window
    frame: false,
    transparent: true,
    skipTaskbar: true,
    width: initialWidth,
    height: initialHeight,
    x: initialX,
    y: initialY,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    }
  });

  // overlayWindow.webContents.openDevTools({ mode: 'detach' });

  overlayWindow.loadFile('overlay.html');

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  overlayWindow.on('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const [w, h] = overlayWindow.getSize();
      config.overlaySize = [w, h];
      config.overlayPosition = overlayWindow.getPosition();
      saveConfig();
    }, 500);
  });

  overlayWindow.show();  
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('send-overlay-settings', {
      cullRate: config.cullRate,
      maxLength: config.maxLength,
    });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(ignoringMouseEvents);
  }
} //end createOverlayWindow

// create tray icon and menu
function createTray() {
  tray = new Tray(path.join(__dirname, 'contrast.ico'));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        }
      }
    },
    {
      label: 'Show Overlay',
      click: () => {
        if (overlayWindow) {
          overlayWindow.show();
        } else {
          createOverlayWindow();
        }
      }
    },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip('Overlay App');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });
}

// load config from file
function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
      const loadedConfig = JSON.parse(fs.readFileSync(configPath));
       config = { ...config, ...loadedConfig };
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  startFileWatcher();
}

// save config to file
function saveConfig() {
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
}

// format actor death event from log line
function parseAndFormatActorDeath(line) {
  const regex = /<([^>]+)>.*<Actor Death> CActor::Kill: '([^']*)' \[(\d*)\] in zone '([^']*)' killed by '([^']*)' \[(\d*)\] using '([^']*)' \[Class ([^\]]*)\] with damage type '([^']*)'/;
  const match = line.match(regex);
  if (!match) return null;
  const [_, timestamp, victim, victimId, zone, killer, killerId, weapon, weaponClass, damageType] = match;
  const safeVal = (val, fallback = 'unknown') => (val && val.trim()) ? val : fallback;

  let cleanWeapon = weaponClass;
  if (cleanWeapon == 'unknown' || cleanWeapon == '') {
    cleanWeapon = weapon.replace(/_[0-9]+$/, '').replace(/(_\d+)(_.*)?$/, '$1');
  } else {
    cleanWeapon = weaponClass.replace(/(_\d+)(_.*)?$/, '$1');
  }
  cleanWeapon = objectCatalog.weapon[cleanWeapon] || cleanWeapon;

  let cleanZone = zone.replace(/_\d+$/, '').replace(/_BIS\d+$/, '').replace(/_Exec.*/, '');
  // look for zone in objectcatalog first because some solar systems just are named like 'solarsystem_13579' and the numbers are cleaned with cleanzone
  cleanZone = objectCatalog.zone[zone] || objectCatalog.zone[cleanZone] || cleanZone.replace(/^([a-z][^_]*)_/, '').replace(/_/g, " ");

  let parsedKiller;
  if (killer.length > 20 && /^PU_[a-zA-Z]{4,}.*_\d{13}$/.test(killer)) {
    parsedKiller = 'NPC'
  } else if (/^[a-zA-Z]{4,}(?:_[a-zA-Z]{4,})*_\d{13}$/.test(killer)) {
    parsedKiller = killer.replace(/_\d{13}$/, '')
  } else{
    parsedKiller = `${killer} ${showIds? `(ID: ${killerId})` : ''}`
  }

  let cleanDamageType = objectCatalog.damage[damageType] || damageType;

    let body = `💀 Killed by: ${safeVal(parsedKiller)}\n` +
    `🔫 Using: ${safeVal(cleanWeapon)}\n` +
    `💥 Damage: ${safeVal(cleanDamageType)}\n` +
    `📍 Location: ${safeVal(cleanZone)}\n`;

    let time = `${new Date(safeVal(timestamp, Date.now())).toLocaleString()}\n`;

    let toReturn = '';

    // test for regular npc (name longer than 20 char, starts with pu_ followed by 4 or more latin letters, followed by anthing, followed by _ followed by 13 numbers)
    if (victim.length > 20 && /^PU_[a-zA-Z]{4,}.*_\d{13}$/.test(victim)) {
      // is regular npc, if was killed in a vehicle explosion (pilot npc), put npc for the victim and follow up with all the details
        if (damageType === "VehicleDestruction") {
            toReturn = `${time}🪦 NPC\n${body}`;
        } else {
          // regular, not pilot npc (same logic for killer ^^)
          toReturn = `${time}🪦 NPC`
        }
    }
    // if not a regular npc, check for animal (letters in groups of 4 or more, separated by underscores, followed by _ followed by 13 numbers)
    else if (/^[a-zA-Z]{4,}(?:_[a-zA-Z]{4,})*_\d{13}$/.test(victim)){
        toReturn = `${time}🪦 ${victim.replace(/_\d{13}$/, '').replace(/_/g, ' ')}`;
    }
    // not regular npc or animal (player)
    else {
      toReturn = `${time}🪦 ${safeVal(victim)} ${showIds ? `(ID: ${safeVal(victimId)})` : ''}\n${body}`;
    }
    return toReturn;
}

// start file watcher for log events
function startFileWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (!config.watchPath || !fs.existsSync(config.watchPath)) {
    console.log('No valid watch path configured or file does not exist.');
    return;
  }
  watcher = chokidar.watch(config.watchPath, {
    persistent: true,
    ignoreInitial: false,
    usePolling: true,
    interval: 1000,
    binaryInterval: 1000
  });
  let lastActorDeathLine = null;
  try {
    const fileContent = fs.readFileSync(config.watchPath, 'utf-8');
    const lines = fileContent.split(/\r?\n/).filter(l => l.includes('<Actor Death>'));
    if (lines.length > 0) {
      lastActorDeathLine = lines[lines.length - 1];
    }
  } catch (err) {
    console.error('[main.js] Error reading initial file content:', err);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('file-content-update', [{ id: Date.now(), content: `Error: Could not read file content: ${err.message}` }]);
    }
  }
  watcher.on('change', (filePath) => {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const lines = fileContent.split(/\r?\n/).filter(l => l.includes('<Actor Death>'));
      if (lines.length === 0) return;
      const currentLastLine = lines[lines.length - 1];
      if (currentLastLine === lastActorDeathLine) return;
      lastActorDeathLine = currentLastLine;
      let formatted = parseAndFormatActorDeath(currentLastLine) || currentLastLine;
      const newEvent = { id: Date.now() + Math.random(), content: formatted };
      fileContentChanges.push(newEvent);
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('file-content-update', [newEvent]);
      }
    } catch (err) {
      console.error('[main.js] Error reading file (change event):', err);
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('file-content-update', [{ id: Date.now(), content: `Error reading file: ${err.message}` }]);
      }
    }
  });
  watcher.on('error', (error) => {
    console.error(`Watcher error: ${error}`);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('file-content-update', [{ id: Date.now(), content: `File watcher error: ${error.message}` }]);
    }
  });
}

// handle file selection from renderer process
ipcMain.handle('select-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      config.watchPath = result.filePaths[0];
      saveConfig();
      startFileWatcher();
      return config.watchPath;
    }
    return null;
  } catch (error) {
    console.error('Error selecting file:', error);
    dialog.showErrorBox('File Selection Error', `Failed to select file: ${error.message}`);
    return null;
  }
});

// recieves messages from renderer process using on from preload
ipcMain.on('toggle-resizable', (event, value) => {
  ignoringMouseEvents = !value;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setResizable(value);
    overlayWindow.setIgnoreMouseEvents(!value);
    overlayWindow.webContents.send('toggle-resize-border', value);
  }
});

// processes overlay on event sent from main renderer process
ipcMain.on('overlay-on', (event, value) => {
  if (value) {
    if (!overlayWindow) {
      createOverlayWindow();
      config.overlayOn = true;
      saveConfig();
    }
    else if (overlayWindow && !overlayWindow.isDestroyed()) {
      setOverlayWindowProperties();
      overlayWindow.show();
      config.overlayOn = true;
      saveConfig();
      // overlayWindow.focus();
    }
  }
  else {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
      overlayWindow = null;
      config.overlayOn = false;
      saveConfig();
    }
  }
});

//show player ids
ipcMain.on('toggle-ids', (event, value) => {
  showIds = value;
});

// relays the overlay show border event from main renderer process to the overlay renderer process
ipcMain.on('overlay-show-border', (event, value) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('make-show-border', value);
  }
});

// drag overlay enable / disable relay
ipcMain.on('recieve-drag-overlay', (event, value) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    ignoringMouseEvents = !value;
    overlayWindow.setIgnoreMouseEvents(!value);
    overlayWindow.webContents.send('toggle-drag-overlay', value);
    overlayWindow.webContents.send('make-show-border', value);
  }
});

// listen for drag move events from overlay renderer
ipcMain.on('recieve-mouse-pos', (event, newX, newY) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setSize(initialWidth, initialHeight); // overlay window randomly resizes itself without this. temp fix. any value here works
    overlayWindow.setPosition(Math.round(newX), Math.round(newY));
  }
});

ipcMain.on('overlay-drag-end', (event, finalX, finalY) => {
  config.overlayPosition = [Math.round(finalX), Math.round(finalY)];
  saveConfig();
});

ipcMain.handle('get-overlay-position', (event) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow.getPosition();
  }
});

// the function invoked by the main renderer process through the context bridge to get the overlay history
ipcMain.handle('get-overlay-history', async () => {
  return Array.isArray(fileContentChanges) ? [...fileContentChanges] : [];
});

// relays scroll overlay events from the main renderer process to the overlay renderer process
ipcMain.on('scroll-overlay', (event, direction) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('make-scroll-overlay', direction);
  }
});

// handle update overlay cull rate settings from main renderer process
// can be either cullrate *or* maxlength so check which one is recieved 
ipcMain.on('update-overlay-settings', (event, settings) => {
  let updated = false;
  if (settings.cullRate !== undefined && typeof settings.cullRate === 'number' && (settings.cullRate >= 1 || settings.cullRate == -1)) {
    config.cullRate = settings.cullRate;
    updated = true;
  }
  if (settings.maxLength !== undefined && typeof settings.maxLength === 'number' && (settings.maxLength >= 1 || settings.maxLength == -1)) {
    config.maxLength = settings.maxLength;
    updated = true;
  }
  if (updated) {
    saveConfig();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('send-overlay-settings', {
        cullRate: config.cullRate,
        maxLength: config.maxLength
      });
    }
  }
});

ipcMain.handle('get-overlay-settings', async () => {
  return {
    cullRate: config.cullRate,
    maxLength: config.maxLength
  };
});

// activate all the stuff when the app is ready
app.whenReady().then(() => {
  loadConfig();
  createMainWindow();
  createTray();
  if (config.overlayOn) {
    createOverlayWindow();
    mainWindow.webContents.send('make-on-box-checked', true);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createTray();
    }
  });
});

// quit the app when all windows are closed, except on mac where it's common to keep the app running (this code should never be reached since the overlay has no close button)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!app.isQuitting) {
      return;
    }
    app.quit();
  }
});