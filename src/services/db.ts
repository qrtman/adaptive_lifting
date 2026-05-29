export const DB_NAME = 'obsidian_kinetic_db';
export const DB_VERSION = 1;

export interface SyncMutation {
  mutation_id: string;
  client_device_id: string;
  entity_type: string;
  entity_id: string;
  field_path: string; // 'ALL' or specific field
  fields: Record<string, any>;
  updated_at: string;
  status: 'PENDING' | 'IN_FLIGHT' | 'ACKED' | 'REJECTED' | 'CONFLICTED';
  retry_count: number;
}

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
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
    };
    request.onsuccess = (event: any) => resolve(event.target.result);
    request.onerror = (event: any) => reject(event.target.error);
  });
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

