// Internal IndexedDB storage for Study source files.
// Files imported into Study notebooks are preserved here permanently,
// so they remain accessible even if the user removes or deletes them from disk.

const DB_NAME = "nanami-study-sources";
const DB_VERSION = 1;
const STORE_NAME = "source-files";

function openStudyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export type StoredSourceFile = {
  id: string; // sourceId
  name: string;
  mimeType: string;
  blob: Blob;
  savedAt: number;
};

export async function storeSourceFile(sourceId: string, name: string, mimeType: string, blob: Blob): Promise<void> {
  try {
    const db = await openStudyDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const record: StoredSourceFile = { id: sourceId, name, mimeType, blob, savedAt: Date.now() };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("Failed to store source file in IndexedDB:", e);
  }
}

export async function getStoredSourceFile(sourceId: string): Promise<StoredSourceFile | null> {
  try {
    const db = await openStudyDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(sourceId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function removeStoredSourceFile(sourceId: string): Promise<void> {
  try {
    const db = await openStudyDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(sourceId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {}
}

export function downloadSourceFile(name: string, content: Blob | string, mimeType = "text/plain") {
  const blob = typeof content === "string" ? new Blob([content], { type: mimeType }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
