import { openDB } from 'idb';

const DB_NAME = 'NetCenterDB';
const DB_VERSION = 4;

let _dbPromise = null;
function getDB() {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
    // ─── V1 Stores ───
    if (!db.objectStoreNames.contains('agent_memory')) {
      db.createObjectStore('agent_memory', { keyPath: 'id', autoIncrement: true });
    }
    if (!db.objectStoreNames.contains('history')) {
      const historyStore = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
      historyStore.createIndex('timestamp', 'timestamp');
    }
    if (!db.objectStoreNames.contains('bookmarks')) {
      db.createObjectStore('bookmarks', { keyPath: 'url' });
    }
    if (!db.objectStoreNames.contains('downloads')) {
      const dlStore = db.createObjectStore('downloads', { keyPath: 'id', autoIncrement: true });
      dlStore.createIndex('timestamp', 'timestamp');
    }
    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'key' });
    }

    // ─── V2 Stores (Self-Driving Intelligence) ───
    if (!db.objectStoreNames.contains('intents')) {
      const intentStore = db.createObjectStore('intents', { keyPath: 'id' });
      intentStore.createIndex('status', 'status');
      intentStore.createIndex('createdAt', 'createdAt');
    }
    if (!db.objectStoreNames.contains('tasks')) {
      const taskStore = db.createObjectStore('tasks', { keyPath: 'id' });
      taskStore.createIndex('status', 'status');
      taskStore.createIndex('createdAt', 'createdAt');
    }
    if (!db.objectStoreNames.contains('context_sessions')) {
      const ctxStore = db.createObjectStore('context_sessions', { keyPath: 'id' });
      ctxStore.createIndex('timestamp', 'timestamp');
    }
    if (!db.objectStoreNames.contains('preferences')) {
      db.createObjectStore('preferences', { keyPath: 'key' });
    }
    if (!db.objectStoreNames.contains('intent_memory_state')) {
      db.createObjectStore('intent_memory_state', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('orchestrator_state')) {
      db.createObjectStore('orchestrator_state', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('passwords')) {
      const passStore = db.createObjectStore('passwords', { keyPath: 'id', autoIncrement: true });
      passStore.createIndex('site', 'site');
    }
    if (!db.objectStoreNames.contains('extensions')) {
      db.createObjectStore('extensions', { keyPath: 'id' });
    }
  }
    });
  }
  return _dbPromise;
}

// ─── Password Manager ───
export async function savePassword(entry) {
  const db = await getDB();
  await db.put('passwords', { ...entry, updatedAt: Date.now() });
}

export async function loadPasswords() {
  const db = await getDB();
  return db.getAll('passwords');
}

export async function deletePassword(id) {
  const db = await getDB();
  await db.delete('passwords', id);
}

// ─── Unified Data Clearing ───
export async function clearBrowsingData({ cache, cookies, history, passwords, downloads }) {
  const db = await getDB();
  if (history) await db.clear('history');
  if (passwords) await db.clear('passwords');
  if (downloads) await db.clear('downloads');
  // Cache and Cookies are handled in the main process via IPC
}

// ─── Agent Memory ───
export async function saveAgentMemory(messages) {
  const db = await getDB();
  const tx = db.transaction('agent_memory', 'readwrite');
  await tx.store.clear();
  for (const msg of messages) {
    await tx.store.add({ role: msg.role, text: msg.text, timestamp: Date.now() });
  }
  await tx.done;
}

export async function loadAgentMemory() {
  const db = await getDB();
  return db.getAll('agent_memory');
}

// ─── History ───
export async function addHistoryEntry(entry) {
  const db = await getDB();
  await db.add('history', { ...entry, timestamp: Date.now() });
}

export async function loadHistory() {
  const db = await getDB();
  const all = await db.getAll('history');
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

export async function clearHistory() {
  const db = await getDB();
  await db.clear('history');
}

// ─── Bookmarks ───
export async function saveBookmarks(bookmarks) {
  const db = await getDB();
  const tx = db.transaction('bookmarks', 'readwrite');
  await tx.store.clear();
  for (const bm of bookmarks) {
    await tx.store.put(bm);
  }
  await tx.done;
}

export async function loadBookmarks() {
  const db = await getDB();
  return db.getAll('bookmarks');
}

// ─── Downloads ───
export async function addDownload(download) {
  const db = await getDB();
  await db.add('downloads', { ...download, timestamp: Date.now() });
}

export async function loadDownloads() {
  const db = await getDB();
  const all = await db.getAll('downloads');
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

// ─── Settings ───
export async function saveSetting(key, value) {
  const db = await getDB();
  await db.put('settings', { key, value });
}

export async function loadSettings() {
  const db = await getDB();
  const all = await db.getAll('settings');
  const result = {};
  for (const item of all) {
    result[item.key] = item.value;
  }
  return result;
}

export async function saveAllSettings(settingsObj) {
  const db = await getDB();
  const tx = db.transaction('settings', 'readwrite');
  for (const [key, value] of Object.entries(settingsObj)) {
    await tx.store.put({ key, value });
  }
  await tx.done;
}

// ─── Preferences ───
export async function savePreference(key, value) {
  const db = await getDB();
  await db.put('preferences', { key, value, updatedAt: Date.now() });
}

export async function loadPreference(key) {
  const db = await getDB();
  const entry = await db.get('preferences', key);
  return entry ? entry.value : null;
}

// ─── V2: Intent Memory State ───
export async function saveIntentMemoryState(state) {
  const db = await getDB();
  await db.put('intent_memory_state', { id: 'state', ...state, timestamp: Date.now() });
}

export async function loadIntentMemoryState() {
  const db = await getDB();
  return db.get('intent_memory_state', 'state');
}

// ─── V2: Context Sessions ───
export async function saveSession(session) {
  const db = await getDB();
  await db.put('context_sessions', session);
}

export async function loadSessions(intentId = null) {
  const db = await getDB();
  const all = await db.getAll('context_sessions');
  if (intentId) {
    return all.filter(s => s.intentId === intentId).sort((a, b) => b.timestamp - a.timestamp);
  }
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveTask(task) {
  const db = await getDB();
  await db.put('tasks', { ...task, updatedAt: Date.now() });
}

export async function loadTasks() {
  const db = await getDB();
  return db.getAll('tasks');
}

// ─── Extensions ───
export async function saveExtension(ext) {
  const db = await getDB();
  await db.put('extensions', ext);
}

export async function loadExtensions() {
  const db = await getDB();
  return db.getAll('extensions');
}

export async function deleteExtension(id) {
  const db = await getDB();
  await db.delete('extensions', id);
}
