export function download(bytes: Uint8Array, name: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function selectFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('shanhe-editor', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('draft');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
export async function saveDraft(bytes: Uint8Array) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('draft', 'readwrite');
      tx.objectStore('draft').put({ bytes, date: Date.now() }, 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function loadDraft(): Promise<{ bytes: Uint8Array; date: number } | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('draft', 'readonly'),
        request = tx.objectStore('draft').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
