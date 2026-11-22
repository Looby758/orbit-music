/**
 * Reads a song's details from the start of an MP3: the ID3 tag (title, artist, album, year, track,
 * genre, cover) and, from the first sound frame, how long it is. Only the start of the file is
 * needed, so a whole song isn't downloaded just to list it.
 */

export interface SongTags {
  title?: string
  artist?: string
  album?: string
  year?: string
  genre?: string
  track?: number
  durationMs?: number
  picture?: { mime: string; data: Uint8Array }
}

/** How many bytes from the start are needed: the whole tag, plus a little for the first sound frame. */
export function bytesNeeded(head: Uint8Array): number {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 4096
  return 10 + syncsafe(head, 6) + (head[5] & 0x10 ? 10 : 0) + 4096
}

const syncsafe = (b: Uint8Array, at: number): number => ((b[at] & 0x7f) << 21) | ((b[at + 1] & 0x7f) << 14) | ((b[at + 2] & 0x7f) << 7) | (b[at + 3] & 0x7f)
const int32 = (b: Uint8Array, at: number): number => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0

function decodeText(b: Uint8Array, encoding: number): string {
  let text: string
  if (encoding === 0) text = new TextDecoder('latin1').decode(b)
  else if (encoding === 1) {
    // UTF-16 with a byte order mark.
    const le = !(b[0] === 0xfe && b[1] === 0xff)
    const start = (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff) ? 2 : 0
    text = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b.subarray(start))
  } else if (encoding === 2) text = new TextDecoder('utf-16be').decode(b)
  else text = new TextDecoder('utf-8').decode(b)
  return text.replace(/\u0000+$/, '').split('\u0000')[0].trim()
}

/** Where a text ends (its 0 terminator, two bytes for UTF-16) and the next thing starts. */
function textEnd(b: Uint8Array, from: number, encoding: number): { end: number; next: number } {
  if (encoding === 1 || encoding === 2) {
    for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return { end: i, next: i + 2 }
  } else {
    for (let i = from; i < b.length; i++) if (b[i] === 0) return { end: i, next: i + 1 }
  }
  return { end: b.length, next: b.length }
}

/** "(17)Rock" or "17" → Rock-ish: keeps the words, drops the old number codes. */
const cleanGenre = (g: string): string => g.replace(/^\(\d+\)/, '').replace(/^\d+$/, '').trim()

function readFrames(b: Uint8Array, out: SongTags): number {
  const version = b[3]
  const flags = b[5]
  const size = syncsafe(b, 6)
  const end = Math.min(b.length, 10 + size)
  let at = 10
  if (flags & 0x40 && version >= 3) at += version === 4 ? syncsafe(b, 10) : int32(b, 10) + 4
  const idLen = version === 2 ? 3 : 4
  const headLen = version === 2 ? 6 : 10
  let lengthMs = 0
  while (at + headLen <= end) {
    const id = String.fromCharCode(...b.subarray(at, at + idLen))
    if (!/^[A-Z0-9]+$/.test(id)) break
    const frameSize = version === 2 ? (b[at + 3] << 16) | (b[at + 4] << 8) | b[at + 5] : version === 4 ? syncsafe(b, at + 4) : int32(b, at + 4)
    const body = b.subarray(at + headLen, Math.min(end, at + headLen + frameSize))
    at += headLen + frameSize
    if (!body.length) continue
    const text = (): string => decodeText(body.subarray(1), body[0])
    switch (id) {
      case 'TIT2':
      case 'TT2':
        out.title = text()
        break
      case 'TPE1':
      case 'TP1':
        out.artist = text()
        break
      case 'TALB':
      case 'TAL':
        out.album = text()
        break
      case 'TYER':
      case 'TYE':
      case 'TDRC':
        out.year = text().slice(0, 4)
        break
      case 'TCON':
      case 'TCO':
        out.genre = cleanGenre(text())
        break
      case 'TRCK':
      case 'TRK':
        out.track = parseInt(text(), 10) || 0
        break
      case 'TLEN':
        lengthMs = parseInt(text(), 10) || 0
        break
      case 'APIC': {
        if (out.picture) break
        const enc = body[0]
        const mimeEnd = textEnd(body, 1, 0)
        const mime = new TextDecoder('latin1').decode(body.subarray(1, mimeEnd.end)) || 'image/jpeg'
        const desc = textEnd(body, mimeEnd.next + 1, enc)
        out.picture = { mime: mime.includes('/') ? mime : `image/${mime.toLowerCase() === 'png' ? 'png' : 'jpeg'}`, data: body.slice(desc.next) }
        break
      }
      case 'PIC': {
        if (out.picture) break
        const enc = body[0]
        const format = new TextDecoder('latin1').decode(body.subarray(1, 4)).toLowerCase()
        const desc = textEnd(body, 5, enc)
        out.picture = { mime: format === 'png' ? 'image/png' : 'image/jpeg', data: body.slice(desc.next) }
        break
      }
    }
  }
  if (lengthMs) out.durationMs = lengthMs
  return 10 + size + (flags & 0x10 ? 10 : 0)
}

const BITRATES: Record<string, number[]> = {
  // MPEG-1 layer III, and MPEG-2/2.5 layer III (kbit/s).
  '1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  '2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
}
const RATES: Record<string, number[]> = { '1': [44100, 48000, 32000], '2': [22050, 24000, 16000], '2.5': [11025, 12000, 8000] }

/** The length from the first MP3 frame: its Xing/Info frame count, or else its bit rate and the file's size. */
function mp3Duration(b: Uint8Array, from: number, fileSize: number): number | undefined {
  for (let i = from; i + 4 < Math.min(b.length, from + 8192); i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue
    const v = (b[i + 1] >> 3) & 3
    const layer = (b[i + 1] >> 1) & 3
    if (v === 1 || layer !== 1) continue
    const version = v === 3 ? '1' : v === 2 ? '2' : '2.5'
    const kbps = BITRATES[version === '1' ? '1' : '2'][(b[i + 2] >> 4) & 15]
    const rate = RATES[version][(b[i + 2] >> 2) & 3]
    if (!kbps || !rate) continue
    const mono = (b[i + 3] >> 6) === 3
    const samples = version === '1' ? 1152 : 576
    const side = version === '1' ? (mono ? 17 : 32) : mono ? 9 : 17
    const x = i + 4 + side
    const tag = String.fromCharCode(...b.subarray(x, x + 4))
    if ((tag === 'Xing' || tag === 'Info') && b[x + 7] & 1) {
      const frames = int32(b, x + 8)
      if (frames) return Math.round((frames * samples * 1000) / rate)
    }
    const vbri = i + 4 + 32
    if (String.fromCharCode(...b.subarray(vbri, vbri + 4)) === 'VBRI') {
      const frames = int32(b, vbri + 14)
      if (frames) return Math.round((frames * samples * 1000) / rate)
    }
    return Math.round(((fileSize - i) * 8) / kbps)
  }
  return undefined
}

/** Everything that can be read from the start of the file (`fileSize` is the whole file's). */
export function readTags(b: Uint8Array, fileSize: number): SongTags {
  const out: SongTags = {}
  let audioAt = 0
  if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    try {
      audioAt = readFrames(b, out)
    } catch {
      // A broken tag: use what was read.
    }
  }
  out.durationMs ||= mp3Duration(b, audioAt, fileSize)
  for (const k of ['title', 'artist', 'album', 'year', 'genre'] as const) if (!out[k]) delete out[k]
  return out
}
