import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  ArrowLeft, ArrowRight, RotateCw, Home, Search, 
  Menu, X, Plus, Shield, Settings, MoreVertical, LayoutGrid, Globe, Orbit, Sparkles, Send, Bot, Star, Clock, Trash2, ExternalLink,
  Monitor, Download, Printer, Languages, Columns, Square, Key, ChevronRight, Minus, Maximize2, HelpCircle, Layers,
  ChevronDown, SquarePen, PanelLeft, Paperclip, AtSign, ArrowUpCircle, Lightbulb,
  RotateCcw, ThumbsUp, ThumbsDown, Check, Copy, User, PlusCircle, Video, CornerDownRight, Link, FileText,
  Activity, Brain, Zap, Target, CheckCircle2, XCircle, Loader2, ChevronUp, ShieldAlert, Mic, ArrowUp, ArrowUpRight
} from 'lucide-react';
import { encode } from '@toon-format/toon';
import {
  saveAgentMemory, loadAgentMemory,
  addHistoryEntry, loadHistory, clearHistory as dbClearHistory,
  saveBookmarks, loadBookmarks,
  saveAllSettings, loadSettings as dbLoadSettings,
  addDownload, loadDownloads,
  saveIntentMemoryState, loadIntentMemoryState,
  saveTask, loadTasks, saveSession, loadSessions,
  saveExtension, loadExtensions, deleteExtension
} from './db.js';
import AgentOrchestrator from './engine/AgentOrchestrator.js';
import intentMemory from './engine/IntentMemory.js';
import contextEngine from './engine/ContextEngine.js';
import messageBus from './engine/MessageBus.js';
import AutoSummaryPanel from './components/AgentSidebar/AutoSummaryPanel.jsx';
import TaskDashboard from './components/NewTab/TaskDashboard.jsx';
import ExecutionPipeline from './components/AgentSidebar/ExecutionPipeline.jsx';
import OfflineExperience from './components/Offline/OfflineExperience.jsx';
import NewTabPage from './components/NewTab/NewTabPage.jsx';
import IntelligenceDashboard from './components/Dashboard/IntelligenceDashboard.jsx';
import { useAuth } from './components/Auth/AuthContext';
import AuthPage from './components/Auth/AuthPage';
import './index.css';


const DEFAULT_URL = 'https://google.com';
const NEW_TAB_URL = 'internal://newtab';
const INITIAL_AGENT_MESSAGES = [];

function getDomain(url) {
  try { 
    if (url === NEW_TAB_URL) return 'New Tab';
    return new URL(url).hostname; 
  } 
  catch (e) { return url; }
}

const EXTRACT_MARKDOWN_SCRIPT = `
(function() {
  function toMarkdown(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    let tag = node.tagName.toLowerCase();
    if (["script", "style", "noscript", "iframe"].includes(tag)) return "";
    let children = Array.from(node.childNodes).map(toMarkdown).join("");
    if (tag === "h1") return "\\n# " + children + "\\n";
    if (tag === "h2") return "\\n## " + children + "\\n";
    if (tag === "h3") return "\\n### " + children + "\\n";
    if (tag === "p") return "\\n" + children + "\\n";
    if (tag === "a") return "[" + children + "](" + node.href + ")";
    if (tag === "img") return "![" + (node.alt || "image") + "](" + node.src + ")";
    if (tag === "li") return "\\n- " + children;
    if (tag === "strong" || tag === "b") return "**" + children + "**";
    if (tag === "em" || tag === "i") return "*" + children + "*";
    return children;
  }
  return toMarkdown(document.body).replace(/\\n\\s*\\n/g, '\\n\\n').trim();
})()`;

const EXTRACT_SEMANTIC_SCRIPT = `
(function() {
  const interactive = Array.from(document.querySelectorAll('input, button, a[href], [role="button"], [role="link"], select, textarea'))
    .map(el => ({
      tag: el.tagName.toLowerCase(),
      id: el.id,
      classes: el.className,
      text: (el.innerText || el.value || el.placeholder || el.ariaLabel || "").trim().slice(0, 100),
      type: el.type,
      name: el.name,
      role: el.getAttribute('role') || ""
    }))
    .slice(0, 80);
  const media = Array.from(document.querySelectorAll('video, audio')).map(m => ({
    tag: m.tagName.toLowerCase(),
    paused: m.paused,
    muted: m.muted,
    duration: m.duration,
    currentTime: m.currentTime
  })).slice(0, 5);
  const structured = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map(s => { try { return JSON.parse(s.innerText); } catch(e) { return null; } })
    .filter(Boolean)
    .slice(0, 5);
  return JSON.stringify({ interactive, media, structured });
})()`;

const SecurityWarning = ({ url, onGoBack, onProceed }) => (
  <div className="security-warning-overlay">
    <div className="security-warning-content">
      <div className="warning-icon-large">
        <ShieldAlert size={64} color="#ef4444" />
      </div>
      <h1>Dangerous site ahead</h1>
      <p style={{ color: 'white', marginBottom: '20px', lineHeight: '1.6' }}>
        Asteroid's Google Security Process has flagged <strong>{url}</strong> as suspicious. 
        Attackers on this site might try to trick you into doing something dangerous, like 
        installing software or revealing your personal information (for example, passwords, 
        phone numbers, or credit cards).
      </p>
      <div className="warning-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
        <button className="btn-safe" onClick={onGoBack} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer' }}>Back to safety</button>
        <button className="btn-danger-proceed" onClick={onProceed} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer' }}>Proceed anyway</button>
      </div>
    </div>
  </div>
);

const electronAPI = typeof window !== 'undefined' ? window.electronAPI : null;
const ipcRenderer = electronAPI || { on: () => {}, removeListener: () => {}, send: () => {}, invoke: () => Promise.resolve() };
const isIncognito = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('incognito') === 'true';

const IncognitoNewTab = () => (
  <div className="incognito-ntp">
    <div className="incognito-card">
      <div className="incognito-icon-wrapper">
        <Shield size={48} />
      </div>
      <h1 className="incognito-title">You've gone InPrivate</h1>
      <p className="incognito-desc">
        Now you can browse privately, and other people who use this device won’t see your activity. 
        However, downloads and bookmarks will be kept.
      </p>
      
      <div className="incognito-grid">
        <div className="incognito-list">
          <h4><Check size={16} /> Asteroid won't save:</h4>
          <ul>
            <li>Your browsing history</li>
            <li>Cookies and site data</li>
            <li>Information entered in forms</li>
          </ul>
        </div>
        <div className="incognito-list">
          <h4><ShieldAlert size={16} /> Activity might still be visible to:</h4>
          <ul>
            <li>Websites you visit</li>
            <li>Your employer or school</li>
            <li>Your internet service provider</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
);

function App() {
  const [tabs, setTabs] = useState([
    { 
      id: 1, 
      url: NEW_TAB_URL, 
      title: 'New Tab', 
      loading: false,
      history: [NEW_TAB_URL],
      historyIndex: 0,
      canGoBack: false,
      canGoForward: false
    }
  ]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [isFocused, setIsFocused] = useState(false);

  // Authentication State
  const { isAuthenticated, loading: authLoading, user: authUser, logout } = useAuth();
  
  // Memoize preload path via IPC
  const [preloadPath, setPreloadPath] = useState('');
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.invoke('get-preload-path').then(setPreloadPath);
    }
  }, []);
  
  // Persistence States
  const [bookmarks, setBookmarks] = useState([]);
  const [historyLog, setHistoryLog] = useState([]);
  
  // Agentic Panel State
  const [showAgent, setShowAgent] = useState(false);
  const [showHomeIntent, setShowHomeIntent] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [isSplashFading, setIsSplashFading] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [sidebarMode, setSidebarMode] = useState('chat'); // 'chat' or 'summary'
  const [agentMode, setAgentMode] = useState('link'); // 'link', 'ai', or 'research'
  const [showExtensions, setShowExtensions] = useState(false);
  const [extensions, setExtensions] = useState([]);
  
  // ─── Self-Driving Intelligence State ───
  const [showTaskDashboard, setShowTaskDashboard] = useState(false);
  const [currentTask, setCurrentTask] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const activeTabIdRef = useRef(activeTabId);
  const [contextMode, setContextMode] = useState('unknown');
  const [taskHistory, setTaskHistory] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [pipelinePhase, setPipelinePhase] = useState(-1); // -1 = inactive, 0=Intent, 1=Strategy, 2=Action
  const [activePhaseDescription, setActivePhaseDescription] = useState("");
  const [isToonActive, setIsToonActive] = useState(true); // Default to true as dependency is present
  const orchestratorRef = useRef(null);
  const lastScanTimeRef = useRef(0); // Throttle for lag reduction
  
  // Sync tab ID ref for agents
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // Extensions Management Logic
  useEffect(() => {
    const loadExts = async () => {
      const savedExtensions = await loadExtensions();
      setExtensions(savedExtensions);
      if (window.electronAPI) {
        for (const ext of savedExtensions) {
          if (ext.enabled) window.electronAPI.invoke('load-extension', ext.path);
        }
      }
    };
    loadExts();
  }, []);

  // Extension and Tab Management Listeners
  useEffect(() => {
    if (!window.require) return;
    const { ipcRenderer } = window.require('electron');
    
    const handleOpenTabRequest = (event, url) => {
      handleCreateTab(url);
    };

    ipcRenderer.on('open-tab-request', handleOpenTabRequest);
    return () => ipcRenderer.removeListener('open-tab-request', handleOpenTabRequest);
  }, []);

  const handleAddExtension = async () => {
    if (!window.electronAPI) return;
    const path = await window.electronAPI.invoke('select-extension-dir');
    if (!path) return;
    const result = await window.electronAPI.invoke('load-extension', path);
    if (result.success) {
      const newExt = { id: result.id, name: result.name, version: result.version, path, enabled: true };
      setExtensions(prev => [...prev, newExt]);
      await saveExtension(newExt);
    } else {
      alert(`Error: ${result.error}`);
    }
  };
  
  // Initialize orchestrator once
  if (!orchestratorRef.current) {
    orchestratorRef.current = new AgentOrchestrator();
  }
  const orchestrator = orchestratorRef.current;

  
  const [dynamicSuggestions, setDynamicSuggestions] = useState([
    { id: 'sum', text: 'Summarize Page', icon: <Bot size={14}/> },
    { id: 'exp', text: 'Explain Topic', icon: <Globe size={14}/> },
    { id: 'links', text: 'Extract Links', icon: <Link size={14}/> },
    { id: 'new', text: 'New Tab', icon: <Plus size={14}/> }
  ]);
  const [settings, setSettings] = useState({
    showHistoryOnNTP: !isIncognito,
    theme: isIncognito ? 'dark' : 'dark', 
    apiKey: import.meta.env.VITE_NVIDIA_API_KEY || '', 
    apiEndpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    model: 'meta/llama-3.1-70b-instruct',
    googleSafeBrowsing: true
  });
  const [agentMessages, setAgentMessages] = useState(INITIAL_AGENT_MESSAGES);
  const [agentInput, setAgentInput] = useState("");
  const [thoughtTime, setThoughtTime] = useState(0);
  const [downloads, setDownloads] = useState([]);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [blockedCount, setBlockedCount] = useState({}); // { tabId: count }
  const [showDashboard, setShowDashboard] = useState(false);
  const [firewallEnabled, setFirewallEnabled] = useState(true);
  const [isSplitScreen, setIsSplitScreen] = useState(false);
  const [splitTabIds, setSplitTabIds] = useState([null, null]); // [tab1, tab2]

  const iframeRefs = useRef({}); // Store refs for each tab webview
  const wvCleanupsRef = useRef(new Map()); // Store cleanup functions for tab event listeners: tabId -> cleanupFn
  const addressBarRef = useRef(null);
  const agentInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let timer;
    if (isAgentTyping) {
      setThoughtTime(0);
      timer = setInterval(() => {
        setThoughtTime(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(timer);
    }
    return () => clearInterval(timer);
  }, [isAgentTyping]);

  const activeTab = tabs.find(t => t.id === activeTabId);

  // Keyboard Shortcuts & IPC Listeners
  useEffect(() => {
    const handleGlobalKeys = (e) => {
      // Ctrl+T: New Tab
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        handleCreateTab();
      }
      // Ctrl+W: Close Tab
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        const tid = activeTabId;
        handleCloseTab({ stopPropagation: () => {} }, tid);
      }
      // Ctrl+L: Focus URL
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        addressBarRef.current?.focus();
        addressBarRef.current?.select();
      }
      // Ctrl+R or F5: Reload
      if ((e.ctrlKey && e.key === 'r') || e.key === 'F5') {
        e.preventDefault();
        handleRefresh();
      }
    };

    // If running in Electron, listen for native menu IPC
    if (window.electronAPI) {
      window.electronAPI.on('go-back', handleGoBack);
      window.electronAPI.on('go-forward', handleGoForward);
      window.electronAPI.on('reload-page', handleRefresh);

      // Download IPC listeners
      const onDownloadStarted = (e, data) => {
        setDownloads(prev => [{ ...data, percent: 0, state: 'downloading', timestamp: Date.now() }, ...prev]);
        setShowDownloads(true);
      };
      const onDownloadProgress = (e, data) => {
        setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, percent: data.percent } : d));
      };
      const onDownloadDone = (e, data) => {
        setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, state: data.state, path: data.path, percent: 100 } : d));
        addDownload({ filename: data.filename, path: data.path, state: data.state, totalBytes: data.totalBytes });
      };

      window.electronAPI.on('download-started', onDownloadStarted);
      window.electronAPI.on('download-progress', onDownloadProgress);
      window.electronAPI.on('download-done', onDownloadDone);
      
      const onFirewallBlocked = (data) => {
        setBlockedCount(prev => {
          const tid = activeTabIdRef.current.toString();
          return { ...prev, [tid]: (prev[tid] || 0) + 1 };
        });
        // We could also show a small toast for high risk
        if (data.risk === 'high') {
          console.warn('[Security] High-risk domain blocked:', data.url);
        }
      };
      window.electronAPI.on('firewall-blocked', onFirewallBlocked);
      
      return () => {
        window.removeEventListener('keydown', handleGlobalKeys);
        window.electronAPI.removeListener('go-back', handleGoBack);
        window.electronAPI.removeListener('go-forward', handleGoForward);
        window.electronAPI.removeListener('reload-page', handleRefresh);
        window.electronAPI.removeListener('download-started', onDownloadStarted);
        window.electronAPI.removeListener('download-progress', onDownloadProgress);
        window.electronAPI.removeListener('download-done', onDownloadDone);
        window.electronAPI.removeListener('firewall-blocked', onFirewallBlocked);
      };
    }

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [activeTabId, tabs, activeTab]);

  // Sync address bar when tab changes
  useEffect(() => {
    if (activeTab && addressBarRef.current) {
      addressBarRef.current.value = activeTab.url === NEW_TAB_URL ? '' : activeTab.url;
    }
  }, [activeTabId, activeTab?.url]);

  // WebView Event Management
  // Simplified Active WebView Check (handled by Unified Sync now)
  useEffect(() => {
    const activeWv = iframeRefs.current[activeTabId];
    if (activeWv && activeWv.dataset) {
       // Visual feedback or specific active-only logic can go here
    }
  }, [activeTabId]); 

  // Unified WebView State Sync with Memory Leak Protection
  useEffect(() => {
    const currentTabIds = new Set(tabs.map(t => t.id));
    
    // 1. Cleanup listeners for tabs that were closed
    for (const [id, cleanup] of wvCleanupsRef.current.entries()) {
      if (!currentTabIds.has(id)) {
        try { cleanup(); } catch(e) {}
        wvCleanupsRef.current.delete(id);
      }
    }

    // 2. Poll for new webviews and attach listeners
    const interval = setInterval(() => {
      tabs.forEach((tab) => {
        const wv = iframeRefs.current[tab.id];
        if (wv && !wvCleanupsRef.current.has(tab.id)) {
          console.log(`[Hydration] Attaching listeners to tab ${tab.id}`);
          
          const update = () => {
             // Throttling: Skip background tabs if not a critical event
             if (tab.id !== activeTabIdRef.current && !tab.loading) {
               if (Math.random() > 0.3) return; 
             }
             
            try {
              const url = wv.getURL();
              const title = wv.getTitle();
              const canGoBack = wv.canGoBack();
              const canGoForward = wv.canGoForward();
              const loading = wv.isLoading();

              setTabs(prev => prev.map(t => {
                if (t.id !== tab.id) return t;
                const isNewNav = url !== t.url && !loading;
                let nextBackStack = t.backStack || [];
                if (isNewNav && url !== NEW_TAB_URL) {
                   nextBackStack = [...nextBackStack, {
                     url: t.url, title: t.title, taskId: intentMemory.activeIntentId, timestamp: Date.now()
                   }].slice(-50);
                }
                return { ...t, url, title, canGoBack, canGoForward, loading, backStack: nextBackStack };
              }));
            } catch(e) {}
          };

          const eventMap = {
            'did-start-loading': update,
            'did-stop-loading': update,
            'did-navigate': update,
            'did-navigate-in-page': update,
            'dom-ready': update
          };

          Object.entries(eventMap).forEach(([event, handler]) => {
            wv.addEventListener(event, handler);
          });

          // Store cleanup function for this tab
          wvCleanupsRef.current.set(tab.id, () => {
            Object.entries(eventMap).forEach(([event, handler]) => {
              try { wv.removeEventListener(event, handler); } catch(e) {}
            });
          });
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [tabs]); 

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000 * 60);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Splash Screen Lifecycle
    const timer = setTimeout(() => {
      setIsSplashFading(true);
      setTimeout(() => setShowSplash(false), 800); // Match CSS fade-out duration
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  // ─── PROACTIVE SUGGESTIONS: Page-aware actions ───
  useEffect(() => {
    // Performance Guard: Pause proactivity during active tasks
    if (currentTask && currentTask.status === 'running') return;

    if (showAgent && activeTab && activeTab.url !== NEW_TAB_URL) {
      // Lag Mitigation: Throttle scans to every 5 seconds (was 3.5s)
      const now = Date.now();
      if (now - lastScanTimeRef.current < 5000) return;
      lastScanTimeRef.current = now;

      const webview = iframeRefs.current[activeTabId];
      if (webview && webview.executeJavaScript) {
        try {
          webview.executeJavaScript(`(function() {
            try {
              const hasVideo = !!document.querySelector('video, audio');
              const isPlaying = Array.from(document.querySelectorAll('video, audio')).some(m => !m.paused);
              const hasArticle = !!document.querySelector('article, main, .content, .post, .article');
              const hasInputs = !!document.querySelector('input:not([type="hidden"]), textarea, [contenteditable="true"]');
              const hasSearch = !!document.querySelector('input[type="search"], input[name="q"], input[name="search_query"], [role="searchbox"]');
              const linksCount = document.querySelectorAll('a[href]').length;
              const title = document.title;
              return { hasVideo, isPlaying, hasArticle, hasInputs, hasSearch, linksCount, title };
            } catch(e) { return null; }
          })()`).then(info => {
            if (!info) return;
            const newSuggs = [];
            if (info.hasVideo) {
              newSuggs.push({ id: 'med', text: info.isPlaying ? 'Pause Media' : 'Play Media', icon: <Video size={14}/> });
            }
            if (info.hasSearch) newSuggs.push({ id: 'sea', text: 'Search This Site', icon: <Search size={14}/> });
            if (info.hasArticle) newSuggs.push({ id: 'sum', text: 'Summarize This', icon: <FileText size={14}/> });
            if (info.linksCount > 5) newSuggs.push({ id: 'lns', text: 'List All Links', icon: <Link size={14}/> });
            
            // Default fallback
            if (newSuggs.length < 2) {
              newSuggs.push({ id: 'exp', text: 'Explain Page', icon: <Globe size={14}/> });
              if (!info.hasSearch) newSuggs.push({ id: 'sea_gen', text: 'Search Topic', icon: <Search size={14}/> });
            }
            
            setDynamicSuggestions(newSuggs.slice(0, 4));
          }).catch(err => {
              console.warn("[Proactive Engine] Analysis failed:", err.message);
          });
        } catch(e) {
             console.warn("[Proactive Engine] Initialization failed:", e.message);
        }
      }
    }
  }, [showAgent, activeTabId, activeTab?.url]);

  // Connectivity Watcher
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ─── DATABASE: Load all persisted data on mount ───
  useEffect(() => {
    async function loadFromDB() {
      if (isIncognito) {
        setDbLoaded(true);
        return;
      }
      try {
        const [savedBookmarks, savedHistory, savedMemory, savedSettings, savedDownloads, savedIntentMemory, savedTasks, savedSessions] = await Promise.all([
          loadBookmarks(),
          loadHistory(),
          loadAgentMemory(),
          dbLoadSettings(),
          loadDownloads(),
          loadIntentMemoryState().catch(() => null),
          loadTasks().catch(() => []),
          loadSessions().catch(() => [])
        ]);
        if (savedBookmarks.length) setBookmarks(savedBookmarks);
        if (savedHistory.length) setHistoryLog(savedHistory.map(h => ({ url: h.url, title: h.title, time: h.time || new Date(h.timestamp).toLocaleTimeString() })));
        
        if (Object.keys(savedSettings).length) {
          setSettings(prev => {
            const merged = { ...prev, ...savedSettings };
            // If the DB has an empty key but we have a VITE environment key, prioritize the environment key
            if (!savedSettings.apiKey && import.meta.env.VITE_NVIDIA_API_KEY) {
              merged.apiKey = import.meta.env.VITE_NVIDIA_API_KEY;
            }
            return merged;
          });
        }
        if (savedDownloads.length) setDownloads(savedDownloads);
        if (savedIntentMemory) intentMemory.hydrate(savedIntentMemory);
        if (savedTasks.length) setTasks(savedTasks);
      } catch (err) {
        console.warn('DB load error:', err);
      }
      setDbLoaded(true);
    }
    loadFromDB();
  }, []);

  // ─── DATABASE: Auto-save on changes ───
  useEffect(() => { if (dbLoaded) saveBookmarks(bookmarks); }, [bookmarks, dbLoaded]);
  useEffect(() => { if (dbLoaded) saveAgentMemory(agentMessages); }, [agentMessages, dbLoaded]);
  useEffect(() => { if (dbLoaded) saveAllSettings(settings); }, [settings, dbLoaded]);


  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [agentMessages, showAgent]);

  const getGreeting = () => {
    const hrs = currentTime.getHours();
    if (hrs < 12) return 'Good Morning';
    if (hrs < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  const handleCreateTab = (url = NEW_TAB_URL) => {
    const newId = Date.now() + Math.random();
    setTabs(prev => [...prev, { 
      id: newId, 
      url: url, 
      title: getDomain(url), 
      loading: url !== NEW_TAB_URL,
      history: [url],
      historyIndex: 0,
      canGoBack: false,
      canGoForward: false,
      backStack: [],
      forwardStack: []
    }]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (e, id) => {
    e.stopPropagation();
    if (tabs.length === 1) return; 
    
    const newTabs = tabs.filter(t => t.id !== id);
    if (activeTabId === id) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
    setTabs(newTabs);
    delete iframeRefs.current[id];
  };

  // ─── Module Helpers (Core Functionalities) ───
  const reloadTab = () => { const wv = iframeRefs.current[activeTabId]; if (wv) wv.reload(); };
  const stopTab = () => { const wv = iframeRefs.current[activeTabId]; if (wv) wv.stop(); };
  const zoomIn = () => { setZoom(z => Math.min(z + 10, 300)); };
  const zoomOut = () => { setZoom(z => Math.max(z - 10, 25)); };
  const resetZoom = () => { setZoom(100); };
  
  useEffect(() => {
    const wv = iframeRefs.current[activeTabId];
    if (wv) wv.setZoomLevel(zoom / 100 - 1);
  }, [zoom, activeTabId]);

  const printPage = () => { const wv = iframeRefs.current[activeTabId]; if (wv) wv.print(); };
  const captureScreenshot = () => { const wv = iframeRefs.current[activeTabId]; if (wv) wv.capturePage().then(img => /* save or show */ console.log("Captured")); };
  const openDevToolsView = () => { const wv = iframeRefs.current[activeTabId]; if (wv) wv.openDevTools(); };
  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeydown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 't': e.preventDefault(); handleCreateTab(); break;
          case 'w': e.preventDefault(); handleCloseTab(e, activeTabId); break;
          case 'r': e.preventDefault(); reloadTab(); break;
          case 'l': e.preventDefault(); addressBarRef.current?.focus(); break;
          case '+': case '=': e.preventDefault(); zoomIn(); break;
          case '-': e.preventDefault(); zoomOut(); break;
          case '0': e.preventDefault(); resetZoom(); break;
          case 'n': 
            if (e.shiftKey) { e.preventDefault(); ipcRenderer.send('new-window', { incognito: true }); }
            else { e.preventDefault(); ipcRenderer.send('new-window', { incognito: false }); }
            break;
        }
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [activeTabId, zoom]);

  const navigate = (inputUrl, targetId = activeTabId) => {
    let finalUrl = inputUrl.trim();
    if (!finalUrl) return;

    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://') && !finalUrl.startsWith('internal://')) {
      if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
        finalUrl = `https://${finalUrl}`;
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`; 
      }
    }
    
    setTabs(prev => prev.map(tab => {
      if (tab.id === targetId) {
        const newHistory = tab.history.slice(0, tab.historyIndex + 1);
        newHistory.push(finalUrl);
        return { 
          ...tab, 
          url: finalUrl, 
          title: getDomain(finalUrl), 
          loading: finalUrl !== NEW_TAB_URL,
          history: newHistory,
          historyIndex: newHistory.length - 1,
          canGoBack: newHistory.length > 1,
          canGoForward: false
        };
      }
      return tab;
    }));

    if (finalUrl !== NEW_TAB_URL && !isIncognito) {
      const entry = { url: finalUrl, title: getDomain(finalUrl), time: new Date().toLocaleTimeString() };
      setHistoryLog(prev => [entry, ...prev].slice(0, 50));
      addHistoryEntry(entry);
    }
  };

  const toggleBookmark = () => {
    if (!activeTab || activeTab.url === NEW_TAB_URL) return;
    const isBookmarked = bookmarks.some(b => b.url === activeTab.url);
    if (isBookmarked) {
      setBookmarks(bookmarks.filter(b => b.url !== activeTab.url));
    } else {
      setBookmarks([...bookmarks, { url: activeTab.url, title: activeTab.title }]);
    }
  };

  const removeBookmark = (url) => {
    setBookmarks(bookmarks.filter(b => b.url !== url));
  };

  const handleClearData = async () => {
    if (confirm("Are you sure you want to clear all browsing data (History, Cache, Cookies)?")) {
      await clearBrowsingData({ history: true, cache: true, cookies: true });
      ipcRenderer.send('clear-browsing-data', { history: true, cache: true, cookies: true });
      setHistoryLog([]);
      setBlockedCount({});
      alert("All browsing data cleared successfully.");
    }
  };

  const handleGoBack = (smart = false) => {
    const webview = iframeRefs.current[activeTabId];
    if (webview && webview.canGoBack()) {
      const currentTab = tabs.find(t => t.id === activeTabId);
      if (smart && currentTab) {
        let backIdx = currentTab.backStack.length - 1;
        // Smart Back implementation
        const currentHost = new URL(currentTab.url).hostname;
        while (backIdx > 0) {
          const entry = currentTab.backStack[backIdx];
          const entryHost = new URL(entry.url).hostname;
          if (entryHost !== currentHost || entry.taskId !== activeIntentId) break;
          backIdx--;
        }
        const backEntry = currentTab.backStack[backIdx];
        if (backEntry) {
          const jumpAmount = (currentTab.backStack.length - 1) - backIdx + 1;
          for (let i = 0; i < jumpAmount; i++) webview.goBack();
          return;
        }
      }
      webview.goBack();
    }
  };

  const handleGoForward = () => {
    const webview = iframeRefs.current[activeTabId];
    if (webview && webview.canGoForward()) {
      webview.goForward();
    }
  };

  const submitAgentTask = async (text) => {
    const input = text || agentInput;
    if (!input.trim()) return;

    setAgentInput("");
    setAgentMessages(prev => [...prev.filter(m => m.role !== 'system'), { role: 'user', text: input }]);
    setIsAgentTyping(true);
    setPipelinePhase(0); // [PHASE 0: INTENT]
    setActivePhaseDescription("Decoding your prompt...");

    if (!settings.apiKey) {
      setAgentMessages(prev => [...prev, { role: 'ai', text: "I need an API key to work! Please go to Settings ⚙️ and enter your key." }]);
      setIsAgentTyping(false);
      return;
    }

    // Build browser context for the orchestrator
    const browserCtx = {
      navigate,
      goBack: handleGoBack,
      goForward: handleGoForward,
      refresh: reloadTab,
      iframeRefs,
      activeTabIdRef,
      isIncognito
    };

    // Update context engine with current tab info
    if (activeTab && activeTab.url !== NEW_TAB_URL) {
      contextEngine.updateTabContext(activeTabId, {
        url: activeTab.url,
        title: activeTab.title
      });
      contextEngine.setActiveTab(activeTabId);
    }

    // Initialize AI response bubble
    setAgentMessages(prev => [...prev, { role: 'ai', text: '' }]);

    try {
      setPipelinePhase(1); // [PHASE 1: STRATEGY]
      await orchestrator.processInput(input, settings, browserCtx, agentMode, (type, data) => {
        switch (type) {
          case 'status':
            // If the status contains "Analyzing" or "Planning", we stay in status 1
            // Once steps arrive, we might move to 2
            setAgentMessages(prev => {
              const newMsgs = [...prev];
              if (newMsgs.length > 0 && newMsgs[newMsgs.length - 1].role === 'ai') {
                newMsgs[newMsgs.length - 1] = { role: 'ai', text: data };
              }
              return newMsgs;
            });
            break;

          case 'chunk':
            setAgentMessages(prev => {
              const newMsgs = [...prev];
              if (newMsgs.length > 0 && newMsgs[newMsgs.length - 1].role === 'ai') {
                newMsgs[newMsgs.length - 1] = { role: 'ai', text: data };
              }
              return newMsgs;
            });
            if (messagesEndRef.current) {
              messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
            }
            break;

          case 'taskCreated':
            setCurrentTask(data);
            setShowTaskDashboard(true);
            break;

          case 'stepRunning':
            setPipelinePhase(2); // [PHASE 2: ACTION]
            setActivePhaseDescription(data.step.description);
            setCurrentTask(data.task);
            break;

          case 'stepDone':
            setCurrentTask(data.task);
            break;

          case 'complete':
            setAgentMessages(prev => {
              const filtered = prev.filter(m => m.role !== 'system');
              const newMsgs = [...filtered];
              const text = typeof data === 'string' ? data : data.text;
              if (newMsgs.length > 0 && newMsgs[newMsgs.length - 1].role === 'ai') {
                newMsgs[newMsgs.length - 1] = { 
                  role: 'ai', 
                  text: text || 'Task complete.',
                  options: data.options || null 
                };
              } else if (text) {
                newMsgs.push({ 
                  role: 'ai', 
                  text: text,
                  options: data.options || null 
                });
              }
              return newMsgs;
            });
            if (data.task) setCurrentTask(data.task);
            // Save task to history
            if (currentTask && !isIncognito) {
              setTaskHistory(prev => [currentTask, ...prev].slice(0, 20));
              saveTask(currentTask).catch(() => {});
            }
            break;

          case 'error':
            setAgentMessages(prev => [...prev.filter(m => m.role !== 'system'), { role: 'ai', text: data }]);
            break;
        }
      });
      
      // Update intent/context
      setContextMode(contextEngine.getCurrentMode());
      if (!isIncognito) {
        saveIntentMemoryState(intentMemory.serialize()).catch(() => {});
      }

    } catch (err) {
      console.error("Agent Error:", err);
      setAgentMessages(prev => [...prev.filter(m => m.role !== 'system'), { role: 'ai', text: `Error: ${err.message}. Please check your API key and connection.` }]);
    } finally {
      setIsAgentTyping(false);
      setPipelinePhase(-1); // Reset
    }
  };

  // Replaced by Unified Sync above

  const handleRefresh = () => {
    if (activeTab?.url === NEW_TAB_URL) return;
    const webview = iframeRefs.current[activeTabId];
    if (webview) {
      if (activeTab?.loading) {
        webview.stop();
      } else {
        webview.reload();
      }
    }
  };

  // ─── RESUME TASK LOGIC ───
  const handleResumeTask = (task) => {
    if (!task.linkedTabs || task.linkedTabs.length === 0) {
      handleCreateTab(NEW_TAB_URL);
    } else {
      // Restore tabs from task context
      // In a real app, we'd store the actual tab objects.
      // For now, let's open the last active URL or a group of tabs if stored.
      const lastTab = task.linkedTabs[task.linkedTabs.length - 1];
      handleCreateTab(lastTab.url || DEFAULT_URL);
    }
    setCurrentTask(task);
    setShowAgent(true);
    setSidebarMode('summary');
  };

  // ─── SMART SESSION CAPTURE ───
  useEffect(() => {
    if (!dbLoaded) return;
    
    const interval = setInterval(() => {
      const activeIntents = intentMemory.getActiveIntents();
      if (activeIntents.length > 0) {
        const currentIntent = intentMemory.getActiveIntent();
        intentMemory.captureSession({
          tabs: tabs.filter(t => t.url !== NEW_TAB_URL),
          intentId: currentIntent.id
        });
        saveIntentMemoryState(intentMemory.serialize());
      }
    }, 30000); // Auto-save every 30s
    
    return () => clearInterval(interval);
  }, [tabs, dbLoaded]);

  const isCurrentBookmarked = activeTab && bookmarks.some(b => b.url === activeTab.url);
  const canGoBack = activeTab?.canGoBack ?? false;
  const canGoForward = activeTab?.canGoForward ?? false;

  // --- AUTH BYPASS ---
  if (authLoading) return <div className="loading-screen" style={{height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#030712'}}><div className="auth-spinner"></div></div>;

  return (
    <div className={`browser-window ${isIncognito ? 'incognito-theme' : ''}`}>
      {/* Starting Splash Screen */}
      {showSplash && (
        <div className={`splash-screen ${isSplashFading ? 'fade-out' : ''}`}>
          <div className="splash-content">
            <Orbit size={80} className="splash-logo" />
            <h1 className="splash-title">Asteroid</h1>
            <p className="splash-subtitle">The Future of Browsing</p>
          </div>
        </div>
      )}

      {/* Title Bar & Tabs */}
      <div className="title-bar">
        <div className="window-controls">
          <button className="control-btn close"></button>
          <button className="control-btn minimize"></button>
          <button className="control-btn maximize"></button>
        </div>
        
        <div className="tabs-container">
          {tabs.map(tab => (
            <div 
              key={tab.id}
              className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => setActiveTabId(tab.id)}
            >
              <div className="tab-icon">
                {tab.url === NEW_TAB_URL ? 
                  <LayoutGrid size={13} color="var(--text-secondary)" /> 
                  : 
                  <img src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(tab.url)}`} alt="icon" onError={(e) => { e.target.style.display='none' }} />
                }
              </div>
              <div className="tab-title">{tab.title}</div>
              <button className="tab-close" onClick={(e) => handleCloseTab(e, tab.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
          <button className="new-tab-btn" onClick={() => handleCreateTab()}>
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Navigation & Address Bar */}
      <div className="nav-bar">
        <div className="nav-group">
          <button className="icon-btn" disabled={!canGoBack} onClick={handleGoBack}><ArrowLeft size={18} /></button>
          <button className="icon-btn" disabled={!canGoForward} onClick={handleGoForward}><ArrowRight size={18} /></button>
          <button className="icon-btn" onClick={handleRefresh} disabled={activeTab?.url === NEW_TAB_URL}>
            {activeTab?.loading ? <X size={18} /> : <RotateCw size={18} />}
          </button>
          <button className="icon-btn" onClick={() => navigate(NEW_TAB_URL)}><Home size={18} /></button>
        </div>


        <div className="nav-group">
          <button className="icon-btn" onClick={() => {
            if (showAgent) {
              setAgentMessages(INITIAL_AGENT_MESSAGES);
            }
            setShowAgent(!showAgent);
          }}>
            <Sparkles size={18} className={showAgent ? 'animate-pulse text-blue-400' : ''} />
          </button>
          

          <button className="icon-btn" onClick={() => setShowHomeIntent(!showHomeIntent)} title="Toggle Home Intent Memory">
            <SquarePen size={18} color={showHomeIntent ? "var(--accent)" : "currentColor"} />
          </button>
          <button className="icon-btn" onClick={() => setShowMoreMenu(!showMoreMenu)}><MoreVertical size={18} /></button>
        </div>
      </div>

      {/* More Menu Dropdown */}
      {showMoreMenu && (
        <>
          <div className="more-menu-overlay" onClick={() => setShowMoreMenu(false)} />
          <div className="more-menu-dropdown">
            <div className="menu-item" onClick={() => { handleCreateTab(); setShowMoreMenu(false); }}>
              <div className="menu-item-icon"><Plus size={16} /></div>
              <div className="menu-item-text">New tab</div>
              <div className="menu-item-shortcut">Ctrl+T</div>
            </div>
            <div className="menu-item" onClick={() => { window.electronAPI.send('new-window', { incognito: false }); setShowMoreMenu(false); }}>
              <div className="menu-item-icon"><Monitor size={16} /></div>
              <div className="menu-item-text">New window</div>
              <div className="menu-item-shortcut">Ctrl+N</div>
            </div>
            <div className="menu-item" onClick={() => { window.electronAPI.send('new-window', { incognito: true }); setShowMoreMenu(false); }}>
              <div className="menu-item-icon"><Shield size={16} /></div>
              <div className="menu-item-text">New InPrivate window</div>
              <div className="menu-item-shortcut">Ctrl+Shift+N</div>
            </div>
            <div className="menu-divider" />
            <div className={`menu-item ${isSplitScreen ? 'menu-item-active' : ''}`} onClick={() => { setIsSplitScreen(!isSplitScreen); setShowMoreMenu(false); }}>
              <div className="menu-item-icon"><Columns size={16} /></div>
              <div className="menu-item-text">Split screen</div>
              <div className="menu-item-shortcut">Ctrl+S</div>
            </div>

            <div className="menu-divider" />

            <div className="zoom-row">
              <div className="zoom-label">
                <Search size={16} color="#94a3b8" />
                <span>Zoom</span>
              </div>
              <div className="zoom-controls">
                <button className="zoom-btn" onClick={() => setZoom(Math.max(25, zoom - 10))}><Minus size={14} /></button>
                <span className="zoom-percentage">{zoom}%</span>
                <button className="zoom-btn" onClick={() => setZoom(Math.min(500, zoom + 10))}><Plus size={14} /></button>
              </div>
              <button className="fullscreen-btn"><Maximize2 size={16} /></button>
            </div>

            <div className="menu-divider" />

            <div className="menu-item">
              <div className="menu-item-icon"><Star size={16} /></div>
              <div className="menu-item-text">Favorites</div>
              <div className="menu-item-shortcut">Ctrl+Shift+O</div>
            </div>
            <div className="menu-item">
              <div className="menu-item-icon"><Clock size={16} /></div>
              <div className="menu-item-text">History</div>
              <div className="menu-item-shortcut">Ctrl+H</div>
            </div>
            <div className="menu-item">
              <div className="menu-item-icon"><Layers size={16} /></div>
              <div className="menu-item-text">Tab groups</div>
              <div className="menu-item-arrow"><ChevronRight size={14} /></div>
            </div>
            <div className="menu-item" onClick={() => { setShowDownloads(true); setShowMoreMenu(false); }}>
              <div className="menu-item-icon"><Download size={16} /></div>
              <div className="menu-item-text">Downloads</div>
              <div className="menu-item-shortcut">Ctrl+J</div>
            </div>
            <div className="menu-item" onClick={() => { setShowExtensions(true); setShowMoreMenu(false); }}>
              <div className="menu-item-icon"><Settings size={16} /></div>
              <div className="menu-item-text">Extensions</div>
              <div className="menu-item-shortcut">Ctrl+Shift+E</div>
            </div>
            <div className="menu-item" onClick={() => { setShowDashboard(true); setShowMoreMenu(false); }}>
              <div className="menu-item-icon"><Activity size={16} color="var(--accent)" /></div>
              <div className="menu-item-text" style={{ color: 'var(--accent)' }}>Intelligence Dashboard</div>
              <div className="menu-item-tag">New</div>
            </div>
            <div className="menu-item">
              <div className="menu-item-icon"><Key size={16} /></div>
              <div className="menu-item-text">Passwords</div>
            </div>

            <div className="menu-divider" />

            <div className="menu-item" onClick={() => { setShowSettings(true); setShowMoreMenu(false); }}>
              <div className="menu-item-icon"><Trash2 size={16} /></div>
              <div className="menu-item-text">Delete browsing data</div>
              <div className="menu-item-shortcut">Ctrl+Shift+Del</div>
            </div>
            <div className="menu-item">
              <div className="menu-item-icon"><Printer size={16} /></div>
              <div className="menu-item-text">Print</div>
              <div className="menu-item-shortcut">Ctrl+P</div>
            </div>
            <div className="menu-item">
              <div className="menu-item-icon"><Languages size={16} /></div>
              <div className="menu-item-text">Translate</div>
            </div>
            <div className="menu-item">
              <div className="menu-item-icon"><Columns size={16} /></div>
              <div className="menu-item-text">Split screen</div>
            </div>
            <div className="menu-item">
              <div className="menu-item-icon"><Square size={16} /></div>
              <div className="menu-item-text">Screenshot</div>
              <div className="menu-item-shortcut">Ctrl+Shift+S</div>
            </div>
            <div className="menu-item">
              <div className="menu-item-icon"><Search size={16} /></div>
              <div className="menu-item-text">Find on page</div>
              <div className="menu-item-shortcut">Ctrl+F</div>
            </div>
            <div className="menu-item">
              <div className="menu-item-text" style={{ paddingLeft: '30px' }}>More tools</div>
              <div className="menu-item-arrow"><ChevronRight size={14} /></div>
            </div>

            <div className="menu-divider" />

            <div className="menu-item" onClick={() => { setShowSettings(true); setShowMoreMenu(false); }}>
              <div className="menu-item-icon"><Settings size={16} /></div>
              <div className="menu-item-text">Settings</div>
            </div>
            <div className="menu-item">
              <div className="menu-item-icon"><HelpCircle size={16} /></div>
              <div className="menu-item-text">Help and feedback</div>
              <div className="menu-item-arrow"><ChevronRight size={14} /></div>
            </div>
          </div>
        </>
      )}

      {/* Bookmarks Bar */}
      {!isIncognito && bookmarks.length > 0 && (
        <div className="bookmarks-bar">
          {bookmarks.map((bm, i) => (
            <button key={i} className="bookmark-item" onClick={() => navigate(bm.url)}>
              <img src={`https://www.google.com/s2/favicons?domain_url=${bm.url}`} alt="" />
              <span>{bm.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* Main Content & Agent Split Area */}
      <div className="content-split-area">
        <div className="page-content">
          <div className={`loading-bar ${activeTab?.loading ? 'active' : 'done'}`}></div>
          
          {!isOnline ? (
            <OfflineExperience 
              bookmarks={bookmarks} 
              history={historyLog} 
              onSearchLocal={(text) => submitAgentTask(text)} 
              onNavigate={(url) => navigate(url)}
            />
          ) : isSplitScreen ? (
            <div className="split-screen-container" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100%', gap: '1px', background: 'var(--border-color)' }}>
              {[0, 1].map(index => {
                const tabId = splitTabIds[index] || (index === 0 ? activeTabId : (tabs.length > 1 ? tabs[1].id : activeTabId));
                const tab = tabs.find(t => t.id === tabId);
                return (
                  <div key={index} className="split-pane" style={{ position: 'relative', background: 'white' }}>
                    {tab?.url === NEW_TAB_URL ? (
                      isIncognito ? <IncognitoNewTab /> : (
                        <NewTabPage 
                          isIncognito={isIncognito} 
                          onNavigate={navigate} 
                          onSubmitAgentTask={submitAgentTask}
                        />
                      )
                    ) : (
                      <webview
                        ref={el => iframeRefs.current[tabId] = el}
                        src={tab?.url}
                        style={{ width: '100%', height: '100%' }}
                        partition={isIncognito ? 'incognito' : 'persist:main'}
                        webPreferences="nodeIntegration=no,webSecurity=true,contextIsolation=yes,sandbox=yes,autoplayPolicy=no-user-gesture-required"
                        useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
                        preload={preloadPath}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            tabs.map(tab => {
              if (tab.url === NEW_TAB_URL) {
                return isIncognito ? (
                  <div key={tab.id} style={{ display: tab.id === activeTabId ? 'flex' : 'none', flex: 1 }}>
                    <IncognitoNewTab />
                  </div>
                ) : (
                  <div key={tab.id} style={{ display: tab.id === activeTabId ? 'flex' : 'none', flex: 1, height: '100%' }}>
                    <NewTabPage 
                      onNavigate={navigate} 
                      onSubmitAgentTask={(prompt) => { submitAgentTask(prompt); setShowAgent(true); }} 
                    />
                    {showHomeIntent && (
                      <div className="ntp-intent-overlay-float" style={{ position: 'fixed', bottom: '40px', right: '40px', width: '350px', zIndex: 100 }}>
                         <TaskDashboard tasks={tasks} onResumeTask={handleResumeTask} />
                      </div>
                    )}
                  </div>
                );
              } else if (tab.url.includes('danger=true')) {
                return (
                  <SecurityWarning 
                    key={tab.id} 
                    url={new URLSearchParams(tab.url.split('?')[1]).get('url')} 
                    onGoBack={() => handleGoBack()}
                    onProceed={() => {
                      const targetUrl = new URLSearchParams(tab.url.split('?')[1]).get('url');
                      navigate(targetUrl + (targetUrl.includes('?') ? '&' : '?') + 'proceed=true');
                    }}
                  />
                );
              } else {
                return (
                  <webview
                    key={tab.id}
                    ref={el => iframeRefs.current[tab.id] = el}
                    src={tab.url}
                    className="browser-iframe"
                    partition={isIncognito ? 'incognito' : 'persist:main'}
                    webPreferences="nodeIntegration=no,webSecurity=true,contextIsolation=yes,sandbox=yes,autoplayPolicy=no-user-gesture-required"
                    useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
                    preload={preloadPath}
                    allowpopups="true"
                    style={{ 
                      visibility: tab.id === activeTabId ? 'visible' : 'hidden', 
                      position: 'absolute',
                      inset: 0,
                      transform: tab.id === activeTabId ? 'translate3d(0, 0, 0)' : 'translate3d(100vw, 0, 0)',
                      zIndex: tab.id === activeTabId ? 10 : 1,
                      pointerEvents: tab.id === activeTabId ? 'auto' : 'none'
                    }}
                  />
                );
              }
            })
          )}
        </div>

        {/* AI Agent Sidebar Refinement - HIGH FIDELITY */}
        {showAgent && (
          <div className="agent-sidebar">
            <div className="agent-header">
              <div className="agent-header-left">
                <div className="agent-header-title">
                  <Sparkles size={18} className="text-purple-500" />
                  <span style={{ fontWeight: 700, fontSize: '15px' }}>AI Assistant</span>
                  <div className="analyze-pill">
                    <div className="analyze-dot"></div>
                    <span>Analyze</span>
                  </div>
                </div>
              </div>
              <div className="agent-header-actions">
                <button className="icon-btn"><ArrowUpRight size={18} /></button>
                <button className="icon-btn" onClick={() => { setAgentMessages([]); setPipelinePhase(-1); }}><SquarePen size={17}/></button>
                <button className="icon-btn"><MoreVertical size={18}/></button>
                <button className="icon-btn close-btn" onClick={() => setShowAgent(false)}><X size={18}/></button>
              </div>
            </div>

            
            <div className="agent-messages-container">
              {agentMessages.length === 0 && (
                <div className="quick-actions-container">
                  <div className="quick-actions-welcome">
                    <Sparkles size={24} className="welcome-icon" />
                    <h2>How can I help you today?</h2>
                    <p>Select an action or type your query below.</p>
                  </div>
                  <div className="quick-actions-grid">
                    {dynamicSuggestions.map(s => (
                      <button key={s.id} className="quick-action-card" onClick={() => submitAgentTask(s.text)}>
                        <div className="qa-icon">{s.icon}</div>
                        <span>{s.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {agentMessages.map((m, i) => (
                <div key={i} className={`ai-message-wrapper ${m.role}`}>
                  <div className={`agent-bubble ${m.role}`}>
                    {m.role === 'ai' 
                      ? (m.text.replace(/\[.*?\]/g, '').trim() || (isAgentTyping ? "Charlie is thinking..." : "Task complete."))
                      : m.text}
                  </div>
                  {m.role === 'ai' && m.options && (
                    <div className="ai-options-grid">
                      {m.options.map((opt, idx) => (
                        <button 
                          key={idx} 
                          className="ai-option-btn-choice"
                          onClick={() => submitAgentTask(opt.input)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {m.role === 'ai' && (
                    <div className="ai-actions-row">
                      <button className="ai-action-btn"><PlusCircle size={14} /> Insert</button>
                      <button className="ai-action-btn"><Copy size={14} /></button>
                      <button className="ai-action-btn"><ThumbsUp size={14} /></button>
                      <button className="ai-action-btn"><ThumbsDown size={14} /></button>
                      <button className="ai-action-btn" onClick={() => {
                        const prevMsg = agentMessages[i-1];
                        if (prevMsg && prevMsg.role === 'user') {
                          submitAgentTask(prevMsg.text);
                        }
                      }}><RotateCcw size={14} /></button>
                    </div>
                  )}
                </div>
              ))}
              
              {/* ─── Live Task Dashboard ─── */}
              {currentTask && currentTask.steps && (
                <div className="task-dashboard-card">
                  <div className="task-dashboard-header" onClick={() => setShowTaskDashboard(!showTaskDashboard)}>
                    <div className="task-dashboard-title">
                      <Activity size={14} />
                      <span>Task Pipeline</span>
                      <span className={`task-badge ${currentTask.status}`}>
                        {currentTask.status === 'complete' ? <><Check size={12}/> DONE</> : currentTask.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="task-dashboard-meta">
                      <div className="task-progress-bar">
                        <div className="task-progress-fill" style={{ width: `${currentTask.progress || 0}%` }} />
                      </div>
                      <span className="task-progress-text">{currentTask.progress || 0}%</span>
                      {showTaskDashboard ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                  
                  {showTaskDashboard && (
                    <div className="task-steps-list">
                      {currentTask.steps.map((step, idx) => (
                        <div key={step.id || idx} className={`task-step-item ${step.status}`}>
                          <div className="task-step-main">
                            <div className="task-step-icon">
                              {step.status === 'complete' && <CheckCircle2 size={14} />}
                              {step.status === 'running' && <Loader2 size={14} className="spin" />}
                              {step.status === 'failed' && <XCircle size={14} />}
                              {step.status === 'pending' && <Target size={14} />}
                              {step.status === 'skipped' && <Minus size={14} />}
                            </div>
                            <span className="task-step-desc">{step.description}</span>
                          </div>
                          {step.error && (
                            <div className="task-step-error">{step.error}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {sidebarMode === 'summary' && (
                <AutoSummaryPanel activeTab={activeTab} settings={settings} />
              )}

              {sidebarMode === 'chat' && (
                <>
                  {isToonActive && (
                    <div className="toon-protocol-badge">
                      <Zap size={10} />
                      <span>TOON PROTOCOL READY</span>
                    </div>
                  )}

                  {contextMode && contextMode !== 'unknown' && (
                    <div className="context-mode-badge">
                      <Brain size={12} />
                      <span>Mode: {contextMode}</span>
                    </div>
                  )}

                  {isAgentTyping && (
                    <ExecutionPipeline 
                      isActive={pipelinePhase >= 0} 
                      currentPhase={pipelinePhase} 
                      activePhaseDescription={activePhaseDescription}
                      thoughtTime={thoughtTime}
                    />
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="agent-footer">
              <div className="agent-pro-card">
                <div className="pro-input-row">
                  <Search size={20} className="pro-search-icon" />
                  <textarea 
                    placeholder="What agent are you looking for?" 
                    value={agentInput}
                    onChange={(e) => setAgentInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAgentTask(); } }}
                    rows={1}
                  />
                </div>
                <div className="pro-action-row">
                  <div className="pro-mode-pills">
                    <button 
                      className={`mode-pill ${agentMode === 'link' ? 'active' : ''}`}
                      onClick={() => setAgentMode('link')}
                    >
                      <Link size={14} />
                      <span>Link</span>
                    </button>
                    <button 
                      className={`mode-pill ${agentMode === 'ai' ? 'active' : ''}`}
                      onClick={() => setAgentMode('ai')}
                    >
                      <Sparkles size={14} />
                      <span>With AI</span>
                    </button>
                    <button 
                      className={`mode-pill ${agentMode === 'research' ? 'active' : ''}`}
                      onClick={() => setAgentMode('research')}
                    >
                      <Brain size={14} />
                      <span>Deep Research</span>
                    </button>
                  </div>
                  <div className="pro-right-actions">
                    <button className="icon-btn mic-btn"><Mic size={18} /></button>
                    <button 
                      className="pro-send-bubble" 
                      onClick={() => submitAgentTask()} 
                      disabled={!agentInput.trim() || isAgentTyping}
                    >
                      <Send size={18} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
            )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h2>Settings</h2>
              <button className="icon-btn" onClick={() => setShowSettings(false)}><X size={20} /></button>
            </div>
            
            <div className="settings-content">
              <div className="settings-section">
                <h3>Privacy & Appearance</h3>
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">Show History on New Tab</span>
                    <span className="setting-desc">Display your recent activity on the main page</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={settings.showHistoryOnNTP} 
                      onChange={(e) => setSettings({...settings, showHistoryOnNTP: e.target.checked})}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
                
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">Enhanced Tracking Protection</span>
                    <span className="setting-desc">Automatically block trackers and invasive ads</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={firewallEnabled} 
                      onChange={(e) => setFirewallEnabled(e.target.checked)}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">Clear Browsing Data</span>
                    <span className="setting-desc">Wipe your history, cache, and cookies</span>
                  </div>
                  <button className="delete-btn" style={{ padding: '6px 12px' }} onClick={handleClearData}>Clear Now</button>
                </div>
                
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">Google Safe Browsing</span>
                    <span className="setting-desc">Identify and block dangerous websites automatically</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      disabled={isIncognito}
                      checked={settings.googleSafeBrowsing} 
                      onChange={(e) => setSettings({...settings, googleSafeBrowsing: e.target.checked})}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
              </div>
              
              {isIncognito && (
                <div className="settings-section" style={{ background: 'rgba(147, 51, 234, 0.1)', border: '1px solid #9333ea' }}>
                  <h3 style={{ color: '#c084fc' }}><Shield size={16}/> Incognito Mode Active</h3>
                  <p style={{ fontSize: '12px', opacity: 0.8 }}>Your activity in this window is private. Browsing history and cookies are not persisted.</p>
                </div>
              )}

              <div className="settings-section">
                <h3>Password Manager</h3>
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">Credential Vault</span>
                    <span className="setting-desc">Securely store and retrieve your site logins</span>
                  </div>
                  <button className="btn-safe" style={{ padding: '6px 12px' }}>Open Vault</button>
                </div>
              </div>


              <div className="settings-section">
                <h3>Data Management</h3>
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">Browser History</span>
                    <span className="setting-desc">Clear all recorded navigation data</span>
                  </div>
                  <button className="danger-btn" onClick={() => { setHistoryLog([]); dbClearHistory(); setShowSettings(false); }}>
                    <Trash2 size={14} /> Clear History
                  </button>
                </div>
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">Bookmarks</span>
                    <span className="setting-desc">Delete all saved favorite sites</span>
                  </div>
                  <button className="danger-btn" onClick={() => { setBookmarks([]); setShowSettings(false); }}>
                    <Trash2 size={14} /> Clear Bookmarks
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Downloads Panel */}
      {showDownloads && (
        <div className="settings-overlay" onClick={() => setShowDownloads(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()} style={{maxWidth: '480px'}}>
            <div className="settings-header">
              <h2>Downloads</h2>
              <button className="icon-btn" onClick={() => setShowDownloads(false)}><X size={20} /></button>
            </div>
            <div className="settings-content">
              {downloads.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  <Download size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
                  <p>No downloads yet</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}>
                  {downloads.map((dl, i) => (
                    <div key={dl.id || i} className="download-item">
                      <div className="download-icon">
                        <Download size={18} />
                      </div>
                      <div className="download-info">
                        <span className="download-name">{dl.filename}</span>
                        {dl.state === 'downloading' ? (
                          <div className="download-progress-bar">
                            <div className="download-progress-fill" style={{ width: `${dl.percent}%` }} />
                          </div>
                        ) : (
                          <span className="download-status" data-state={dl.state}>
                            {dl.state === 'completed' ? '✓ Complete' : dl.state === 'cancelled' ? '✗ Cancelled' : '⚠ Failed'}
                          </span>
                        )}
                      </div>
                      <span className="download-percent">
                        {dl.state === 'downloading' ? `${dl.percent}%` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Extensions Modal */}
      {showExtensions && (
        <div className="settings-overlay" onClick={() => setShowExtensions(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()} style={{maxWidth: '600px'}}>
            <div className="settings-header">
              <h2><Layers size={20} /> Extension Manager</h2>
              <button className="icon-btn" onClick={() => setShowExtensions(false)}><X size={20} /></button>
            </div>
            <div className="settings-content">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <p style={{ margin: 0 }}>Enhance your browsing with Chrome Extensions.</p>
                  <span style={{ fontSize: '11px', opacity: 0.6 }}>Supports unpacked extensions (.zip or folder)</span>
                </div>
                <button className="btn-safe" onClick={handleAddExtension}>+ Load Unpacked</button>
              </div>

              {extensions.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '12px' }}>
                  <Layers size={48} style={{ opacity: 0.2, marginBottom: '12px' }} />
                  <p>No extensions loaded yet.</p>
                  <p style={{ fontSize: '12px', opacity: 0.5 }}>Try adding "Dark Reader" for a better night experience.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {extensions.map(ext => (
                    <div key={ext.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px' }}>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>{ext.name[0]}</div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: '600' }}>{ext.name}</span>
                          <span style={{ fontSize: '11px', opacity: 0.6 }}>v{ext.version}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <label className="switch">
                          <input 
                            type="checkbox" 
                        onChange={() => {
                              setExtensions(extensions.map(e => 
                                e.id === ext.id ? { ...e, enabled: !e.enabled } : e
                              ));
                            }}
                          />
                          <span className="slider round"></span>
                        </label>
                        <button className="icon-btn text-red-400" onClick={() => {
                          setExtensions(extensions.filter(e => e.id !== ext.id));
                          deleteExtension(ext.id);
                        }}><Trash2 size={16}/></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <h3 style={{ fontSize: '14px', marginBottom: '12px' }}>Recommended for Efficiency</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px' }}>Dark Reader</span>
                    <button className="icon-btn" onClick={() => navigate('https://github.com/darkreader/darkreader')}><ExternalLink size={14}/></button>
                  </div>
                  <div style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px' }}>uBlock Origin</span>
                    <button className="icon-btn" onClick={() => navigate('https://github.com/gorhill/uBlock')}><ExternalLink size={14}/></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Intelligence Dashboard */}
      <IntelligenceDashboard isOpen={showDashboard} onClose={() => setShowDashboard(false)} />
    </div>
  );
}

export default App;
