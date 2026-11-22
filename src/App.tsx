import { useEffect } from 'react'
import { Home, Search, WifiOff } from 'lucide-react'
import { startLibrary, useLibrary } from './library'
import { signIn } from './google'
import { restoreSession } from './player'
import { currentPage, tab, useNav } from './nav'
import { PageView } from './ui/Pages'
import { MiniPlayer, NowPlaying } from './ui/Player'
import { Setup } from './ui/Setup'
import { useState } from 'react'

export default function App() {
  const ready = useLibrary((s) => s.ready)
  const folder = useLibrary((s) => s.folder)
  const signedIn = useLibrary((s) => s.signedIn)
  const needsSignIn = useLibrary((s) => s.needsSignIn)
  const error = useLibrary((s) => s.error)
  const page = useNav(currentPage)
  const online = useOnline()
  useEffect(() => {
    void startLibrary().then(restoreSession)
  }, [])
  if (!ready) return null
  // Set up once: client ID, sign-in, folder. Once there's a folder, the app works even signed out (downloads play).
  if (!folder) return <Setup />
  const onSearch = page.kind === 'search'
  return (
    <>
      {!online && (
        <div className="banner" data-offline>
          <WifiOff size={16} /> Offline: your downloaded songs still play.
        </div>
      )}
      {online && needsSignIn && !signedIn && (
        <button className="banner action" onClick={() => void signIn()} data-reconnect>
          Reconnect to Google to play songs that aren’t downloaded. Tap here.
        </button>
      )}
      {error && (
        <button className="banner error" onClick={() => useLibrary.setState({ error: null })}>
          {error} (tap to hide)
        </button>
      )}
      <main>
        <PageView />
      </main>
      <footer className="dock">
        <MiniPlayer />
        <nav className="tabs">
          <button className={!onSearch ? 'on' : ''} onClick={() => tab({ kind: 'home' })} data-tab="home">
            <Home size={22} />
            Home
          </button>
          <button className={onSearch ? 'on' : ''} onClick={() => tab({ kind: 'search' })} data-tab="search">
            <Search size={22} />
            Search
          </button>
        </nav>
      </footer>
      <NowPlaying />
    </>
  )
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = (): void => setOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', on)
    }
  }, [])
  return online
}
