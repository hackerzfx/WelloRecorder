const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const { exec, execSync } = require('child_process');
const fs = require('fs');

// PORTABILITY: Override userData to local 'Data' folder
if (app.isPackaged) {
  const dataPath = path.join(path.dirname(process.execPath), 'Data');
  if (!fs.existsSync(dataPath)) {
    try { fs.mkdirSync(dataPath); } catch (e) { }
  }
  app.setPath('userData', dataPath);
}

// Helper to find XVast from Registry
// Helper to find XVast from Registry (Async)
function findXVastFromRegistry() {
  return new Promise((resolve) => {
    // Check various registry keys
    const queries = [
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\xvast.exe" /ve',
      'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\xvast.exe" /ve',
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\xvast.exe" /ve'
    ];

    let completed = 0;
    let foundPath = null;

    // Helper to run next query
    const runNext = () => {
      if (foundPath || completed >= queries.length) {
        resolve(foundPath);
        return;
      }

      const query = queries[completed];
      completed++;

      exec(query, (error, stdout, stderr) => {
        if (!error && stdout) {
          const match = stdout.toString().match(/REG_SZ\s+(.+)/);
          if (match && match[1]) {
            let exePath = match[1].trim();
            if (fs.existsSync(exePath)) {
              foundPath = exePath;
              resolve(foundPath);
              return;
            }
          }
        }
        // If failed or not found, try next
        runNext();
      });
    };

    runNext();
  });
}

// Load the DLL injector addon (if built)
let injector;
const injectorPath = path.join(__dirname, 'injector', 'build', 'Release', 'injector.node');

if (fs.existsSync(injectorPath)) {
  try {
    injector = require(injectorPath);
    console.log('[Wello] DLL injector loaded successfully');
  } catch (e) {
    console.warn('[Wello] Failed to load injector:', e.message);
  }
} else {
  console.log('[Wello] XVast DRM bypass disabled (injector not found)');
}


// OPTIMIZATION: Disable Hardware Acceleration to allow capturing DRM content (Netflix, etc.)
app.disableHardwareAcceleration();

const licenseManager = require('./license-manager');

// --- License IPC Handlers ---

ipcMain.handle('get-license-status', () => {
  return licenseManager.getLicenseStatus();
});

ipcMain.handle('activate-license', (event, key) => {
  return licenseManager.activateLicense(key);
});

ipcMain.handle('consume-license', (event, hours) => {
  return licenseManager.consumeHours(hours);
});


let win;

// Browser Detection Paths (Windows)
const BROWSER_PATHS = {
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
  ],
  chrome_canary: [
    process.env.LOCALAPPDATA + '\\Google\\Chrome SxS\\Application\\chrome.exe'
  ],
  edge: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ],
  brave: [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    process.env.LOCALAPPDATA + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
  ],
  opera: [
    process.env.LOCALAPPDATA + '\\Programs\\Opera\\launcher.exe',
    'C:\\Program Files\\Opera\\launcher.exe'
  ],
  opera_gx: [
    process.env.LOCALAPPDATA + '\\Programs\\Opera GX\\launcher.exe'
  ],
  vivaldi: [
    process.env.LOCALAPPDATA + '\\Vivaldi\\Application\\vivaldi.exe',
    'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe'
  ],
  arc: [
    'C:\\Program Files\\Arc\\Arc.exe',
    process.env.LOCALAPPDATA + '\\Microsoft\\WindowsApps\\Arc.exe' // App package path often varies
  ],
  yandex: [
    process.env.LOCALAPPDATA + '\\Yandex\\YandexBrowser\\Application\\browser.exe'
  ],
  thorium: [
    process.env.LOCALAPPDATA + '\\Thorium\\Application\\thorium.exe',
    'C:\\Program Files\\Thorium\\Application\\thorium.exe'
  ],
  firefox: [
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
  ],
  librewolf: [
    'C:\\Program Files\\LibreWolf\\librewolf.exe'
  ],
  waterfox: [
    'C:\\Program Files\\Waterfox\\waterfox.exe'
  ],
  chromium: [
    process.env.LOCALAPPDATA + '\\Chromium\\Application\\chrome.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe'
  ],
  epic: [
    process.env.LOCALAPPDATA + '\\Epic Privacy Browser\\Application\\epic.exe'
  ],
  cent: [
    process.env.LOCALAPPDATA + '\\CentBrowser\\Application\\chrome.exe'
  ],
  xvast: [
    'C:\\Program Files (x86)\\Xvast\\chrome.exe',
    'C:\\Program Files\\Xvast\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Xvast\\chrome.exe',

  ]
};

function createWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 800,
    height: 600,
    transparent: true, // Enable transparency
    frame: false,      // Remove default frame
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    alwaysOnTop: false,
    resizable: true
  });

  win.loadFile('index.html');
  // win.webContents.openDevTools();
}

// Check for updates from GitHub
async function checkForUpdates() {
  try {
    const https = require('https');
    const currentVersion = require('./package.json').version;

    const options = {
      hostname: 'api.github.com',
      path: '/repos/hackerzfx/WelloRecorder/releases/latest',
      headers: { 'User-Agent': 'Wello-Recorder' }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestVersion = release.tag_name.replace(/^[vV]/, '');

          if (latestVersion > currentVersion) {
            console.log(`[Wello] Update available: v${latestVersion} (current: v${currentVersion})`);
            console.log(`[Wello] Download: ${release.html_url}`);

            // Show notification in UI
            if (win && win.webContents) {
              win.webContents.executeJavaScript(`
                const updateBanner = document.createElement('div');
                updateBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff6b35;color:#fff;padding:10px;text-align:center;z-index:99999;font-size:14px';
                updateBanner.innerHTML = '🎉 New version v${latestVersion} available! <a href="${release.html_url}" style="color:#fff;text-decoration:underline;margin-left:10px" target="_blank">Download</a>';
                document.body.prepend(updateBanner);
              `);
            }
          } else {
            console.log(`[Wello] You're up to date (v${currentVersion})`);
          }
        } catch (e) {
          console.log('[Wello] Could not parse update info');
        }
      });
    }).on('error', () => {
      console.log('[Wello] Could not check for updates (offline?)');
    });
  } catch (e) {
    console.log('[Wello] Update check failed');
  }
}

app.whenReady().then(() => {
  createWindow();

  // Check for updates on startup
  setTimeout(() => checkForUpdates(), 3000);

  // Auto-run XVast DRM Patcher (Auto-detect x86/x64)
  const is64bit = process.arch === 'x64';
  const patcherName = is64bit ? 'patcher_x64.exe' : 'patcher_x86.exe';

  let patcherPath;
  if (app.isPackaged) {
    // In packaged app, we use --extra-resource, so it's in resources/ folder
    patcherPath = path.join(process.resourcesPath, patcherName);
  } else {
    patcherPath = path.join(__dirname, patcherName);
  }

  if (fs.existsSync(patcherPath)) {
    console.log(`[Wello] Starting ${patcherName}...`);

    // Run patcher in background (detached)
    const { spawn } = require('child_process');
    const patcher = spawn(patcherPath, [], {
      detached: true,
      stdio: 'ignore'
    });

    patcher.unref();
    console.log('[Wello] Patcher running in background');
  } else {
    console.warn(`[Wello] ${patcherName} not found, trying fallback...`);

    // Try the other architecture as fallback
    const fallbackName = is64bit ? 'patcher_x86.exe' : 'patcher_x64.exe';
    let fallbackPath;

    if (app.isPackaged) {
      fallbackPath = path.join(process.resourcesPath, fallbackName);
    } else {
      fallbackPath = path.join(__dirname, fallbackName);
    }

    if (fs.existsSync(fallbackPath)) {
      console.log(`[Wello] Using fallback: ${fallbackName}`);
      const { spawn } = require('child_process');
      const patcher = spawn(fallbackPath, [], {
        detached: true,
        stdio: 'ignore'
      });
      patcher.unref();
    } else {
      console.warn('[Wello] No patcher found, DRM bypass disabled');
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC: Overlay Mode (Floating Capsule)
ipcMain.on('resize-to-overlay', () => {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const capsuleWidth = 400; // Estimated width of capsule
  const x = Math.round((screenWidth - capsuleWidth) / 2);

  win.setSize(capsuleWidth, 120); // Capsule size
  win.setPosition(x, 50); // Float at top
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(false);
});

// IPC: Main Mode (Restore)
ipcMain.on('resize-to-main', () => {
  win.setSize(800, 600);
  win.center();
  win.setAlwaysOnTop(false);
});

ipcMain.on('close-app', () => {
  app.quit();
});

// IPC: Minimize App
ipcMain.on('minimize-app', () => {
  if (win) win.minimize();
});

// IPC: Move Window (For Dragging)
ipcMain.on('move-window', (event, deltaX, deltaY) => {
  if (win) {
    const [x, y] = win.getPosition();
    win.setPosition(x + deltaX, y + deltaY);
  }
});

// IPC: Advanced Window Controls
ipcMain.on('enter-full-screen', () => {
  if (win) {
    const isFullScreen = win.isFullScreen();
    win.setFullScreen(!isFullScreen);
  }
});

ipcMain.on('tile-window-left', () => {
  if (win) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    win.setFullScreen(false);
    win.unmaximize();
    win.setBounds({ x: 0, y: 0, width: width / 2, height: height });
  }
});

ipcMain.on('tile-window-right', () => {
  if (win) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    win.setFullScreen(false);
    win.unmaximize();
    win.setBounds({ x: width / 2, y: 0, width: width / 2, height: height });
  }
});

// Handle getting sources
// Handle getting sources
ipcMain.handle('get-sources', async () => {
  // Optimization: Only fetch screens, and disable thumbnails to instant-load
  const inputSources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  });
  return inputSources;
});

// IPC: Detect Browsers
ipcMain.handle('detect-browsers', async () => {
  const installed = [];

  for (const [name, paths] of Object.entries(BROWSER_PATHS)) {
    let found = false;
    for (const p of paths) {
      if (fs.existsSync(p)) {
        installed.push({ name: name, path: p });
        found = true;
        break; // Found one valid path for this browser
      }
    }

    // If not found in standard paths and it's XVast, try registry
    if (!found && name === 'xvast') {
      const regPath = await findXVastFromRegistry();
      if (regPath) {
        installed.push({ name: name, path: regPath });
      }
    }
  }
  return installed;
});

// IPC: Launch Browser Safely (No GPU)
ipcMain.on('launch-browser', (event, browserPath) => {
  const isFirefox = browserPath.toLowerCase().includes('firefox') ||
    browserPath.toLowerCase().includes('librewolf') ||
    browserPath.toLowerCase().includes('waterfox');

  if (isFirefox) {
    // Firefox method: Env vars
    console.log("Launching Firefox-based browser with Clean Env...");
    const env = { ...process.env, MOZ_WEBRENDER: '0', ACCELERATED_LAYERS_DISABLED: '1' };
    exec(`"${browserPath}" -new-window`, { env }, (err) => {
      if (err) console.error("Failed to launch browser:", err);
    });
  } else {
    // Chromium method: Flags
    // CRITICAL: We use a PERSISTENT separate User Data Dir.
    // This allows the user to login ONCE and stay logged in (Cookies saved),
    // but keeps it isolated from the main browser to enforce disable-gpu.

    // Use app.getPath('userData') which is C:\Users\User\AppData\Roaming\welle (or similar)
    const userDataPath = app.getPath('userData');
    const profilesDir = path.join(userDataPath, 'SafeBrowserProfiles');

    // Ensure parent dir exists
    if (!fs.existsSync(profilesDir)) {
      try { fs.mkdirSync(profilesDir, { recursive: true }); } catch (e) { console.error(e); }
    }

    const safeProfileDir = path.join(profilesDir, `profile_${path.basename(browserPath)}`);

    // Check if this is XVast
    const isXVast = browserPath.toLowerCase().includes('xvast');

    // Enhanced flags for XVast (Widevine bypass attempt)
    const args = [
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-gpu-compositing',
      '--disable-gpu-rasterization',
      '--disable-gpu-sandbox',
      '--disable-accelerated-2d-canvas',
      '--disable-accelerated-video-decode',
      '--disable-accelerated-mjpeg-decode',
      '--disable-d3d11',
      // `--user-data-dir=${safeProfileDir}`, // COMMENTED OUT: Use Default Profile for saved logins
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window'
    ];

    if (isXVast) {
      // Add Widevine/DRM bypass flags for XVast
      args.push('--disable-features=HardwareMediaKeyHandling');
      args.push('--disable-gpu-driver-bug-workarounds');
      console.log('[Wello] Launching XVast with DRM bypass flags...');
    }

    const { spawn } = require('child_process');
    const child = spawn(browserPath, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    // INJECTION LOGIC (XVast Only)
    if (isXVast && injector && child.pid) {
      // Retry configuration
      const maxRetries = 15;
      const retryInterval = 1000; // 1 second
      let attempts = 0;

      const attemptInjection = () => {
        attempts++;
        try {
          const dllName = 'wello_hook.dll';
          let dllPath;

          if (app.isPackaged) {
            dllPath = path.join(process.resourcesPath, 'app', dllName);
          } else {
            dllPath = path.join(__dirname, dllName);
          }

          console.log(`[Wello] Injection attempt ${attempts}/${maxRetries} for XVast (PID: ${child.pid})...`);

          // Inject into process using PID directly
          const success = injector.inject(child.pid, dllPath);

          if (success) {
            console.log('[Wello] Injection SUCCESS! DRM should be bypassed.');
          } else {
            console.warn(`[Wello] Injection FAILED (Attempt ${attempts}). Process not found or access denied.`);

            if (attempts < maxRetries) {
              console.log(`[Wello] Retrying in ${retryInterval}ms...`);
              setTimeout(attemptInjection, retryInterval);
            } else {
              console.error('[Wello] All injection attempts failed. DRM bypass may not work.');
            }
          }
        } catch (e) {
          console.error('[Wello] Injection Error:', e);
          if (attempts < maxRetries) {
            setTimeout(attemptInjection, retryInterval);
          }
        }
      };

      // Start the injection loop with a small initial delay
      setTimeout(attemptInjection, 2000);
    }
  }
});
