/**
 * This phone's own storage (IndexedDB): your settings, the list of songs last read from Drive (so
 * the app opens straight away, and works with no signal), song details already read, covers, and
 * songs downloaded for offline play.
 */

const NAME = 'orbit-music'
const STORES = ['kv', 'tags', 'art', 'songs'] as const
export type Store = (typeof STORES)[number]

let opening: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(NAME, 1)
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
    }
    req.onsuccess = () => {
      // The phone can close the storage under the app (iPhones do after a while in the background):
      // open it again next time rather than failing.
      req.result.onclose = () => (opening = null)
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  }).catch((err) => {
    opening = null
    throw err
  })
  return opening
}

function once<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        tx.oncomplete = () => resolve(req.result as T)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
  )
}

/** Runs one request; if the connection to the storage was lost, opens it again and tries once more. */
function run<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return once<T>(store, mode, fn).catch((err: unknown) => {
    const name = (err as DOMException | null)?.name
    if (name !== 'InvalidStateError' && name !== 'UnknownError') throw err
    opening = null
    return once<T>(store, mode, fn)
  })
}

export const get = <T>(store: Store, key: string): Promise<T | undefined> => run<T | undefined>(store, 'readonly', (s) => s.get(key))
export const put = (store: Store, key: string, value: unknown): Promise<void> => run<unknown>(store, 'readwrite', (s) => s.put(value, key)).then(() => undefined)
export const del = (store: Store, key: string): Promise<void> => run<unknown>(store, 'readwrite', (s) => s.delete(key)).then(() => undefined)
export const keys = (store: Store): Promise<string[]> => run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()).then((k) => k.map(String))
export const clear = (store: Store): Promise<void> => run<unknown>(store, 'readwrite', (s) => s.clear()).then(() => undefined)

/** Asks the phone not to clear downloaded songs when it's short of space. */
export function keepStorage(): void {
  void navigator.storage?.persist?.().catch(() => undefined)
}
