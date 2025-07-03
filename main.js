//imort modules, declare variables
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, screen } = require('electron');
if (require('electron-squirrel-startup')) {
  app.quit();
}

const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { strictEqual } = require('assert');

let mainWindow, overlayWindow, tray, watcher, parsedKiller;
let fileContentChanges = [];
let config = {
  watchPath: '',
  overlayPositionPercent: { x: 50, y: 50 },
  overlaySize: { width: 300, height: 200 }
};
let overlayOn = false;
let isResizable = false;
let showBorder = false;
let objectCatalog = {}
let showIds = false;

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

// get overlay position in pixels from percent
function getOverlayPixelPosition(xPercent, yPercent, overlayWidth = 300, overlayHeight = 200) {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workArea;
  const centerX = Math.round((xPercent / 100) * width);
  const centerY = Math.round((yPercent / 100) * height);
  const x = centerX - Math.round(overlayWidth / 2);
  const y = centerY - Math.round(overlayHeight / 2);
  return { x, y };
}

// create main window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 510,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  mainWindow.loadFile('main.html');
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => {
    app.quit();
  });
}

// Sets common properties for the overlay window
function setOverlayWindowProperties() {
  if (overlayWindow) {
    overlayWindow.setResizable(isResizable);
    overlayWindow.setIgnoreMouseEvents(!isResizable);
    overlayWindow.webContents.send('toggle-resize-border', isResizable);
    overlayWindow.webContents.send('make-show-border', showBorder);
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  }
}

// create overlay window
function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    width: config.overlaySize.width,
    height: config.overlaySize.height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    }
  });
  overlayWindow.loadFile('overlay.html');
  const { x, y } = getOverlayPixelPosition(config.overlayPositionPercent.x, config.overlayPositionPercent.y, config.overlaySize.width, config.overlaySize.height);
  overlayWindow.setPosition(x, y);
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
  overlayWindow.on('resize', () => {
    const [w, h] = overlayWindow.getSize();
    config.overlaySize = { width: w, height: h };
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    saveConfig();
  });
  setOverlayWindowProperties(); 
  overlayWindow.show();
  overlayWindow.focus();
}

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
          overlayWindow.focus();
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
      config = { ...config, ...loadedConfig }; // Merge loaded config with defaults
    }
  } catch (error) {
    console.error('Error loading config:', error);
  } finally {
    // Ensure all config properties have valid defaults if not loaded
    config.watchPath = config.watchPath || '';
    config.overlayPositionPercent = config.overlayPositionPercent || { x: 50, y: 50 };
    config.overlaySize = config.overlaySize || { width: 300, height: 200 };
    if (typeof config.overlayPositionPercent.x !== 'number') config.overlayPositionPercent.x = 50;
    if (typeof config.overlayPositionPercent.y !== 'number') config.overlayPositionPercent.y = 50;
    if (typeof config.overlaySize.width !== 'number') config.overlaySize.width = 300;
    if (typeof config.overlaySize.height !== 'number') config.overlaySize.height = 200;
  }
  startFileWatcher();
}

// save config to file
function saveConfig() {
  const { overlayOn, showBorder, isResizable, showIds,  ...toSave } = config; 
  const configPath = path.join(__dirname, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2)); 
}

// format actor death event from log line
function parseAndFormatActorDeath(line) {
  const regex = /<([^>]+)> \[([^\]]+)\] <Actor Death> CActor::Kill: '([^']*)' \[(\d*)\] in zone '([^']*)' killed by '([^']*)' \[(\d*)\] using '([^']*)' \[Class ([^\]]*)\] with damage type '([^']*)' from direction x: ([^,]*), y: ([^,]*), z: ([^ ]*) \[([^\]]*)\]\[([^\]]*)\]/;
  const match = line.match(regex);
  if (!match) return null;
  const [_, timestamp, eventtype, victim, victimId, zone, killer, killerId, weapon, weaponClass, damageType, x, y, z, team, actor] = match;
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
    `📍 Location: ${safeVal(cleanZone)}\n` +
    `🧭 Direction: x=${safeVal(x, '?')}, y=${safeVal(y, '?')}, z=${safeVal(z, '?')}`;

    let time = `${new Date(safeVal(timestamp, Date.now())).toLocaleString()}\n`;

    let toReturn = '';
    
    // test for regular npc (name longer than 20 char, starts with pu_ followed by 4 or more latin letters, followed by anthing, followed by _ followed by 13 numbers)
    if (victim.length > 20 && /^PU_[a-zA-Z]{4,}.*_\d{13}$/.test(victim)) {
      // is regular npc, if was killed in a vehicle explosion (pilot npc), put npc for the victim and follow up with all the details
        if (damageType === "VehicleDestruction") {
            toReturn = `${time}🪦 NPC\n${body}`;
        } else {
          // regular, not pilot npc
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

//recieves messages from renderer process using on from preload
ipcMain.on('toggle-resizable', (event, value) => {
  isResizable = value;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setResizable(isResizable);
    overlayWindow.setIgnoreMouseEvents(!isResizable);
    overlayWindow.webContents.send('toggle-resize-border', isResizable);
  }
  saveConfig();
});

// sets overlay position based on screen percentage
ipcMain.on('set-overlay-position-percent', (event, xPercent, yPercent) => {
  config.overlayPositionPercent = { x: xPercent, y: yPercent };
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const [overlayWidth, overlayHeight] = overlayWindow.getSize();
    const { x, y } = getOverlayPixelPosition(xPercent, yPercent, overlayWidth, overlayHeight);
    overlayWindow.setPosition(x, y);
  }
  saveConfig();
});

// processes overlay on event sent from main renderer process
ipcMain.on('overlay-on', (event, value) => {
  if (value) {
    if (!overlayWindow) {
      createOverlayWindow();
    } 
    else if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.show();
      overlayWindow.focus();
      setOverlayWindowProperties();
    }
  } 
  else {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
      overlayWindow = null; 
    }
  }
  overlayOn = value; 
});

//show player ids
ipcMain.on('toggle-ids', (event, value) => {
  showIds = value;
});

// relays the overlay show border event from main renderer process to the overlay renderer process
ipcMain.on('overlay-show-border', (event, value) => {
  showBorder = value;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('make-show-border', value);
  }
});

// the function invoked by the main renderer process through the context bridge to get the overlay history 
ipcMain.handle('get-overlay-history', async () => {
  return Array.isArray(fileContentChanges) ? [...fileContentChanges] : [];
});

// relays scroll overlay events from the main renderer process to the overlay renderer process
ipcMain.on('scroll-overlay', (event, direction) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('scroll-overlay', direction);
  }
});

// activate all the stuff wheb the app is ready
app.whenReady().then(() => {
  createMainWindow();
  createTray();
  loadConfig(); 
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