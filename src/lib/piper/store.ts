// Tiny persistent byte store on IndexedDB. Unlike Cache Storage it also works over plain http
// (e.g. the app opened on a tablet via a LAN address) and inside workers.
const DB = 'jackapp-speech'
const STORE = 'bytes'

let db: Promise<IDBDatabase | null> | undefined

function open(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null) // private mode etc.: work without persistence
  })
  return db
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return open().then(
    (d) =>
      new Promise((resolve) => {
        if (!d) return resolve(undefined)
        try {
          const req = op(d.transaction(STORE, mode).objectStore(STORE))
          req.onsuccess = () => resolve(req.result as T)
          req.onerror = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

export const getBytes = (key: string) => run<ArrayBuffer>('readonly', (s) => s.get(key))
export const putBytes = (key: string, bytes: ArrayBuffer) => run<void>('readwrite', (s) => s.put(bytes, key))
