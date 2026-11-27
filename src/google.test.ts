import { describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()
vi.mock('./db', () => ({
  get: async (_s: string, k: string) => store.get(k),
  put: async (_s: string, k: string, v: unknown) => void store.set(k, v),
  del: async (_s: string, k: string) => void store.delete(k)
}))
vi.stubGlobal('location', { hash: '', search: '', origin: 'https://example.test', pathname: '/orbit-music/' })
vi.stubGlobal('history', { replaceState: () => undefined })
vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })

const google = await import('./google')


describe('staying signed in', () => {
  it('gets a new key by itself when the old one has run out', async () => {
    store.set('clientId', 'id.apps.googleusercontent.com')
    store.set('clientSecret', 'GOCSPX-abcdefghijklmnop')
    store.set('refresh', 'refresh-key')
    store.set('token', { value: 'old', expires: Date.now() - 1000 })
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'new', expires_in: 3599 }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect(await google.restoreToken()).toEqual({ signedIn: true })
    expect(google.hasToken()).toBe(false)
    expect(await google.accessToken()).toBe('new')
    expect(fetch).toHaveBeenCalledOnce()
    expect(google.hasToken()).toBe(true)
  })

  it('asks to reconnect only once the long-lasting key is cancelled', async () => {
    google.tokenRejected()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))
    await expect(google.accessToken()).rejects.toBeInstanceOf(google.SignInNeeded)
    expect(store.has('refresh')).toBe(false)
  })

  it('being offline is not a reason to sign in again', async () => {
    store.set('refresh', 'refresh-key')
    await google.restoreToken()
    google.tokenRejected()
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    await expect(google.accessToken()).rejects.toBeInstanceOf(google.TokenUnreachable)
    expect(store.has('refresh')).toBe(true)
  })
})
