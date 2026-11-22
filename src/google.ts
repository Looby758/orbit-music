/**
 * Signing in with Google. The app goes to Google's own sign-in page and comes back with a key to
 * your Drive, good for about an hour; after that, one tap on "Reconnect" gets a new one (Google
 * doesn't ask again once you've said yes). Going to Google's page and back, rather than a pop-up,
 * is what works when the app is on your home screen.
 *
 * The Google "client ID" is yours: made once in Google Cloud (the same project Orbit's Google
 * sign-in uses), with this app's web address allowed. It isn't a secret.
 */

import { del, get, put } from './db'

/** Read your music, and write orbit-music.json (likes, plays, playlists) back next to it. */
export const SCOPE = 'https://www.googleapis.com/auth/drive'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

interface Token {
  value: string
  expires: number
}

let token: Token | null = null

/** This app's own address, which Google sends you back to (it must be listed in the client ID's settings). */
export const returnAddress = (): string => `${location.origin}${location.pathname}`

export async function savedClientId(): Promise<string> {
  return (await get<string>('kv', 'clientId')) ?? ''
}
export const saveClientId = (id: string): Promise<void> => put('kv', 'clientId', id.trim())

/** On opening: the key Google just sent back (in the address), or the one kept from before. */
export async function restoreToken(): Promise<{ signedIn: boolean; error?: string }> {
  const back = new URLSearchParams(location.hash.slice(1))
  if (back.has('access_token') || back.has('error')) {
    history.replaceState(null, '', returnAddress())
    const expected = sessionStorage.getItem('orbit-sign-in')
    sessionStorage.removeItem('orbit-sign-in')
    if (back.get('error')) return { signedIn: false, error: back.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : `Google said: ${back.get('error')}` }
    if (!expected || back.get('state') !== expected) return { signedIn: false, error: 'That sign-in didn’t come from this app. Try again.' }
    if (!(back.get('scope') ?? '').includes(SCOPE)) return { signedIn: false, error: 'Tick the box that lets Orbit Music see your Google Drive files, then try again.' }
    token = { value: back.get('access_token')!, expires: Date.now() + Number(back.get('expires_in') ?? 3600) * 1000 }
    await put('kv', 'token', token)
    return { signedIn: true }
  }
  const t = await get<Token>('kv', 'token')
  if (t && t.expires > Date.now() + 60_000) token = t
  return { signedIn: !!token }
}

export const hasToken = (): boolean => !!token && token.expires > Date.now() + 30_000
/** When the key runs out (ms since 1970), or 0. */
export const tokenExpires = (): number => token?.expires ?? 0

/** Goes to Google's sign-in page (the app opens again when it comes back). `ask` shows the permission screen again. */
export async function signIn(ask = false): Promise<void> {
  const clientId = await savedClientId()
  if (!clientId) throw new Error('Add your Google client ID first.')
  const state = crypto.randomUUID()
  sessionStorage.setItem('orbit-sign-in', state)
  const email = await get<string>('kv', 'email')
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: returnAddress(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
    ...(ask ? { prompt: 'consent' } : {}),
    ...(email ? { login_hint: email } : {})
  })
  location.assign(`${AUTH_URL}?${q}`)
}

export class SignInNeeded extends Error {
  constructor() {
    super('Reconnect to Google to carry on (your downloaded songs still play).')
  }
}

/** The key for Drive. Throws SignInNeeded once it's run out. */
export function accessToken(): string {
  if (hasToken()) return token!.value
  throw new SignInNeeded()
}

/** Forgets the key, and tells Google to cancel it. */
export async function signOut(): Promise<void> {
  const t = token?.value
  token = null
  await del('kv', 'token')
  if (t) void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: 'POST' }).catch(() => undefined)
}

/** Lets the app know the key stopped working early (Drive said 401). */
export function tokenRejected(): void {
  token = null
  void del('kv', 'token')
}
