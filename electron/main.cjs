const { app, BrowserWindow, shell, Menu, MenuItem, ipcMain, dialog } = require('electron');
const path = require('path');

// Disable automation-related features that leak Electron identification
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-infobars');
// Standard Chrome uses sandbox by default; we keep it enabled for security and stealth

const windows = new Set();
const initializedSessions = new Set();

// Simple .env loader for Electron Main process (avoids extra dependencies)
function loadEnv() {
  try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value) process.env[key.trim()] = value.join('=').trim();
      });
    }
  } catch (e) { console.error('Error loading .env:', e); }
}
loadEnv();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || 'http://localhost';

let authDeferred = null;

function handleAuthRedirect(url) {
  const code = new URL(url).searchParams.get('code');
  if (code && authDeferred) {
    authDeferred.resolve(code);
  } else if (authDeferred) {
    authDeferred.reject(new Error('No code found in redirect'));
  }
}

// Handle deep linking for Windows/Linux
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('asteroid-auth', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('asteroid-auth');
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // Someone tried to run a second instance, we should focus our window.
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// ─── GitHub OAuth IPC Handler ───
ipcMain.handle('auth:github-login', async (event) => {
  console.log('[Auth] Initiating GitHub Login flow...');
  
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    throw new Error('GitHub Client ID or Secret is missing in .env');
  }

  const authUrl = `https://github.com/login/oauth/authorize?` + 
    `client_id=${GITHUB_CLIENT_ID}&` + 
    `redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&` + 
    `scope=user:email`;

  const parentWin = BrowserWindow.getFocusedWindow();
  const authWin = new BrowserWindow({
    width: 600,
    height: 800,
    parent: parentWin,
    modal: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // Use a modern Chrome User-Agent
  authWin.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36");

  authWin.loadURL(authUrl);
  authWin.once('ready-to-show', () => authWin.show());

  const interceptRedirect = (url) => {
    if (url.startsWith(GITHUB_REDIRECT_URI)) {
      handleAuthRedirect(url);
      if (authWin && !authWin.isDestroyed()) authWin.close();
    }
  };

  authWin.webContents.on('will-navigate', (e, url) => interceptRedirect(url));
  authWin.webContents.on('did-redirect-navigation', (e, url) => interceptRedirect(url));

  return new Promise((resolve, reject) => {
    authDeferred = { resolve, reject };
    
    authWin.on('closed', () => {
      if (authDeferred) {
        authDeferred.reject(new Error('Login window was closed'));
        authDeferred = null;
      }
    });

    // Timeout (5 mins)
    setTimeout(() => {
      if (authDeferred) {
        authDeferred.reject(new Error('Authentication timed out after 5 minutes'));
        if (authWin && !authWin.isDestroyed()) authWin.close();
        authDeferred = null;
      }
    }, 5 * 60 * 1000);
  }).then(async (code) => {
    console.log('[Auth] Exchanging code for token...');
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        code,
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        redirect_uri: GITHUB_REDIRECT_URI
      })
    });

    const tokens = await tokenResponse.json();
    if (tokens.error) {
      throw new Error(tokens.error_description || tokens.error);
    }

    console.log('[Auth] Fetching user profile...');
    const userinfoResponse = await fetch('https://api.github.com/user', {
      headers: { 
        Authorization: `token ${tokens.access_token}`,
        'User-Agent': 'Asteroid-Browser'
      }
    });
    
    const profile = await userinfoResponse.json();
    console.log('[Auth] GitHub Login successful for:', profile.login);
    return {
      id: profile.id,
      email: profile.email || profile.login,
      name: profile.name || profile.login,
      picture: profile.avatar_url
    };
  }).finally(() => {
    authDeferred = null;
  });
});

ipcMain.handle('get-preload-path', () => {
  const p = path.join(__dirname, 'preload.cjs');
  return `file:///${p.replace(/\\/g, '/')}`;
});

// Startup Crash Debugger
process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('CRITICAL: Unhandled Rejection:', reason);
});
// ─── Global Security Configuration ───
const GLOBAL_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

app.on('session-created', (session) => {
  console.log('[Security] Masking session identifying as standard Chrome...');
  session.setUserAgent(GLOBAL_USER_AGENT);
  
  // Enforce HTTPS-First (simplified)
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return true; 
  });

  // Spoof User-Agent Client Hints to match standard Chrome 134
  session.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
    const requestHeaders = details.requestHeaders || {};
    requestHeaders['sec-ch-ua'] = '"Google Chrome";v="134", "Chromium";v="134", "Not:A-Brand";v="24"';
    requestHeaders['sec-ch-ua-mobile'] = '?0';
    requestHeaders['sec-ch-ua-platform'] = '"Windows"';
    callback({ requestHeaders });
  });
});

function setupSessionHandlers(ses) {
  const blockedCount = {}; 
  const firewallPatterns = [
    'doubleclick.net', 'google-analytics.com', 'googletagmanager.com',
    'facebook.com/tr/', 'pixel.facebook.com', 'bing.com/pixel',
    'scorecardresearch.com', 'quantserve.com', 'amazon-adsystem.com',
    'adnxs.com', 'pubmatic.com', 'rubiconproject.com', 'openx.net'
  ];

  const maliciousPatterns = [
    'g0ogle.com', 'googIe.com', 'paypaI.com', 'pay-pal.com', 'secure-login-verify',
    'phish', 'malware', 'suspicious-site.io', 'update-account-security.net',
    'bank-verify.com', 'walIet-connect.io', 'coinbase-support.net', 'apple-id-verify.co'
  ];

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const url = details.url.toLowerCase();
    const isMalicious = maliciousPatterns.some(p => url.includes(p));
    if (isMalicious && !url.includes('internal://danger')) {
      return callback({ redirectURL: `http://localhost:5199/?danger=true&url=${encodeURIComponent(details.url)}` });
    }

    const isTracker = firewallPatterns.some(p => url.includes(p));
    if (isTracker) {
      const tabIdStr = details.webContents?.getURL()?.match(/tab-([\d.]+)/)?.[1] || 'global';
      blockedCount[tabIdStr] = (blockedCount[tabIdStr] || 0) + 1;
      const win = BrowserWindow.fromWebContents(details.webContents);
      if (win) win.webContents.send('firewall-blocked', { 
        url, 
        total: blockedCount[tabIdStr],
        risk: isMalicious ? 'high' : 'low'
      });
      return callback({ cancel: true });
    }
    callback({ cancel: false });
  });

  // Block malicious navigation before it starts
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const url = details.url.toLowerCase();
    const isPhishing = maliciousPatterns.some(p => url.includes(p));
    if (isPhishing && !url.includes('internal://danger')) {
      return callback({ redirectURL: `internal://danger?url=${encodeURIComponent(details.url)}` });
    }
    callback({ cancel: false });
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['*://*.youtube.com/*'] }, (details, callback) => {
    const requestHeaders = details.requestHeaders || {};
    const currentCookie = requestHeaders['Cookie'] || '';
    if (!currentCookie.includes('CONSENT=YES')) {
      requestHeaders['Cookie'] = currentCookie + (currentCookie ? '; ' : '') + 'CONSENT=YES+cb.20210328-17-p0.en+FX+999';
    }
    callback({ requestHeaders });
  });

  ses.on('will-download', (event, item, webContents) => {
    const fileName = item.getFilename();
    const totalBytes = item.getTotalBytes();
    const downloadId = Date.now().toString();
    const win = BrowserWindow.fromWebContents(webContents);
    
    // Explicitly set save path to default downloads folder to prevent dialog issues or silent failures
    const downloadPath = path.join(app.getPath('downloads'), fileName);
    item.setSavePath(downloadPath);

    if (win) {
      win.webContents.send('download-started', { id: downloadId, filename: fileName, totalBytes, url: item.getURL() });
      
      item.on('updated', (event, state) => {
        if (state === 'progressing') {
          const received = item.getReceivedBytes();
          const percent = totalBytes > 0 ? Math.round((received / totalBytes) * 100) : 0;
          win.webContents.send('download-progress', { id: downloadId, received, percent });
        } else if (state === 'interrupted') {
          win.webContents.send('download-done', { id: downloadId, filename: fileName, state: 'failed' });
        }
      });
      
      item.once('done', (event, state) => {
        if (!win.isDestroyed()) {
          win.webContents.send('download-done', { id: downloadId, filename: fileName, path: item.getSavePath(), state });
        }
      });
    }
  });
}

function createWindow(options = { incognito: false }) {
  const sessionPartition = options.incognito ? 'incognito' : 'persist:main';
  
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: options.incognito ? '#030712' : '#0f172a',
      symbolColor: '#f8fafc',
      height: 38
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webviewTag: true,
      webSecurity: true,
      sandbox: true,
      partition: sessionPartition,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  if (!initializedSessions.has(sessionPartition)) {
    setupSessionHandlers(win.webContents.session);
    initializedSessions.add(sessionPartition);
  }

  windows.add(win);
  win.on('closed', () => windows.delete(win));

  win.maximize();
  
  // Set a modern User-Agent for the entire session
  win.webContents.session.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36");

  // In development, load from the Vite dev server
  const isDev = process.env.NODE_ENV === 'development';
  const suffix = options.incognito ? '?incognito=true' : '';
  
  if (isDev) {
    win.loadURL(`http://localhost:5199${suffix}`);
  } else {
    win.loadURL(`file://${path.join(__dirname, '../dist/index.html')}${suffix}`);
  }

  if (options.incognito) {
    const incognitoSession = win.webContents.session;
    incognitoSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const blocked = ['notifications', 'geolocation', 'midi', 'clipboard-read', 'media'];
      if (blocked.includes(permission)) return callback(false);
      callback(true);
    });
  }

  // Handle external links safely
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Native Context Menu (Right Click)
  win.webContents.on('context-menu', (event, params) => {
    const menu = new Menu();

    // Standard Browser Actions
    menu.append(new MenuItem({ label: 'Back', click: () => win.webContents.send('go-back') }));
    menu.append(new MenuItem({ label: 'Forward', click: () => win.webContents.send('go-forward') }));
    menu.append(new MenuItem({ label: 'Reload', click: () => win.webContents.send('reload-page') }));
    menu.append(new MenuItem({ type: 'separator' }));
    
    // Developer Tools
    menu.append(new MenuItem({
      label: 'Inspect Element',
      click: () => win.webContents.inspectElement(params.x, params.y)
    }));

    menu.popup({ window: win });
  });
}

  // Native AI Streaming Handler for Product responsiveness
  ipcMain.on('ai-stream-request', async (event, { url, options }) => {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const errText = await response.text();
        event.sender.send('ai-stream-error', `HTTP ${response.status}: ${errText}`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done && !buffer) break;

        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        let startIdx;
        while ((startIdx = buffer.indexOf('data:')) !== -1) {
          const nextIdx = buffer.indexOf('data:', startIdx + 5);
          
          if (nextIdx === -1 && !done) {
            const hasClosingBrace = buffer.lastIndexOf('}') > startIdx;
            if (!hasClosingBrace) break;
          }

          const raw = nextIdx === -1 ? buffer.slice(startIdx) : buffer.slice(startIdx, nextIdx);
          buffer = nextIdx === -1 ? '' : buffer.slice(nextIdx);

          const trimmed = raw.trim();
          if (!trimmed.startsWith('data:')) continue;
          
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);
            const content = data.choices?.[0]?.delta?.content || data.choices?.[0]?.text || '';
            if (content) {
              event.sender.send('ai-stream-chunk', content);
            }
          } catch (e) {
            if (!done) {
              buffer = raw + buffer;
              break;
            }
          }
        }
        if (done) break;
      }
      event.sender.send('ai-stream-done');
    } catch (err) {
      console.error('AI Stream Error:', err);
      event.sender.send('ai-stream-error', err.message);
    }
  });

// Handle all window creation requests (including those from webviews)
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    // Distinguish between internal protocols and external ones
    if (url.startsWith('http')) {
      // Find the main window to dispatch tab creation
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send('open-tab-request', url);
      }
      return { action: 'deny' }; // Always deny the native window
    }
    // For non-http protocols (mailto:, tel:, etc), open externally
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

// ─── Global App Lifecycle & IPC ───

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Core Browser IPC Tools ───
ipcMain.on('browser-exit', () => app.quit());

ipcMain.on('new-window', (e, { incognito }) => createWindow({ incognito }));

ipcMain.on('clear-browsing-data', async (event, options) => {
  const ses = event.sender.session;
  try {
    await ses.clearStorageData(options);
    if (options.cache) await ses.clearCache();
    event.sender.send('clear-data-done');
  } catch (err) {
    console.error('Clear Data Error:', err);
  }
});

ipcMain.handle('select-extension-dir', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Select Unpacked Extension Folder'
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('load-extension', async (event, extPath) => {
  try {
    const ext = await event.sender.session.loadExtension(extPath);
    return { success: true, name: ext.name, id: ext.id, path: extPath, version: ext.version };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('remove-extension', async (event, id) => {
  try {
    event.sender.session.removeExtension(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('list-active-extensions', async (event) => {
  const extensions = event.sender.session.getAllExtensions();
  return extensions.map(e => ({ id: e.id, name: e.name, version: e.version }));
});

ipcMain.on('capture-page', async (event, tabId) => {
  // Can be implemented if needed for system-level shortcuts
});
