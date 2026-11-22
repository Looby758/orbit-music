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
import { canFadeVolume, CROSSFADE_MAX, fadeLength, fadeVolumes, shouldCrossfade } from './crossfade'

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
  /** Seconds to fade from one song into the next (0 is off). Kept on this phone. */
  crossfade: number
}

export const usePlayer = create<PlayerState>(() => ({ queue: [], index: 0, playing: false, loading: null, position: 0, duration: 0, shuffle: false, repeat: 'off', error: null, crossfade: 0 }))
const set = usePlayer.setState
const get = usePlayer.getState

/**
 * Two players, used in turn: the song playing now (`audio`) and the next one when crossfading
 * (while it fades in, the old one is `fading.from`). The same two are always used, because an
 * iPhone only lets a player start by itself after you've pressed play on it once.
 */
const decks = [newDeck(), newDeck()]
let audio = decks[0]
const otherDeck = (): HTMLAudioElement => (audio === decks[0] ? decks[1] : decks[0])
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
  endCrossfade()
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
  getReadyToFade()
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
  getReadyToFade()
  if (!audio.src) return void start(get().index).then(() => resumeAt && ((audio.currentTime = resumeAt), (resumeAt = 0)))
  endCrossfade()
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
  endCrossfade()
  if (audio.currentTime > 3 || index === 0) {
    audio.currentTime = 0
    return
  }
  void start(Math.max(0, Math.min(queue.length - 1, index - 1)))
}

export function seek(seconds: number): void {
  endCrossfade()
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

// ---------- The audio elements ----------

/** A player for one song. Two are alive while crossfading; only the current one (`audio`) updates the state. */
function newDeck(): HTMLAudioElement {
  const el = new Audio()
  el.preload = 'auto'
  el.addEventListener('play', () => el === audio && set({ playing: true }))
  el.addEventListener('pause', () => el === audio && set({ playing: false }))
  el.addEventListener('loadedmetadata', () => {
    if (el !== audio) return
    const song = currentSong()
    set({ duration: el.duration })
    if (song && Number.isFinite(el.duration)) setDuration(song, Math.round(el.duration * 1000))
  })
  el.addEventListener('timeupdate', () => {
    if (el !== audio) return
    set({ position: el.currentTime })
    const song = currentSong()
    if (!counted && song && el.currentTime >= 30) {
      counted = true
      editMusic({ kind: 'played', path: song.path, at: Date.now() })
    }
    if ('mediaSession' in navigator && Number.isFinite(el.duration) && el.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({ duration: el.duration, position: Math.min(el.currentTime, el.duration), playbackRate: 1 })
      } catch {
        // Not supported here.
      }
    }
    maybeCrossfade()
  })
  el.addEventListener('ended', () => {
    if (el !== audio) return
    const { repeat, index, queue } = get()
    if (repeat === 'one') {
      el.currentTime = 0
      counted = false
      void el.play()
    } else if (index + 1 < queue.length) void start(index + 1)
    else if (repeat === 'all') void start(0)
    else set({ playing: false })
  })
  el.addEventListener('error', () => {
    if (el === audio && el.src) set({ error: 'This song couldn’t be played (the phone may not play this kind of file).', playing: false })
  })
  return el
}

// ---------- Crossfading ----------

/**
 * Most phones fade by changing each player's volume. iPhones don't let web apps do that, so
 * there the sound goes through a Web Audio volume knob instead (only once crossfade is turned on).
 */
export const volumeWorks = canFadeVolume()
let graph: { ctx: AudioContext; gains: Map<HTMLAudioElement, GainNode> } | null = null

function setVolume(el: HTMLAudioElement, v: number): void {
  const gain = graph?.gains.get(el)
  if (gain) gain.gain.value = v
  else el.volume = v
}

/** Wires both players through Web Audio (iPhone, crossfade on). Once wired, they stay wired. */
function ensureGraph(): void {
  if (volumeWorks || graph || !get().crossfade) return
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const gains = new Map<HTMLAudioElement, GainNode>()
    for (const el of decks) {
      const gain = ctx.createGain()
      ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination)
      gains.set(el, gain)
    }
    graph = { ctx, gains }
  } catch (err) {
    report(err)
  }
}

let unlocked = false
/**
 * Called when you press play: wires up Web Audio if it's needed, wakes it, and (once) plays a
 * moment of silence on the spare player, so the phone lets it start the next song by itself later.
 */
function getReadyToFade(): void {
  if (!get().crossfade) return
  ensureGraph()
  if (graph?.ctx.state !== 'running') void graph?.ctx.resume().catch(() => undefined)
  if (unlocked) return
  unlocked = true
  const spare = otherDeck()
  if (spare.src) return
  spare.src = silence()
  void spare
    .play()
    .then(() => spare.pause())
    .catch(() => undefined)
    .finally(() => {
      if (spare !== audio) spare.removeAttribute('src')
    })
}

/** A tenth of a second of silence, as a WAV file. */
function silence(): string {
  const n = 800
  const b = new DataView(new ArrayBuffer(44 + n))
  const text = (at: number, t: string): void => [...t].forEach((c, i) => b.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  b.setUint32(4, 36 + n, true)
  text(8, 'WAVEfmt ')
  b.setUint32(16, 16, true)
  b.setUint16(20, 1, true)
  b.setUint16(22, 1, true)
  b.setUint32(24, 8000, true)
  b.setUint32(28, 8000, true)
  b.setUint16(32, 1, true)
  b.setUint16(34, 8, true)
  text(36, 'data')
  b.setUint32(40, n, true)
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128)
  return URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' }))
}

// Coming back to the app: make sure Web Audio is awake again.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && graph && graph.ctx.state !== 'running' && !audio.paused) void graph.ctx.resume().catch(() => undefined)
})

let fading: { from: HTMLAudioElement; timer: ReturnType<typeof setInterval> } | null = null
/** Getting the next song ready to fade into (so it's only tried once per song). */
let fadeStarting = false

function nextIndex(): number | null {
  const { index, queue, repeat } = get()
  if (index + 1 < queue.length) return index + 1
  return repeat === 'all' && queue.length > 1 ? 0 : null
}

function maybeCrossfade(): void {
  const { crossfade, repeat, queue, index } = get()
  if (fading || fadeStarting || !crossfade || audio.paused) return
  if (!volumeWorks && graph?.ctx.state !== 'running') return
  const to = nextIndex()
  const nextSong = to === null ? undefined : queue[to]
  const fade = fadeLength(crossfade, audio.duration, (nextSong?.durationMs ?? 0) / 1000)
  if (!nextSong || nextSong.id === queue[index]?.id) return
  if (!shouldCrossfade({ fade, position: audio.currentTime, duration: audio.duration, repeatOne: repeat === 'one', hasNext: true })) return
  void crossfadeTo(to!, fade)
}

async function crossfadeTo(to: number, seconds: number): Promise<void> {
  const song = get().queue[to]
  const id = playId
  fadeStarting = true
  const from = audio
  try {
    // Only if the next song is already fetched (it usually is); otherwise it just plays after this one.
    const url = await Promise.race([sound(song), new Promise<null>((r) => setTimeout(() => r(null), 300))])
    if (!url || id !== playId || from !== audio || from.paused) return
    const el = otherDeck()
    setVolume(el, 0)
    el.src = url
    await el.play()
    if (id !== playId || from !== audio) {
      el.pause()
      return
    }
    // The new song is now the current one; the old one fades out underneath it.
    const started = performance.now()
    audio = el
    playId++
    counted = false
    set({ index: to, position: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : song.durationMs / 1000, error: null, loading: null, playing: true })
    void updateMediaSession(song)
    prefetchNext()
    const timer = setInterval(() => {
      const t = (performance.now() - started) / 1000 / seconds
      const v = fadeVolumes(t)
      setVolume(el, v.incoming)
      setVolume(from, v.outgoing)
      if (t >= 1) endCrossfade()
    }, 50)
    fading = { from, timer }
  } catch {
    // The phone wouldn't start it: the next song plays when this one ends, as usual.
  } finally {
    fadeStarting = false
  }
}

/** Finishes a fade straight away (when you skip, seek or pause in the middle of one). */
function endCrossfade(): void {
  if (!fading) return
  clearInterval(fading.timer)
  fading.from.pause()
  fading.from.removeAttribute('src')
  fading.from.load()
  fading = null
  setVolume(audio, 1)
}

export function setCrossfade(seconds: number): void {
  const crossfade = Math.max(0, Math.min(CROSSFADE_MAX, Math.round(seconds) || 0))
  set({ crossfade })
  void db.put('kv', 'crossfade', crossfade)
  // Moving the slider counts as a tap, so Web Audio can start here.
  getReadyToFade()
}

void db.get<number>('kv', 'crossfade').then((n) => typeof n === 'number' && set({ crossfade: n }))

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
    ['pause', () => {
      endCrossfade()
      audio.pause()
    }],
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
