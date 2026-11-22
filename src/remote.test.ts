import { describe, expect, it } from 'vitest'
import { isRemoteFileName, parseRemoteFile, sortRemotes } from './remote'

describe('computer remote', () => {
  const url = 'http://192.168.1.20:51234/s/abcdefghijklmnopqrstuv'
  it('finds the files Orbit writes', () => {
    expect(isRemoteFileName('orbit-remote-PC.json')).toBe(true)
    expect(isRemoteFileName('orbit-music.json')).toBe(false)
  })
  it('only trusts a Wi-Fi address', () => {
    expect(parseRemoteFile({ name: 'PC', url, updated: 1 })).toEqual({ name: 'PC', url, updated: 1 })
    expect(parseRemoteFile({ name: 'PC', url: 'javascript:alert(1)', updated: 1 })).toBeNull()
    expect(parseRemoteFile({ name: 'PC', url: 'https://example.com/s/abcdefghijklmnopqrstuv', updated: 1 })).toBeNull()
  })
  it('keeps the newest per computer', () => {
    expect(sortRemotes([{ name: 'PC', url, updated: 1 }, { name: 'Mac', url, updated: 5 }, { name: 'PC', url, updated: 9 }]).map((r) => [r.name, r.updated])).toEqual([
      ['PC', 9],
      ['Mac', 5]
    ])
  })
})
