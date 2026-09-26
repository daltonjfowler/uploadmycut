// Keeps the design in this browser (IndexedDB), so a reloaded or crashed Chromebook tab gets the
// student's work back. Nothing leaves the Chromebook. Every call fails quietly: with site data
// blocked or a private window the page simply starts empty. Like uploadmymodel's plate-store.js.

const DB = 'uploadmycut';
const STORE = 'design';
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** design: { parts, fileName } (plain data). An empty design clears the saved one. */
export async function saveDesign(design) {
  try {
    if (!design.parts.length) await run('readwrite', (s) => s.delete(KEY));
    else await run('readwrite', (s) => s.put({ version: 1, savedAt: Date.now(), ...design }, KEY));
    return true;
  } catch {
    return false;
  }
}

/** The saved design, not yet checked (shared/design.js revivePart checks each part), or null. */
export async function loadDesign() {
  try {
    const saved = await run('readonly', (s) => s.get(KEY));
    return saved?.version === 1 && Array.isArray(saved.parts) ? saved : null;
  } catch {
    return null;
  }
}
