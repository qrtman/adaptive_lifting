export const DB_NAME = 'adaptive_lifting_db';
const LEGACY_DB_NAME = 'obsidian_kinetic_db';
export const DB_VERSION = 1;

let openPromise: Promise<IDBDatabase> | null = null;

export interface SyncMutation {
  mutation_id: string;
  client_device_id: string;
  workout_id?: string;
  entity_type: string;
  entity_id: string;
  field_path: string; // 'ALL' or specific field
  fields: Record<string, any>;
  updated_at: string;
  status: 'PENDING' | 'IN_FLIGHT' | 'ACKED' | 'REJECTED' | 'CONFLICTED';
  retry_count: number;
}

function ensureStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('snapshots')) {
    db.createObjectStore('snapshots', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('mutations')) {
    db.createObjectStore('mutations', { keyPath: 'mutation_id' });
  }
  if (!db.objectStoreNames.contains('tombstones')) {
    db.createObjectStore('tombstones', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('metadata')) {
    db.createObjectStore('metadata', { keyPath: 'key' });
  }
}

function openNamed(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = (event: any) => {
      ensureStores(event.target.result);
    };
    request.onsuccess = (event: any) => resolve(event.target.result);
    request.onerror = (event: any) => reject(event.target.error);
  });
}

function readAll(db: IDBDatabase, storeName: string): Promise<any[]> {
  if (!db.objectStoreNames.contains(storeName)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function writeAll(db: IDBDatabase, storeName: string, records: any[]): Promise<void> {
  if (!db.objectStoreNames.contains(storeName) || records.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    records.forEach((record) => store.put(record));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function migrateLegacyIndexedDB(): Promise<void> {
  if (typeof indexedDB.databases !== 'function') return;
  const names = (await indexedDB.databases()).map((entry) => entry.name || '');
  if (!names.includes(LEGACY_DB_NAME)) return;

  const source = await openNamed(LEGACY_DB_NAME);
  const dest = await openNamed(DB_NAME);
  try {
    const existingSnapshots = await readAll(dest, 'snapshots');
    if (existingSnapshots.length === 0) {
      for (const storeName of ['snapshots', 'mutations', 'tombstones', 'metadata']) {
        const records = await readAll(source, storeName);
        await writeAll(dest, storeName, records);
      }
    }
  } finally {
    source.close();
    dest.close();
  }

  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export function openDB(): Promise<IDBDatabase> {
  if (!openPromise) {
    openPromise = migrateLegacyIndexedDB()
      .then(() => openNamed(DB_NAME))
      .catch((err) => {
        openPromise = null;
        throw err;
      });
  }
  return openPromise;
}

export async function saveMutation(mutation: SyncMutation): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const req = store.put(mutation);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingMutations(): Promise<SyncMutation[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readonly');
    const store = tx.objectStore('mutations');
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result as SyncMutation[];
      resolve(all.filter(m => m.status === 'PENDING' || m.status === 'IN_FLIGHT'));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function updateMutationStatus(mutation_id: string, status: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const req = store.get(mutation_id);
    req.onsuccess = () => {
      if (req.result) {
        req.result.status = status;
        store.put(req.result);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(id: string, data: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    const store = tx.objectStore('snapshots');
    const req = store.put({ id, data, updated_at: new Date().toISOString() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getSnapshot(id: string): Promise<any | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const store = tx.objectStore('snapshots');
    const req = store.get(id);
    req.onsuccess = () => {
      resolve(req.result ? req.result.data : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearSnapshot(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    const req = tx.objectStore('snapshots').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function evictOldSyncedData(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const req = store.openCursor();
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);
    
    req.onsuccess = (event: any) => {
      const cursor = event.target.result;
      if (cursor) {
        const m = cursor.value;
        const updated = new Date(m.updated_at);
        if ((m.status === 'ACKED' || m.status === 'REJECTED') && updated < cutoff) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

