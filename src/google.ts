/**
 * Signing in with Google. The app goes to Google's own sign-in page and comes back with a key to
 * your Drive (good for about an hour). Going to Google's page and back, rather than a pop-up, is
 * what works when the app is on your home screen.
 *
 * Staying signed in: with the client ID's "client secret" added too, Google also gives a long-lasting
 * "refresh" key, and the app quietly swaps it for a new hour-long key whenever the old one runs out,
 * with no going to Google's page at all. Without the secret, the app still goes to Google and straight
 * back by itself when it opens (Google doesn't ask again once you've said yes), and only shows the
 * Reconnect bar if Google wants you to choose something.
 *
 * The Google client ID (and secret) are yours: made once in Google Cloud (the same project Orbit's
 * Google sign-in uses), with this app's web address allowed. They're kept only on this phone.
 */

import { del, get, put } from './db'

/** Read your music, and write orbit-music.json (likes, plays, playlists) back next to it. */
export const SCOPE = 'https://www.googleapis.com/auth/drive'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

interface Token {
  value: string
  expires: number
}

let token: Token | null = null
/** The long-lasting key (only with a client secret), swapped for new hour-long keys. */
let refresh: string | null = null

/** This app's own address, which Google sends you back to (it must be listed in the client ID's settings). */
export const returnAddress = (): string => `${location.origin}${location.pathname}`

export async function savedClientId(): Promise<string> {
  return (await get<string>('kv', 'clientId')) ?? ''
}
export const saveClientId = (id: string): Promise<void> => put('kv', 'clientId', id.trim())

export async function savedClientSecret(): Promise<string> {
  return (await get<string>('kv', 'clientSecret')) ?? ''
}
export async function saveClientSecret(secret: string): Promise<void> {
  if (secret.trim()) await put('kv', 'clientSecret', secret.trim())
  else {
    await del('kv', 'clientSecret')
    refresh = null
    await del('kv', 'refresh')
  }
}
/** A client secret looks like GOCSPX-… */
export const looksLikeSecret = (s: string): boolean => /^GOCSPX-[\w-]{10,}$/.test(s.trim())

/** The app can get a new key by itself (no going to Google's page). */
export const staysSignedIn = (): boolean => !!refresh

const remember = async (value: string, expiresIn: string | number | null): Promise<void> => {
  token = { value, expires: Date.now() + (Number(expiresIn) || 3600) * 1000 }
  await put('kv', 'token', token)
}

/** On opening: the key Google just sent back (in the address), or the one kept from before. */
export async function restoreToken(): Promise<{ signedIn: boolean; error?: string }> {
  refresh = (await get<string>('kv', 'refresh')) ?? null
  const fromHash = new URLSearchParams(location.hash.slice(1))
  const fromQuery = new URLSearchParams(location.search)
  const back = fromHash.has('access_token') || fromHash.has('error') ? fromHash : fromQuery.has('code') || fromQuery.has('error') ? fromQuery : null
  if (back) {
    history.replaceState(null, '', returnAddress())
    const expected = sessionStorage.getItem('orbit-sign-in')
    const verifier = sessionStorage.getItem('orbit-sign-in-verifier')
    const quiet = sessionStorage.getItem('orbit-sign-in-quiet') === '1'
    sessionStorage.removeItem('orbit-sign-in')
    sessionStorage.removeItem('orbit-sign-in-verifier')
    sessionStorage.removeItem('orbit-sign-in-quiet')
    const error = back.get('error')
    if (error) {
      // A quiet try that needed you: just show the Reconnect bar.
      if (quiet) return { signedIn: await restoreSaved() }
      return { signedIn: await restoreSaved(), error: error === 'access_denied' ? 'Google sign-in was cancelled.' : `Google said: ${error}` }
    }
    if (!expected || back.get('state') !== expected) return { signedIn: await restoreSaved(), error: 'That sign-in didn’t come from this app. Try again.' }
    if (back.has('scope') && !back.get('scope')!.includes(SCOPE)) return { signedIn: await restoreSaved(), error: 'Tick the box that lets Orbit Music see your Google Drive files, then try again.' }
    if (back.has('access_token')) {
      await remember(back.get('access_token')!, back.get('expires_in'))
      return { signedIn: true }
    }
    try {
      await exchangeCode(back.get('code')!, verifier ?? '')
      return { signedIn: true }
    } catch (err) {
      return { signedIn: await restoreSaved(), error: err instanceof Error ? err.message : String(err) }
    }
  }
  return { signedIn: await restoreSaved() }
}

async function restoreSaved(): Promise<boolean> {
  const t = await get<Token>('kv', 'token')
  if (t && t.expires > Date.now() + 60_000) token = t
  return !!token || !!refresh
}

/** Swaps the code Google sent back for keys (only used with a client secret). */
async function exchangeCode(code: string, verifier: string): Promise<void> {
  const [clientId, secret] = await Promise.all([savedClientId(), savedClientSecret()])
  const body = new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: returnAddress(), grant_type: 'authorization_code', ...(verifier ? { code_verifier: verifier } : {}) })
  let res: Response
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', body })
  } catch {
    throw new Error('Couldn’t reach Google to finish signing in. Check you’re online and try again.')
  }
  const got = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string }
  if (!res.ok || !got.access_token) {
    if (got.error === 'invalid_client' || got.error === 'unauthorized_client') throw new Error('Google didn’t accept the client secret. Check it in Settings → Google account.')
    throw new Error(`Google said: ${got.error_description || got.error || res.status}`)
  }
  await remember(got.access_token, got.expires_in ?? 3600)
  if (got.refresh_token) {
    refresh = got.refresh_token
    await put('kv', 'refresh', refresh)
  }
}

export const hasToken = (): boolean => !!token && token.expires > Date.now() + 30_000
/** Drive can be used now, or as soon as a new key is quietly fetched. */
export const canUseDrive = (): boolean => hasToken() || !!refresh
/** When the key runs out (ms since 1970), or 0. */
export const tokenExpires = (): number => token?.expires ?? 0

const randomText = (bytes: number): string => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function challengeFor(verifier: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return btoa(String.fromCharCode(...hash)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Goes to Google's sign-in page (the app opens again when it comes back). `ask` shows the
 * permission screen again. `quiet` asks Google to come straight back without showing anything
 * (and if it can't, the app just shows the Reconnect bar).
 */
export async function signIn(ask = false, quiet = false): Promise<void> {
  const [clientId, secret] = await Promise.all([savedClientId(), savedClientSecret()])
  if (!clientId) throw new Error('Add your Google client ID first.')
  const state = crypto.randomUUID()
  sessionStorage.setItem('orbit-sign-in', state)
  if (quiet) sessionStorage.setItem('orbit-sign-in-quiet', '1')
  else sessionStorage.removeItem('orbit-sign-in-quiet')
  const email = await get<string>('kv', 'email')
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: returnAddress(),
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
    ...(email ? { login_hint: email } : {})
  })
  if (secret) {
    // The code way, which also gives the long-lasting key. Google only sends that key with the
    // permission screen, so ask again if there isn't one yet.
    const verifier = randomText(48)
    sessionStorage.setItem('orbit-sign-in-verifier', verifier)
    q.set('response_type', 'code')
    q.set('access_type', 'offline')
    q.set('code_challenge', await challengeFor(verifier))
    q.set('code_challenge_method', 'S256')
    if (ask || !refresh) q.set('prompt', 'consent')
  } else {
    q.set('response_type', 'token')
    if (ask) q.set('prompt', 'consent')
    else if (quiet) q.set('prompt', 'none')
  }
  location.assign(`${AUTH_URL}?${q}`)
}

/**
 * When the app opens and the key has run out: go to Google and straight back by itself (no tap),
 * at most once every ten minutes so it can never go round in circles.
 */
export async function quietReconnect(): Promise<boolean> {
  if (hasToken() || refresh || !navigator.onLine) return false
  if (!(await savedClientId()) || (await savedClientSecret())) return false
  const last = Number(localStorage.getItem('orbit-quiet-sign-in') ?? 0)
  if (Date.now() - last < 10 * 60_000) return false
  localStorage.setItem('orbit-quiet-sign-in', String(Date.now()))
  await signIn(false, true)
  return true
}

export class SignInNeeded extends Error {
  constructor() {
    super('Reconnect to Google to carry on (your downloaded songs still play).')
  }
}

let refreshing: Promise<string> | null = null

/** Gets a new hour-long key with the long-lasting one, without leaving the app. */
function refreshToken(): Promise<string> {
  refreshing ??= (async () => {
    const [clientId, secret] = await Promise.all([savedClientId(), savedClientSecret()])
    if (!refresh || !clientId || !secret) throw new SignInNeeded()
    let res: Response
    try {
      res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }) })
    } catch {
      throw new TokenUnreachable()
    }
    const got = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string }
    if (!res.ok || !got.access_token) {
      // The long-lasting key was cancelled or ran out (Google ends them after 7 days while the
      // Cloud project is in "Testing"): back to signing in once.
      if (got.error === 'invalid_grant' || got.error === 'invalid_client' || got.error === 'unauthorized_client') {
        refresh = null
        await del('kv', 'refresh')
        throw new SignInNeeded()
      }
      throw new TokenUnreachable()
    }
    await remember(got.access_token, got.expires_in ?? 3600)
    return got.access_token
  })().finally(() => (refreshing = null))
  return refreshing
}

/** Google couldn't be reached to get a new key (offline): not a reason to sign in again. */
export class TokenUnreachable extends Error {
  constructor() {
    super('Couldn’t reach Google. Check you’re online.')
  }
}

/** The key for Drive, quietly getting a new one if it's run out. Throws SignInNeeded if that can't be done. */
export async function accessToken(): Promise<string> {
  if (hasToken()) return token!.value
  if (refresh) return refreshToken()
  throw new SignInNeeded()
}

/** Forgets the keys, and tells Google to cancel them. */
export async function signOut(): Promise<void> {
  const t = refresh ?? token?.value
  token = null
  refresh = null
  await Promise.all([del('kv', 'token'), del('kv', 'refresh')])
  if (t) void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: 'POST' }).catch(() => undefined)
}

/** Lets the app know the key stopped working early (Drive said 401). Returns true if a new one can be fetched quietly. */
export function tokenRejected(): boolean {
  token = null
  void del('kv', 'token')
  return !!refresh
}
