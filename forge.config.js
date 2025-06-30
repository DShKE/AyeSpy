module.exports = {
  packagerConfig: {
    name: 'ayespy', 
    icon: './contrast.ico', 
    executableName: 'ayespy', 
    win32metadata: {
      ProductName: 'ayespy', 
      InternalName: 'ayespy',
      OriginalFilename: 'ayespy.exe',
    }
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        setupExe: 'ayespy-setup.exe', 
        setupIcon: './contrast.ico', 
        shortcutName: 'ayespy', 
        createDesktopShortcut: true, 
        createStartMenuShortcut: true 
      }
    }
  ]
};