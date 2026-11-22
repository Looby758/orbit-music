import { describe, expect, it } from 'vitest'
import { bytesNeeded, readTags } from './id3'

/** A small ID3v2.3 tag, the way most tools write one. */
function tag(frames: [string, Uint8Array][]): Uint8Array {
  const body = frames.flatMap(([id, data]) => {
    const head = new Uint8Array(10)
    head.set([...id].map((c) => c.charCodeAt(0)))
    new DataView(head.buffer).setUint32(4, data.length)
    return [head, data]
  })
  const size = body.reduce((n, b) => n + b.length, 0)
  const out = new Uint8Array(10 + size)
  out.set([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f])
  let at = 10
  for (const b of body) {
    out.set(b, at)
    at += b.length
  }
  return out
}
const latin = (s: string): Uint8Array => new Uint8Array([0, ...[...s].map((c) => c.charCodeAt(0))])
const utf16 = (s: string): Uint8Array => {
  const out = [1, 0xff, 0xfe]
  for (const c of s) out.push(c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8)
  return new Uint8Array(out)
}

describe('readTags', () => {
  it('reads the details and the cover', () => {
    const pic = new Uint8Array([0, ...'image/png'.split('').map((c) => c.charCodeAt(0)), 0, 3, 0, 1, 2, 3])
    const t = readTags(tag([['TIT2', utf16('DÁKITI')], ['TPE1', latin('Bad Bunny')], ['TALB', latin('DÁKITI')], ['TYER', latin('2020')], ['TRCK', latin('3/12')], ['TCON', latin('(17)Reggaeton')], ['APIC', pic]]), 1000)
    expect(t).toMatchObject({ title: 'DÁKITI', artist: 'Bad Bunny', album: 'DÁKITI', year: '2020', track: 3, genre: 'Reggaeton' })
    expect(t.picture?.mime).toBe('image/png')
    expect([...t.picture!.data]).toEqual([1, 2, 3])
  })
  it('works out how much of the file it needs', () => {
    const t = tag([['TIT2', latin('x'.repeat(5000))]])
    expect(bytesNeeded(t.subarray(0, 10))).toBe(t.length + 4096)
    expect(bytesNeeded(new Uint8Array([1, 2, 3]))).toBe(4096)
  })
  it('gives nothing for a file without a tag', () => {
    expect(readTags(new Uint8Array(100), 100)).toEqual({})
  })
})
