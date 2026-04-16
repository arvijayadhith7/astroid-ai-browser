const { contextBridge, ipcRenderer } = require('electron');

// ─── Stealth Overrides ───
// This script runs in the isolated context, but we can use simple JS to mask properties
// that are frequently checked by bot detection logic (like Google's).

const maskAutomation = () => {
    // Hide navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
    });

    // Mock chrome.app and chrome.runtime
    window.chrome = {
        app: {
            isInstalled: false,
            InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            getDetails: () => ({}),
            getIsInstalled: () => false,
        },
        runtime: {
            OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
            OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
            PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64' },
            PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
            PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
            RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
        },
        // Legacy Google Client Side Instrumentation
        csi: () => ({
            startE: Date.now() - 100,
            onloadT: Date.now(),
            pageT: 200,
            tran: 15
        }),
        // Legacy page timing data
        loadTimes: () => ({
            requestTime: (Date.now() - 500) / 1000,
            startLoadTime: (Date.now() - 500) / 1000,
            commitLoadTime: (Date.now() - 400) / 1000,
            finishDocumentLoadTime: (Date.now() - 300) / 1000,
            finishLoadTime: (Date.now() - 200) / 1000,
            firstPaintTime: (Date.now() - 450) / 1000,
            firstPaintAfterLoadTime: 0,
            navigationType: 'Other',
            wasFetchedFromCache: false,
            wasAlternateProtocolAvailable: false,
            wasProxied: false
        })
    };

    // Override navigator.languages to ensure standard English is present
    Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
    });

    // Mock navigator.userAgentData for modern sites
    if (!navigator.userAgentData) {
        Object.defineProperty(navigator, 'userAgentData', {
            get: () => ({
                brands: [
                    { brand: 'Google Chrome', version: '134' },
                    { brand: 'Chromium', version: '134' },
                    { brand: 'Not:A-Brand', version: '24' }
                ],
                mobile: false,
                platform: 'Windows'
            })
        });
    }
};

// Execute masking immediately
try {
    maskAutomation();
} catch (e) {
    console.error('[Stealth] Injection failed:', e);
}

// ─── Browser API Bridge ───
const listenerWrappers = new WeakMap();

contextBridge.exposeInMainWorld('electronAPI', {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, func) => {
        const wrapper = (event, ...args) => func(event, ...args);
        listenerWrappers.set(func, wrapper);
        ipcRenderer.on(channel, wrapper);
    },
    removeListener: (channel, func) => {
        const wrapper = listenerWrappers.get(func);
        if (wrapper) {
            ipcRenderer.removeListener(channel, wrapper);
            listenerWrappers.delete(func);
        } else {
            ipcRenderer.removeListener(channel, func);
        }
    },
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
