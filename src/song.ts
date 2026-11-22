/**
 * A song in your music folder on Google Drive. The same shape Orbit uses on the computer
 * (LocalSong there), plus where the file is in Drive.
 */

export const AUDIO = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus']
export const isAudio = (name: string): boolean => AUDIO.some((ext) => name.toLowerCase().endsWith(ext))

export interface LocalSong {
  /** Where it is inside the music folder, with forward slashes ("Albums/Song.mp3"), as on the computer. */
  path: string
  title: string
  artist: string
  album: string
  /** Track number on the album (0 if unknown). */
  track: number
  durationMs: number
  /** The file has a cover picture (kept in this phone's storage once read). */
  art: boolean
  /** When the file was last changed (roughly when it was added), for Recently added. */
  added?: number
  year?: string
  genre?: string
  /** Drive's id for the file. */
  id: string
  size: number
  /** Drive's "modifiedTime", so a changed file is read again. */
  modified: string
}

export type Song = LocalSong

/** Title, artist and track number from a file name like "01 - Artist - Title.mp3". */
export function guessFromName(path: string): { title: string; artist: string; track: number } {
  const name = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '')
  const num = /^(\d{1,3})[\s.\-_)]+(.+)$/.exec(name)
  const rest = (num ? num[2] : name).trim()
  const parts = rest.split(/\s+[-–]\s+/)
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - '), track: num ? Number(num[1]) : 0 }
  return { artist: '', title: rest || name, track: num ? Number(num[1]) : 0 }
}

/** Lower case without accents, so "dakiti" finds "DÁKITI". */
export const plainText = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Songs whose title, artist or album has every word you typed. */
export function filterSongs(songs: Song[], query: string): Song[] {
  const words = plainText(query).split(/\s+/).filter(Boolean)
  if (!words.length) return songs
  return songs.filter((s) => {
    const text = plainText(`${s.title} ${s.artist} ${s.album} ${s.genre ?? ''}`)
    return words.every((w) => text.includes(w))
  })
}

/** Artist, then album, then track number, then title. */
export function sortSongs(songs: Song[]): Song[] {
  const key = (s: string): string => s.toLowerCase().replace(/^the\s+/, '')
  return [...songs].sort(
    (a, b) =>
      key(a.artist || '￿').localeCompare(key(b.artist || '￿')) ||
      key(a.album).localeCompare(key(b.album)) ||
      a.track - b.track ||
      key(a.title).localeCompare(key(b.title))
  )
}

export const formatTime = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
