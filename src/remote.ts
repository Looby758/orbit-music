/**
 * Controlling Orbit on your computer from this phone. When the phone remote is on in Orbit (Music page
 * → the phone button), Orbit writes "orbit-remote-<computer>.json" into the music folder with the
 * remote's address on your Wi-Fi. It reaches this app through Google Drive, and the app opens that
 * address in the browser (the remote is a page Orbit serves itself; a web app on https:// can't talk
 * to an http:// address on the Wi-Fi directly, so it opens it instead).
 */

export const REMOTE_FILE_PREFIX = 'orbit-remote-'

export const isRemoteFileName = (name: string): boolean => name.startsWith(REMOTE_FILE_PREFIX) && name.endsWith('.json')

export interface RemoteFile {
  /** The computer's name. */
  name: string
  /** The remote page's address on the Wi-Fi. */
  url: string
  /** When Orbit last wrote it (each time it opens with the remote on). */
  updated: number
}

/** The file's contents, checked: only an address on the local Wi-Fi is trusted. */
export function parseRemoteFile(raw: unknown): RemoteFile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.name !== 'string' || typeof r.url !== 'string' || typeof r.updated !== 'number') return null
  if (!/^http:\/\/(\d{1,3}\.){3}\d{1,3}:\d{2,5}\/s\/[A-Za-z0-9_-]{22}\/?$/.test(r.url)) return null
  return { name: r.name.slice(0, 80), url: r.url, updated: r.updated }
}

/** Newest first, one per computer. */
export function sortRemotes(list: RemoteFile[]): RemoteFile[] {
  const byName = new Map<string, RemoteFile>()
  for (const r of list) if ((byName.get(r.name)?.updated ?? -1) < r.updated) byName.set(r.name, r)
  return [...byName.values()].sort((a, b) => b.updated - a.updated)
}
