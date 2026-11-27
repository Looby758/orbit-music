import { describe, expect, it, vi } from 'vitest'

vi.mock('./db', () => ({ get: vi.fn(), put: vi.fn(), del: vi.fn(), keys: vi.fn(), clear: vi.fn(), keepStorage: vi.fn() }))

const { movedDownloads } = await import('./library')
import type { Song } from './song'

const song = (id: string, path: string, size = 100): Song => ({ id, path, title: path, artist: '', album: '', track: 0, durationMs: 0, art: false, size, modified: '' }) as Song

describe('movedDownloads', () => {
  it('keeps a download whose Drive file came back with a new id', () => {
    const old = new Map([['a', song('a', 'Albums/One.mp3')]])
    const r = movedDownloads(old, [song('b', 'Albums/One.mp3')], new Set(['a']))
    expect(r).toEqual({ move: [['a', 'b']], remove: [] })
  })
  it('removes downloads of songs really gone, or replaced by a different file', () => {
    const old = new Map([
      ['a', song('a', 'Gone.mp3')],
      ['c', song('c', 'Changed.mp3', 100)]
    ])
    const r = movedDownloads(old, [song('d', 'Changed.mp3', 999)], new Set(['a', 'c']))
    expect(r).toEqual({ move: [], remove: ['a', 'c'] })
  })
  it('leaves downloads still in the folder alone', () => {
    const old = new Map([['a', song('a', 'One.mp3')]])
    expect(movedDownloads(old, [song('a', 'One.mp3')], new Set(['a']))).toEqual({ move: [], remove: [] })
  })
})
