import { describe, expect, it } from 'vitest'
import { fadeLength, fadeVolumes, shouldCrossfade } from './crossfade'

describe('crossfade', () => {
  it('keeps the fade to the setting, and to a third of either song', () => {
    expect(fadeLength(0, 200, 200)).toBe(0)
    expect(fadeLength(6, 200, 200)).toBe(6)
    expect(fadeLength(30, 200, 200)).toBe(12)
    expect(fadeLength(8, 12, 200)).toBe(4)
    expect(fadeLength(8, 200, 9)).toBe(3)
    expect(fadeLength(5, 0, 0)).toBe(5)
  })
  it('starts fading only near the end, with a next song, and not on repeat one', () => {
    const base = { fade: 6, position: 195, duration: 200, repeatOne: false, hasNext: true }
    expect(shouldCrossfade(base)).toBe(true)
    expect(shouldCrossfade({ ...base, position: 190 })).toBe(false)
    expect(shouldCrossfade({ ...base, hasNext: false })).toBe(false)
    expect(shouldCrossfade({ ...base, repeatOne: true })).toBe(false)
    expect(shouldCrossfade({ ...base, fade: 0 })).toBe(false)
    expect(shouldCrossfade({ ...base, duration: NaN })).toBe(false)
  })
  it('fades with equal power', () => {
    expect(fadeVolumes(0)).toEqual({ incoming: 0, outgoing: 1 })
    const mid = fadeVolumes(0.5)
    expect(mid.incoming ** 2 + mid.outgoing ** 2).toBeCloseTo(1)
    expect(fadeVolumes(2).incoming).toBe(1)
  })
})
