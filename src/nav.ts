/**
 * Which page is showing. Each page you open goes on the phone's history, so the back gesture (or
 * button) goes back a page rather than leaving the app.
 */

import { create } from 'zustand'

export type Page =
  | { kind: 'home' }
  | { kind: 'search' }
  | { kind: 'settings' }
  | { kind: 'songs' }
  | { kind: 'albums' }
  | { kind: 'artists' }
  | { kind: 'liked' }
  | { kind: 'recent' }
  | { kind: 'most' }
  | { kind: 'downloaded' }
  | { kind: 'playlist'; id: string }
  | { kind: 'album'; key: string }
  | { kind: 'artist'; name: string }

interface NavState {
  stack: Page[]
  /** The full-screen player is open. */
  nowPlaying: boolean
}

export const useNav = create<NavState>(() => ({ stack: [{ kind: 'home' }], nowPlaying: false }))

export const currentPage = (s: NavState): Page => s.stack[s.stack.length - 1]

export function go(page: Page): void {
  const { stack } = useNav.getState()
  useNav.setState({ stack: [...stack, page], nowPlaying: false })
  history.pushState({ depth: stack.length }, '')
  window.scrollTo(0, 0)
}

/** A tab at the bottom: starts that tab's pages again. */
export function tab(page: Page): void {
  useNav.setState({ stack: page.kind === 'home' ? [page] : [{ kind: 'home' }, page], nowPlaying: false })
  window.scrollTo(0, 0)
}

export function back(): void {
  history.back()
}

export function openNowPlaying(): void {
  useNav.setState({ nowPlaying: true })
  history.pushState({ nowPlaying: true }, '')
}

window.addEventListener('popstate', () => {
  const { stack, nowPlaying } = useNav.getState()
  if (nowPlaying) useNav.setState({ nowPlaying: false })
  else if (stack.length > 1) useNav.setState({ stack: stack.slice(0, -1) })
})
