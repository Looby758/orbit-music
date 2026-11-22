/** Crossfading into the next song: the same rules as Orbit on the computer. */

export const CROSSFADE_MAX = 12

/** How long to fade, in seconds: the setting, but at most a third of either song. */
export function fadeLength(crossfade: number, thisSong: number, nextSong: number): number {
  if (!(crossfade > 0)) return 0
  const limit = Math.min(thisSong > 0 ? thisSong / 3 : crossfade, nextSong > 0 ? nextSong / 3 : crossfade)
  return Math.max(0, Math.min(crossfade, CROSSFADE_MAX, limit))
}

/** Whether it's time to start fading into the next song. */
export function shouldCrossfade(o: { fade: number; position: number; duration: number; repeatOne: boolean; hasNext: boolean }): boolean {
  if (o.fade < 0.5 || o.repeatOne || !o.hasNext || !(o.duration > 0)) return false
  return o.duration - o.position <= o.fade
}

/** Equal-power volumes (so the sound doesn't dip in the middle), `t` from 0 to 1 through the fade. */
export function fadeVolumes(t: number): { incoming: number; outgoing: number } {
  const x = Math.min(1, Math.max(0, t))
  return { incoming: Math.sin((x * Math.PI) / 2), outgoing: Math.cos((x * Math.PI) / 2) }
}

/** Some phones (iPhones) don't let a web app change a song's volume, so there's nothing to fade with. */
export function canFadeVolume(): boolean {
  try {
    const a = new Audio()
    a.volume = 0.5
    return Math.abs(a.volume - 0.5) < 0.01
  } catch {
    return false
  }
}
