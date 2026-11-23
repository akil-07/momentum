/* ═════════ tiny IndexedDB key-value store for big, re-fetchable caches (Codeforces problemset, submission list) ═════════
   localStorage caps at ~5 MB per origin and is shared with the planner state, so the multi-MB caches live here.
   No IndexedDB (node tests, some private modes): an in-memory map, and `idbOk()` says so — callers keep their own fallback. */

const DB = 'momentum', STORE = 'kv'
const mem = new Map<string, unknown>()
let dbp: Promise<IDBDatabase | null> | null = null

/** how long an open may take: some engines (WebKit's first-load hang, broken WebView profiles) never answer at all, and the
 *  trainer's start waits on this — past it, the caches run from memory/localStorage for this session */
export const OPEN_TIMEOUT = 3000
function open(): Promise<IDBDatabase | null> {
  return dbp ||= new Promise(res0 => {
    let done = false
    const res = (db: IDBDatabase | null) => { if (done) { db?.close(); return } done = true; clearTimeout(timer); res0(db) }
    const timer = setTimeout(() => res(null), OPEN_TIMEOUT)
    try {
      if (typeof indexedDB === 'undefined') return res(null)
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE) }
      r.onsuccess = () => res(r.result) // a late answer (after the timeout) is closed: this session already went without
      r.onerror = () => res(null); r.onblocked = () => res(null)
    } catch { res(null) }
  })
}
/** test hook: forget the opened db so the next call opens again */
export const _idbTest = { reset() { dbp = null; mem.clear() } }
function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(db => new Promise<T>((res, rej) => {
    if (!db) return rej(new Error('no-idb'))
    try {
      const t = db.transaction(STORE, mode), q = f(t.objectStore(STORE))
      // resolve on commit (not on request success), so a write is really on disk before a caller drops the old copy
      t.oncomplete = () => res(q.result as T); t.onerror = t.onabort = () => rej(t.error || new Error('idb'))
    } catch (e) { rej(e) }
  }))
}

/** true when values really persist (IndexedDB opened); false = in-memory only */
export const idbOk = () => open().then(db => !!db)
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try { return await tx<T | undefined>('readonly', s => s.get(key)) } catch { return mem.get(key) as T | undefined }
}
/** resolves true when the value reached IndexedDB (false: kept in memory only) */
export async function idbSet(key: string, val: unknown): Promise<boolean> {
  try { await tx('readwrite', s => s.put(val, key)); mem.delete(key); return true } catch { mem.set(key, val); return false }
}
export async function idbDel(key: string): Promise<void> {
  mem.delete(key)
  try { await tx('readwrite', s => s.delete(key)) } catch { /* nothing stored */ }
}
