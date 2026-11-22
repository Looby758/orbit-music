/**
 * Google Drive: finding your music folder, listing the songs in it (and its folders), reading the
 * start of a song for its details, fetching a whole song to play, and reading and writing
 * orbit-music.json.
 */

import { accessToken, SignInNeeded, tokenRejected } from './google'
import { isAudio } from './song'
import { isRemoteFileName } from './remote'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const FOLDER = 'application/vnd.google-apps.folder'
export const DATA_FILE = 'orbit-music.json'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
  parents?: string[]
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken()}`)
  let res: Response
  try {
    res = await fetch(url, { ...init, headers })
  } catch {
    throw new DriveError('Couldn’t reach Google Drive. Check you’re online.', 0)
  }
  if (res.status === 401) {
    tokenRejected()
    throw new SignInNeeded()
  }
  if (!res.ok && res.status !== 206) {
    let reason = ''
    try {
      reason = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''
    } catch {
      // No details.
    }
    if (res.status === 404) throw new DriveError('Google Drive couldn’t find that. It may have been moved or deleted.', 404)
    if (res.status === 403 && /rate|quota/i.test(reason)) throw new DriveError('Google Drive is busy. Try again in a minute.', 403)
    throw new DriveError(reason || `Google Drive said ${res.status}.`, res.status)
  }
  return res
}

const FIELDS = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)'

/** Every file matching a Drive search, all pages. */
async function list(q: string, extra: Record<string, string> = {}): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  let page = ''
  do {
    const params = new URLSearchParams({ q, fields: FIELDS, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...extra, ...(page ? { pageToken: page } : {}) })
    const body = (await (await call(`${API}/files?${params}`)).json()) as { files?: DriveFile[]; nextPageToken?: string }
    out.push(...(body.files ?? []))
    page = body.nextPageToken ?? ''
  } while (page)
  return out
}

const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** Folders inside a folder ('root' is My Drive), by name. */
export async function foldersIn(parent: string): Promise<DriveFile[]> {
  const found = await list(`${quote(parent)} in parents and mimeType = '${FOLDER}' and trashed = false`, { orderBy: 'name' })
  return found
}

/** Folders anywhere in your Drive whose name has these words (finds folders under "Computers" too). */
export async function findFolders(name: string): Promise<DriveFile[]> {
  const found = await list(`name contains ${quote(name.trim())} and mimeType = '${FOLDER}' and trashed = false`, { orderBy: 'name' })
  return found.slice(0, 50)
}

export async function fileInfo(id: string): Promise<DriveFile> {
  return (await (await call(`${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,parents&supportsAllDrives=true`)).json()) as DriveFile
}

/** A folder's id from its Drive link ("…/folders/<id>"), or the id itself. */
export function folderIdFromLink(text: string): string | null {
  const t = text.trim()
  const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(t) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(t)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{20,}$/.test(t) ? t : null
}

export interface FolderScan {
  /** Songs, with their path inside the music folder ("Albums/Song.mp3"). */
  songs: (DriveFile & { path: string })[]
  /** orbit-music.json, if there is one. */
  data: DriveFile | null
  /** orbit-remote-<computer>.json: where Orbit's phone remote is on each computer. */
  remotes: DriveFile[]
}

/** Everything in the music folder and the folders inside it. */
export async function scanFolder(rootId: string, onProgress?: (found: number) => void): Promise<FolderScan> {
  const songs: FolderScan['songs'] = []
  let data: DriveFile | null = null
  const remotes: DriveFile[] = []
  const queue: { id: string; prefix: string }[] = [{ id: rootId, prefix: '' }]
  const seen = new Set<string>()
  while (queue.length) {
    // A few folders at a time.
    const batch = queue.splice(0, 6)
    const results = await Promise.all(batch.map((f) => list(`${quote(f.id)} in parents and trashed = false`).then((files) => ({ f, files }))))
    for (const { f, files } of results) {
      for (const file of files) {
        if (file.mimeType === FOLDER) {
          if (!seen.has(file.id)) {
            seen.add(file.id)
            queue.push({ id: file.id, prefix: `${f.prefix}${file.name}/` })
          }
        } else if (!f.prefix && file.name === DATA_FILE) {
          data = file
        } else if (!f.prefix && isRemoteFileName(file.name)) {
          remotes.push(file)
        } else if (isAudio(file.name)) {
          songs.push({ ...file, path: `${f.prefix}${file.name}` })
        }
      }
    }
    onProgress?.(songs.length)
  }
  return { songs, data, remotes }
}

/** The first bytes of a file (for a song's details). */
export async function readStart(id: string, bytes: number): Promise<Uint8Array> {
  const res = await call(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: { Range: `bytes=0-${bytes - 1}` } })
  return new Uint8Array(await res.arrayBuffer())
}

/** A whole file, with how far along it is (0 to 1). */
export async function download(id: string, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<Blob> {
  const res = await call(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { signal })
  const total = Number(res.headers.get('Content-Length')) || 0
  if (!res.body || !onProgress || !total) return res.blob()
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    onProgress(Math.min(1, got / total))
  }
  return new Blob(parts as BlobPart[], { type: res.headers.get('Content-Type') ?? 'audio/mpeg' })
}

export async function readJson(id: string): Promise<unknown> {
  return (await call(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { cache: 'no-store' })).json()
}

/** Writes over a file's contents. */
export async function writeJson(id: string, value: unknown): Promise<DriveFile> {
  const res = await call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=id,name,mimeType,modifiedTime`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value, null, 2)
  })
  return (await res.json()) as DriveFile
}

/** Makes a new JSON file in a folder. */
export async function createJson(folderId: string, name: string, value: unknown): Promise<DriveFile> {
  const boundary = `orbit${Math.random().toString(36).slice(2)}`
  const body = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ name, parents: [folderId], mimeType: 'application/json' }), `--${boundary}`, 'Content-Type: application/json', '', JSON.stringify(value, null, 2), `--${boundary}--`, ''].join('\r\n')
  const res = await call(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,modifiedTime`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  })
  return (await res.json()) as DriveFile
}

/** The signed-in account's email address (to show, and to skip choosing an account next time). */
export async function whoAmI(): Promise<{ email: string; name: string }> {
  const body = (await (await call(`${API}/about?fields=user(emailAddress,displayName)`)).json()) as { user?: { emailAddress?: string; displayName?: string } }
  return { email: body.user?.emailAddress ?? '', name: body.user?.displayName ?? '' }
}
