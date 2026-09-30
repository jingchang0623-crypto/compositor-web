// Unsaved work kept in the browser (IndexedDB), a few seconds after each change, so a closed tab or a crash loses
// nothing. Each project is stored as its package's files; only files whose pixels changed are written again.

import type { PixelSource } from '../engine/compositor'
import { imageFiles, packageProject, type SaveInput } from './save'
import type { PackageFiles } from './comp'

const DB = 'artps'
const PROJECTS = 'projects'
const FILES = 'files'

export interface AutosaveEntry {
  key: string
  name: string
  savedAt: number
  width: number
  height: number
  layers: number
  /** A small JPEG of the document, for the recovery list. */
  thumbnail?: Blob
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** What was last written for each project: file path → the pixels it came from. */
const written = new Map<string, Map<string, PixelSource | string>>()

/** Writes a project's current state, sending only what changed since its last write. */
export async function autosave(key: string, name: string, input: SaveInput, thumbnail?: Blob) {
  const before = written.get(key) ?? new Map<string, PixelSource | string>()
  // Images are identified by their (immutable) pixel source: unchanged ones aren't even encoded.
  const files = await packageProject(input, undefined, (file, source) => before.get(`images/${file}`) === source)
  const after = new Map<string, PixelSource | string>()
  const manifest = new TextDecoder().decode(files.get('manifest.json'))
  const db = await open()
  const tx = db.transaction([PROJECTS, FILES], 'readwrite')
  const store = tx.objectStore(FILES)
  for (const [file] of imageFiles(input.doc)) after.set(`images/${file}`, input.assets.get(file)!)
  after.set('manifest.json', manifest)
  for (const [path, data] of files) store.put(new Blob([data as BlobPart]), `${key}/${path}`)
  for (const path of before.keys()) if (!after.has(path)) store.delete(`${key}/${path}`)
  const entry: AutosaveEntry = {
    key, name, savedAt: Date.now(), width: input.doc.width, height: input.doc.height, layers: input.doc.layers.length, thumbnail,
  }
  tx.objectStore(PROJECTS).put({ ...entry, paths: [...after.keys()] })
  await done(tx)
  db.close()
  written.set(key, after)
}

export async function listAutosaves(): Promise<AutosaveEntry[]> {
  try {
    const db = await open()
    const all = await request(db.transaction(PROJECTS).objectStore(PROJECTS).getAll()) as AutosaveEntry[]
    db.close()
    return all.sort((a, b) => b.savedAt - a.savedAt)
  } catch {
    return [] // Private windows and blocked storage: nothing to recover.
  }
}

export async function readAutosave(key: string): Promise<PackageFiles> {
  const db = await open()
  const tx = db.transaction([PROJECTS, FILES])
  const entry = await request(tx.objectStore(PROJECTS).get(key)) as AutosaveEntry & { paths: string[] }
  const files: PackageFiles = new Map()
  for (const path of entry?.paths ?? []) {
    const blob = await request(tx.objectStore(FILES).get(`${key}/${path}`)) as Blob | undefined
    if (blob) files.set(path, blob)
  }
  db.close()
  return files
}

export async function discardAutosave(key: string) {
  try {
    const db = await open()
    const tx = db.transaction([PROJECTS, FILES], 'readwrite')
    const entry = await request(tx.objectStore(PROJECTS).get(key)) as { paths?: string[] } | undefined
    for (const path of entry?.paths ?? []) tx.objectStore(FILES).delete(`${key}/${path}`)
    tx.objectStore(PROJECTS).delete(key)
    await done(tx)
    db.close()
  } catch { /* Nothing stored. */ }
  written.delete(key)
}

/** Forgets what was written, so the next autosave of `key` (a reopened recovery) writes everything under it again. */
export function adopt(key: string, files: PackageFiles, assets: ReadonlyMap<string, PixelSource>) {
  const map = new Map<string, PixelSource | string>()
  for (const path of files.keys()) {
    if (path.startsWith('images/')) { const s = assets.get(path.slice(7)); if (s) map.set(path, s) }
  }
  written.set(key, map)
}
