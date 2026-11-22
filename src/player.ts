/**
 * Playing your music: the queue, shuffle and repeat, and the phone's lock screen and headphone
 * controls. A song comes from this phone if it's downloaded, otherwise it's fetched from Drive
 * (the next song is fetched while this one plays, so it starts straight away).
 */

import { create } from 'zustand'
import { artUrl, downloadedBlob, editMusic, report, setDuration, useLibrary } from './library'
import { download } from './drive'
import * as db from './db'
import type { Song } from './song'

export type Repeat = 'off' | 'all' | 'one'

interface PlayerState {
  queue: Song[]
  index: number
  playing: boolean
  /** Fetching the song from Drive: how far (0 to 1), or null. */
  loading: number | null
  position: number
  duration: number
  shuffle: boolean
  repeat: Repeat
  error: string | null
}

export const usePlayer = create<PlayerState>(() => ({ queue: [], index: 0, playing: false, loading: null, position: 0, duration: 0, shuffle: false, repeat: 'off', error: null }))
const set = usePlayer.setState
const get = usePlayer.getState

const audio = new Audio()
audio.preload = 'auto'
/** The order before shuffling, to go back to. */
let ordered: Song[] = []

// ---------- Getting a song's sound ----------

/** Songs fetched from Drive and kept in memory for a while (this one, the next one, the last one). */
const fetched = new Map<string, Promise<string>>()

function sound(song: Song, onProgress?: (done: number) => void): Promise<string> {
  let url = fetched.get(song.id)
  if (!url) {
    url = (async () => {
      const saved = await downloadedBlob(song.id)
      const blob = saved ?? (await download(song.id, onProgress))
      return URL.createObjectURL(blob)
    })()
    url.catch(() => fetched.delete(song.id))
    fetched.set(song.id, url)
    // Keep only a few in memory.
    while (fetched.size > 4) {
      const [oldest, gone] = fetched.entries().next().value as [string, Promise<string>]
      fetched.delete(oldest)
      void gone.then((u) => setTimeout(() => URL.revokeObjectURL(u), 60_000)).catch(() => undefined)
    }
  }
  return url
}

function prefetchNext(): void {
  const { queue, index, repeat } = get()
  const next = queue[index + 1] ?? (repeat === 'all' ? queue[0] : undefined)
  if (next && next.id !== queue[index]?.id) void sound(next).catch(() => undefined)
}

// ---------- Playing ----------

let playId = 0
/** This play of the song has been counted (after 30 seconds, as on the computer). */
let counted = false

async function start(index: number, autoplay = true): Promise<void> {
  const song = get().queue[index]
  if (!song) return
  const id = ++playId
  counted = false
  set({ index, position: 0, duration: song.durationMs / 1000, error: null, loading: 0 })
  updateMediaSession(song)
  try {
    const url = await sound(song, (done) => id === playId && set({ loading: done }))
    if (id !== playId) return
    audio.src = url
    set({ loading: null })
    if (autoplay) await audio.play()
    prefetchNext()
  } catch (err) {
    if (id !== playId) return
    set({ loading: null, playing: false })
    if ((err as Error)?.name === 'NotAllowedError') return
    report(err)
    set({ error: err instanceof Error ? err.message : String(err) })
  }
}

const shuffled = <T>(list: T[]): T[] => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Plays a list of songs from this one (or shuffled). */
export function playSongs(songs: Song[], from: number | 'shuffle'): void {
  if (!songs.length) return
  ordered = songs
  if (from === 'shuffle') {
    set({ shuffle: true, queue: shuffled(songs) })
    void start(0)
  } else if (get().shuffle) {
    const first = songs[from]
    set({ queue: [first, ...shuffled(songs.filter((_, i) => i !== from))] })
    void start(0)
  } else {
    set({ queue: songs })
    void start(from)
  }
}

export function toggle(): void {
  if (!get().queue.length) return
  if (!audio.src) return void start(get().index).then(() => resumeAt && ((audio.currentTime = resumeAt), (resumeAt = 0)))
  if (audio.paused) void audio.play().catch(() => undefined)
  else audio.pause()
}

export function next(): void {
  const { index, queue } = get()
  if (!queue.length) return
  void start(index + 1 < queue.length ? index + 1 : 0)
}

export function previous(): void {
  const { index, queue } = get()
  if (audio.currentTime > 3 || index === 0) {
    audio.currentTime = 0
    return
  }
  void start(Math.max(0, Math.min(queue.length - 1, index - 1)))
}

export function seek(seconds: number): void {
  if (Number.isFinite(seconds)) audio.currentTime = Math.max(0, seconds)
  set({ position: audio.currentTime })
}

export function jump(index: number): void {
  void start(index)
}

export function toggleShuffle(): void {
  const { shuffle, queue, index } = get()
  const song = queue[index]
  if (!shuffle) {
    ordered = queue
    set({ shuffle: true, queue: song ? [song, ...shuffled(queue.filter((_, i) => i !== index))] : shuffled(queue), index: 0 })
  } else {
    const back = song ? ordered.findIndex((s) => s.id === song.id) : 0
    set({ shuffle: false, queue: ordered, index: Math.max(0, back) })
  }
}

export function cycleRepeat(): void {
  const order: Repeat[] = ['off', 'all', 'one']
  set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3] })
}

/** Puts songs right after this one. */
export function playNext(songs: Song[]): void {
  const { queue, index } = get()
  if (!queue.length) return playSongs(songs, 0)
  set({ queue: [...queue.slice(0, index + 1), ...songs, ...queue.slice(index + 1)] })
  if (!get().shuffle) ordered = get().queue
}

export function addToQueue(songs: Song[]): void {
  const { queue } = get()
  if (!queue.length) return playSongs(songs, 0)
  set({ queue: [...queue, ...songs] })
  if (!get().shuffle) ordered = get().queue
}

export function removeFromQueue(at: number): void {
  const { queue, index } = get()
  if (at <= index) return
  set({ queue: queue.filter((_, i) => i !== at) })
}

export function moveInQueue(from: number, to: number): void {
  const { queue, index } = get()
  if (from <= index || to <= index) return
  const list = [...queue]
  const [song] = list.splice(from, 1)
  list.splice(to, 0, song)
  set({ queue: list })
}

export const currentSong = (): Song | undefined => get().queue[get().index]

// ---------- The audio element ----------

audio.addEventListener('play', () => set({ playing: true }))
audio.addEventListener('pause', () => set({ playing: false }))
audio.addEventListener('loadedmetadata', () => {
  const song = currentSong()
  set({ duration: audio.duration })
  if (song && Number.isFinite(audio.duration)) setDuration(song, Math.round(audio.duration * 1000))
})
audio.addEventListener('timeupdate', () => {
  set({ position: audio.currentTime })
  const song = currentSong()
  if (!counted && song && audio.currentTime >= 30) {
    counted = true
    editMusic({ kind: 'played', path: song.path, at: Date.now() })
  }
  if ('mediaSession' in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
    try {
      navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 })
    } catch {
      // Not supported here.
    }
  }
})
audio.addEventListener('ended', () => {
  const { repeat, index, queue } = get()
  if (repeat === 'one') {
    audio.currentTime = 0
    counted = false
    void audio.play()
  } else if (index + 1 < queue.length) void start(index + 1)
  else if (repeat === 'all') void start(0)
  else set({ playing: false })
})
audio.addEventListener('error', () => {
  if (audio.src) set({ error: 'This song couldn’t be played (the phone may not play this kind of file).', playing: false })
})

// ---------- Lock screen and headphones ----------

async function updateMediaSession(song: Song): Promise<void> {
  if (!('mediaSession' in navigator)) return
  const art = await artUrl(song)
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist,
    album: song.album,
    artwork: art ? [{ src: art, sizes: '512x512' }] : []
  })
}

if ('mediaSession' in navigator) {
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => void audio.play()],
    ['pause', () => audio.pause()],
    ['nexttrack', () => next()],
    ['previoustrack', () => previous()],
    ['seekto', (d) => d.seekTime !== undefined && seek(d.seekTime)],
    ['seekbackward', (d) => seek(audio.currentTime - (d.seekOffset ?? 10))],
    ['seekforward', (d) => seek(audio.currentTime + (d.seekOffset ?? 10))]
  ]
  for (const [action, fn] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, fn)
    } catch {
      // This phone doesn't have that button.
    }
  }
}

// Keep the song list's details fresh in the queue when the library is read again.
useLibrary.subscribe((now, before) => {
  if (now.songs === before.songs) return
  const byId = new Map(now.songs.map((s) => [s.id, s]))
  const { queue } = get()
  if (queue.some((s) => byId.has(s.id) && byId.get(s.id) !== s)) set({ queue: queue.map((s) => byId.get(s.id) ?? s) })
})

// ---------- Picking up where you left off ----------

interface Session {
  ids: string[]
  index: number
  position: number
  shuffle: boolean
  repeat: Repeat
}

/** Where the last song was stopped, to carry on from when you press play. */
let resumeAt = 0

/** The queue from last time (not playing until you press play). */
export async function restoreSession(): Promise<void> {
  const saved = await db.get<Session>('kv', 'session')
  if (!saved || get().queue.length) return
  const byId = new Map(useLibrary.getState().songs.map((s) => [s.id, s]))
  const queue = saved.ids.map((id) => byId.get(id)).filter((s): s is Song => !!s)
  if (!queue.length) return
  const index = Math.min(saved.index, queue.length - 1)
  ordered = queue
  resumeAt = saved.position
  set({ queue, index, shuffle: saved.shuffle, repeat: saved.repeat, position: saved.position, duration: queue[index].durationMs / 1000 })
  void updateMediaSession(queue[index])
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let savedAt = 0
usePlayer.subscribe((now, before) => {
  if (now.queue === before.queue && now.index === before.index && now.shuffle === before.shuffle && now.repeat === before.repeat && Math.abs(now.position - savedAt) < 5) return
  savedAt = now.position
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { queue, index, position, shuffle, repeat } = get()
    void db.put('kv', 'session', { ids: queue.slice(0, 2000).map((s) => s.id), index, position, shuffle, repeat } satisfies Session)
  }, 1500)
})
