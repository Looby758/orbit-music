/**
 * Your library on this phone: the songs in your Drive music folder (with their details and covers),
 * and orbit-music.json (playlists, likes, play counts), shared with Orbit on your computer.
 * The last list read is kept on the phone, so the app opens straight away and works offline.
 */

import { create } from 'zustand'
import * as db from './db'
import { createJson, download, DriveError, readJson, readStart, scanFolder, whoAmI, writeJson, type DriveFile } from './drive'
import { canUseDrive, quietReconnect, restoreToken, SignInNeeded } from './google'
import { bytesNeeded, readTags } from './id3'
import { applyMusicEdit, emptyMusicData, normalizeMusicData, type MusicData, type MusicEdit } from './musicLibrary'
import { guessFromName, type Song } from './song'
import { parseRemoteFile, sortRemotes, type RemoteFile } from './remote'

export interface Folder {
  id: string
  name: string
}

interface CachedTags {
  modified: string
  title?: string
  artist?: string
  album?: string
  year?: string
  genre?: string
  track?: number
  durationMs?: number
  art: boolean
}

interface LibraryState {
  ready: boolean
  signedIn: boolean
  /** The key to Drive ran out and couldn't be renewed quietly: a tap on Reconnect gets a new one. */
  needsSignIn: boolean
  email: string
  folder: Folder | null
  songs: Song[]
  data: MusicData
  dataFile: DriveFile | null
  /** Reading the folder: songs found, and how many have had their details read. */
  scan: { found: number; read: number } | null
  error: string | null
  /** Song ids downloaded to this phone. */
  downloaded: Set<string>
  /** Song id → how far its download is (0 to 1). */
  downloading: Record<string, number>
  /** Changes made while offline, sent when the phone is back online. */
  pending: MusicEdit[]
  /** Every song is kept on this phone (new ones are downloaded as they're found). */
  keepAll: boolean
  /** Computers with Orbit's phone remote on (from orbit-remote-*.json in the music folder). */
  remotes: RemoteFile[]
}

export const useLibrary = create<LibraryState>(() => ({
  ready: false,
  signedIn: false,
  needsSignIn: false,
  email: '',
  folder: null,
  songs: [],
  data: emptyMusicData(),
  dataFile: null,
  scan: null,
  error: null,
  downloaded: new Set(),
  downloading: {},
  pending: [],
  keepAll: false,
  remotes: []
}))

const set = useLibrary.setState

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** A problem from Drive: running out of sign-in shows Reconnect, anything else shows the message. */
export function report(err: unknown): void {
  if (err instanceof SignInNeeded) set({ needsSignIn: true, signedIn: false })
  else set({ error: message(err) })
}

export async function startLibrary(): Promise<void> {
  const [auth, folder, songs, data, dataFile, email, downloaded, pending, keepAll] = await Promise.all([
    restoreToken(),
    db.get<Folder>('kv', 'folder'),
    db.get<Song[]>('kv', 'songs'),
    db.get<MusicData>('kv', 'data'),
    db.get<DriveFile>('kv', 'dataFile'),
    db.get<string>('kv', 'email'),
    db.keys('songs'),
    db.get<MusicEdit[]>('kv', 'pending'),
    db.get<boolean>('kv', 'keepAll')
  ])
  // The key ran out while the app was closed: go to Google and straight back by itself, rather than
  // waiting for a tap on Reconnect (downloaded songs never need this).
  if (!auth.signedIn && !auth.error && folder && (await quietReconnect())) return
  set({
    ready: true,
    signedIn: auth.signedIn,
    needsSignIn: !auth.signedIn && !!folder,
    error: auth.error ?? null,
    folder: folder ?? null,
    songs: songs ?? [],
    data: data ? normalizeMusicData(data) : emptyMusicData(),
    dataFile: dataFile ?? null,
    email: email ?? '',
    downloaded: new Set(downloaded),
    pending: pending ?? [],
    keepAll: !!keepAll
  })
  if (auth.signedIn) {
    if (!email)
      void whoAmI()
        .then((me) => {
          if (!me.email) return
          set({ email: me.email })
          return db.put('kv', 'email', me.email)
        })
        .catch(() => undefined)
    if (folder) void refreshLibrary()
    void resumeDownloads()
  }
  window.addEventListener('online', () => {
    void sendPending()
    if (canUseDrive()) void resumeDownloads()
  })
  // Back to the app after a while: pick up changes made on the computer.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && canUseDrive() && useLibrary.getState().folder && Date.now() - lastRead > 5 * 60_000) void refreshLibrary()
  })
}

export async function chooseFolder(folder: Folder): Promise<void> {
  await db.put('kv', 'folder', folder)
  await Promise.all([db.del('kv', 'songs'), db.del('kv', 'data'), db.del('kv', 'dataFile')])
  set({ folder, songs: [], data: emptyMusicData(), dataFile: null, error: null })
  await refreshLibrary()
}

let lastRead = 0
let reading: Promise<void> | null = null

/** Reads the folder again: new songs, changed details, and the latest orbit-music.json. */
export function refreshLibrary(): Promise<void> {
  reading ??= readLibrary().finally(() => (reading = null))
  return reading
}

async function readLibrary(): Promise<void> {
  const folder = useLibrary.getState().folder
  if (!folder) return
  set({ scan: { found: 0, read: 0 }, error: null })
  try {
    const scan = await scanFolder(folder.id, (found) => set({ scan: { found, read: 0 } }))
    // The playlists first: they're quick, and they're what you came for.
    await readData(scan.data)
    void readRemotes(scan.remotes)
    const old = new Map(useLibrary.getState().songs.map((s) => [s.id, s]))
    const songs: Song[] = []
    const toRead: typeof scan.songs = []
    for (const f of scan.songs) {
      const cached = await db.get<CachedTags>('tags', f.id)
      if (cached && cached.modified === f.modifiedTime) songs.push(toSong(f, cached))
      else toRead.push(f)
    }
    let read = songs.length
    set({ scan: { found: scan.songs.length, read } })
    const publish = (): void => set({ songs: [...songs].concat(toRead.filter((f) => !songs.some((s) => s.id === f.id)).map((f) => old.get(f.id) ?? toSong(f, null))) })
    publish()
    // A few at a time, so a big folder doesn't take all evening.
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < toRead.length) {
        const f = toRead[next++]
        const tags = await readSongTags(f).catch((err) => {
          if (err instanceof SignInNeeded) throw err
          return null
        })
        songs.push(toSong(f, tags))
        read++
        if (read % 10 === 0 || read === scan.songs.length) {
          set({ scan: { found: scan.songs.length, read } })
          publish()
        }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    set({ songs, scan: null })
    lastRead = Date.now()
    await db.put('kv', 'songs', songs)
    await keepMovedDownloads(old, songs)
    if (useLibrary.getState().keepAll) downloadSongs(songs)
  } catch (err) {
    set({ scan: null })
    report(err)
  }
}

function toSong(f: DriveFile & { path: string }, tags: CachedTags | null): Song {
  const guess = guessFromName(f.path)
  return {
    id: f.id,
    path: f.path,
    title: tags?.title || guess.title,
    artist: tags?.artist || guess.artist,
    album: tags?.album || '',
    track: tags?.track || guess.track,
    durationMs: tags?.durationMs ?? 0,
    art: !!tags?.art,
    added: f.modifiedTime ? Date.parse(f.modifiedTime) : undefined,
    year: tags?.year,
    genre: tags?.genre,
    size: Number(f.size) || 0,
    modified: f.modifiedTime ?? ''
  }
}

/** A song's details and cover, from the start of the file. */
async function readSongTags(f: DriveFile & { path: string }): Promise<CachedTags> {
  const size = Number(f.size) || 0
  let head = await readStart(f.id, Math.min(65536, size || 65536))
  const need = bytesNeeded(head)
  if (need > head.length && head.length < size) head = await readStart(f.id, Math.min(need, size, 12_000_000))
  const t = f.path.toLowerCase().endsWith('.mp3') ? readTags(head, size) : {}
  const cached: CachedTags = { modified: f.modifiedTime ?? '', title: t.title, artist: t.artist, album: t.album, year: t.year, genre: t.genre, track: t.track, durationMs: t.durationMs, art: !!t.picture }
  if (t.picture) await db.put('art', f.id, new Blob([t.picture.data as BlobPart], { type: t.picture.mime }))
  else await db.del('art', f.id)
  await db.put('tags', f.id, cached)
  return cached
}

/** When the song's real length is known (from playing it), keep it. */
export function setDuration(song: Song, ms: number): void {
  if (!ms || Math.abs(song.durationMs - ms) < 1500) return
  const songs = useLibrary.getState().songs.map((s) => (s.id === song.id ? { ...s, durationMs: ms } : s))
  set({ songs })
  void db.get<CachedTags>('tags', song.id).then((t) => t && db.put('tags', song.id, { ...t, durationMs: ms }))
  void db.put('kv', 'songs', songs)
}

/** Where Orbit's phone remote is on each computer (quietly skipped if a file can't be read). */
async function readRemotes(files: DriveFile[]): Promise<void> {
  const found = await Promise.all(files.map((f) => readJson(f.id).then(parseRemoteFile, () => null)))
  set({ remotes: sortRemotes(found.filter((r): r is RemoteFile => !!r)) })
}

async function readData(file: DriveFile | null): Promise<void> {
  if (!file) {
    set({ dataFile: null })
    await db.del('kv', 'dataFile')
    await sendPending()
    return
  }
  const data = normalizeMusicData(await readJson(file.id))
  // Changes not sent yet still show.
  const shown = useLibrary.getState().pending.reduce(applyMusicEdit, data)
  set({ data: shown, dataFile: file })
  await Promise.all([db.put('kv', 'data', shown), db.put('kv', 'dataFile', file)])
  await sendPending()
}

// ---------- Changes (likes, plays, playlists), shared with the computer ----------

let sending: Promise<void> = Promise.resolve()

/**
 * Makes a change: shown straight away, then written to orbit-music.json on Drive (to the file as
 * it is right then, so a change the computer just made isn't lost). Offline, it waits.
 */
export function editMusic(edit: MusicEdit): void {
  const state = useLibrary.getState()
  const pending = [...state.pending, edit]
  const data = applyMusicEdit(state.data, edit)
  set({ data, pending })
  void db.put('kv', 'data', data)
  void db.put('kv', 'pending', pending)
  void sendPending()
}

function sendPending(): Promise<void> {
  sending = sending.then(async () => {
    const { pending, folder, dataFile } = useLibrary.getState()
    if (!pending.length || !folder || !canUseDrive() || !navigator.onLine) return
    try {
      const latest = dataFile ? normalizeMusicData(await readJson(dataFile.id)) : emptyMusicData()
      const data = pending.reduce(applyMusicEdit, latest)
      const file = dataFile ? await writeJson(dataFile.id, data) : await createJson(folder.id, 'orbit-music.json', data)
      // Changes made while this was being sent stay waiting.
      const left = useLibrary.getState().pending.slice(pending.length)
      set({ dataFile: { ...dataFile, ...file }, pending: left, data: left.reduce(applyMusicEdit, data) })
      await Promise.all([db.put('kv', 'pending', left), db.put('kv', 'dataFile', { ...dataFile, ...file }), db.put('kv', 'data', useLibrary.getState().data)])
    } catch (err) {
      if (err instanceof DriveError && err.status === 404 && dataFile) {
        // orbit-music.json was deleted: make it again.
        set({ dataFile: null })
        await db.del('kv', 'dataFile')
      } else report(err)
    }
  })
  return sending
}

// ---------- Covers ----------

const artUrls = new Map<string, Promise<string | null>>()

/** A song's cover as a picture address, or null. */
export function artUrl(song: Song): Promise<string | null> {
  if (!song.art) return Promise.resolve(null)
  let url = artUrls.get(song.id)
  if (!url) {
    url = db.get<Blob>('art', song.id).then((b) => (b ? URL.createObjectURL(b) : null))
    artUrls.set(song.id, url)
  }
  return url
}

// ---------- Downloads for offline ----------


let downloadQueue: Promise<void> = Promise.resolve()

/**
 * A song's file in Drive can come back with a new id (put back in the folder by the computer, or
 * moved out and in again). Its download on this phone is still the same song, so it moves to the
 * new id rather than being thrown away and fetched again. Downloads of songs really gone from the
 * folder are removed.
 */
async function keepMovedDownloads(old: Map<string, Song>, songs: Song[]): Promise<void> {
  const { move, remove } = movedDownloads(old, songs, useLibrary.getState().downloaded)
  for (const [from, to] of move) await moveDownload(from, to).catch(() => removeDownload(from))
  for (const id of remove) await removeDownload(id)
}

/** Which downloads moved to a new id (same path, same size), and which songs are gone for good. */
export function movedDownloads(old: Map<string, Song>, songs: Song[], downloaded: Set<string>): { move: [string, string][]; remove: string[] } {
  const present = new Set(songs.map((s) => s.id))
  const byPath = new Map(songs.filter((s) => !downloaded.has(s.id)).map((s) => [s.path.toLowerCase(), s]))
  const move: [string, string][] = []
  const remove: string[] = []
  for (const id of downloaded) {
    if (present.has(id)) continue
    const was = old.get(id)
    const now = was && byPath.get(was.path.toLowerCase())
    if (was && now && (!was.size || !now.size || was.size === now.size)) {
      byPath.delete(was.path.toLowerCase())
      move.push([id, now.id])
    } else remove.push(id)
  }
  return { move, remove }
}

async function moveDownload(from: string, to: string): Promise<void> {
  const blob = await db.get<Blob>('songs', from)
  if (!blob) return removeDownload(from)
  await db.put('songs', to, blob)
  await db.del('songs', from)
  const downloaded = new Set(useLibrary.getState().downloaded)
  downloaded.delete(from)
  downloaded.add(to)
  set({ downloaded })
}

/** Songs asked to be downloaded that haven't finished yet (kept, so they carry on after a reconnect or reopening). */
const saveWanted = (): Promise<void> => db.put('kv', 'downloadsLeft', Object.keys(useLibrary.getState().downloading))

/** Carries on downloads that were stopped (by running out of sign-in, losing signal, or closing the app). */
async function resumeDownloads(): Promise<void> {
  const left = (await db.get<string[]>('kv', 'downloadsLeft')) ?? []
  if (!left.length) return
  const ids = new Set(left)
  downloadSongs(useLibrary.getState().songs.filter((s) => ids.has(s.id)))
}

/** Downloads songs to this phone, one at a time. */
export function downloadSongs(songs: Song[]): void {
  db.keepStorage()
  const { downloaded, downloading } = useLibrary.getState()
  const todo = songs.filter((s) => !downloaded.has(s.id) && !(s.id in downloading))
  if (!todo.length) return
  set({ downloading: { ...downloading, ...Object.fromEntries(todo.map((s) => [s.id, 0])) } })
  void saveWanted()
  for (const song of todo) {
    downloadQueue = downloadQueue.then(async () => {
      if (!(song.id in useLibrary.getState().downloading)) return
      try {
        const blob = await download(song.id, (done) => set({ downloading: { ...useLibrary.getState().downloading, [song.id]: done } }))
        await db.put('songs', song.id, blob)
        set({ downloaded: new Set([...useLibrary.getState().downloaded, song.id]) })
      } catch (err) {
        report(err)
        // Without a sign-in (or signal) the rest can't download either: they carry on after
        // reconnecting, or next time the app opens.
        if (err instanceof SignInNeeded || !navigator.onLine) return stopDownloads(true)
      }
      const { [song.id]: _, ...rest } = useLibrary.getState().downloading
      void _
      set({ downloading: rest })
      void saveWanted()
    })
  }
}

/** Keeps every song on this phone, so it all plays with no internet (or stops adding new ones). */
export async function setKeepAll(on: boolean): Promise<void> {
  set({ keepAll: on })
  await db.put('kv', 'keepAll', on)
  if (on) downloadSongs(useLibrary.getState().songs)
  else stopDownloads(false)
}

export async function removeDownload(id: string): Promise<void> {
  await db.del('songs', id)
  const downloaded = new Set(useLibrary.getState().downloaded)
  downloaded.delete(id)
  const { [id]: _, ...downloading } = useLibrary.getState().downloading
  void _
  set({ downloaded, downloading })
  void saveWanted()
}

export function removeDownloads(songs: Song[]): void {
  for (const s of songs) void removeDownload(s.id)
}

/** Stops downloads that haven't finished: for now (`later`, they carry on next time), or for good. */
function stopDownloads(later: boolean): void {
  set({ downloading: {} })
  if (!later) void saveWanted()
}

/** Stops downloads that haven't finished, for good. */
export function cancelDownloads(): void {
  stopDownloads(false)
}

export const downloadedBlob = (id: string): Promise<Blob | undefined> => db.get<Blob>('songs', id)

/** Leaves the folder: forgets the song list (downloads too). */
export async function forgetFolder(): Promise<void> {
  await Promise.all(['folder', 'songs', 'data', 'dataFile', 'pending', 'downloadsLeft'].map((k) => db.del('kv', k)))
  await db.clear('songs')
  set({ folder: null, songs: [], data: emptyMusicData(), dataFile: null, pending: [], downloaded: new Set(), downloading: {} })
}
