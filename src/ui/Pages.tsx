import { useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Disc3, Download, Heart, History, ListMusic, Mic2, MoreHorizontal, Music, Pencil, Play, Plus, RefreshCw, Search, Settings, Shuffle, Sparkles, Trash2, TrendingUp, X } from 'lucide-react'
import { downloadSongs, editMusic, refreshLibrary, removeDownloads, useLibrary } from '../library'
import { albumsOf, artistsOf, likedSongs, mostPlayed, playlistSongs, recentlyAdded, songsByPath } from '../musicLibrary'
import { back, currentPage, go, useNav, type Page } from '../nav'
import { playSongs } from '../player'
import { filterSongs, sortSongs, type Song } from '../song'
import { SettingsPage as SettingsLazy } from './Setup'
import { albumKey, Art, Ring, Sheet, SongMenu, SongRow, totalLength } from './common'

export function PageView() {
  const page = useNav(currentPage)
  switch (page.kind) {
    case 'search':
      return <SearchPage />
    case 'settings':
      return <SettingsLazy />
    case 'songs':
      return <AllSongs />
    case 'albums':
      return <Albums />
    case 'artists':
      return <Artists />
    case 'home':
      return <Home />
    default:
      return <ListPage page={page} />
  }
}


function TopBar({ title, right, noBack }: { title?: string; right?: ReactNode; noBack?: boolean }) {
  return (
    <header className="top-bar">
      {!noBack && (
        <button className="icon-btn" onClick={back} aria-label="Back" data-back>
          <ChevronLeft size={26} />
        </button>
      )}
      {title && <h1>{title}</h1>}
      <span className="grow" />
      {right}
    </header>
  )
}

function Home() {
  const songs = useLibrary((s) => s.songs)
  const data = useLibrary((s) => s.data)
  const downloaded = useLibrary((s) => s.downloaded)
  const scan = useLibrary((s) => s.scan)
  const keepAll = useLibrary((s) => s.keepAll)
  const downloadingNow = useLibrary((s) => Object.keys(s.downloading).length)
  const [newList, setNewList] = useState(false)
  const byPath = useMemo(() => songsByPath(songs), [songs])
  const liked = useMemo(() => likedSongs(data, byPath), [data, byPath])
  const tile = (page: Page, icon: ReactNode, label: string, count: number) => (
    <button className="tile" onClick={() => go(page)} data-tile={page.kind}>
      <span className="tile-icon">{icon}</span>
      <span className="song-text">
        <strong>{label}</strong>
        <span>{count} {count === 1 ? 'song' : 'songs'}</span>
      </span>
    </button>
  )
  return (
    <div className="page">
      <header className="top-bar home">
        <h1>Your music</h1>
        <span className="grow" />
        <button className="icon-btn" onClick={() => void refreshLibrary()} aria-label="Check for new songs" disabled={!!scan}>
          <RefreshCw size={20} className={scan ? 'spin' : ''} />
        </button>
        <button className="icon-btn" onClick={() => go({ kind: 'settings' })} aria-label="Settings" data-settings>
          <Settings size={20} />
        </button>
      </header>
      {scan && (
        <p className="note" data-scan>
          {scan.read ? `Reading song details: ${scan.read} of ${scan.found}…` : `Looking through your music folder… ${scan.found ? `${scan.found} songs so far` : ''}`}
        </p>
      )}
      {keepAll && downloadingNow > 0 && !scan && (
        <p className="note" data-keep-all-progress>
          Downloading your music to this phone: {downloaded.size} of {songs.length}. Keep the app open for it to finish.
        </p>
      )}
      <div className="tiles">
        {tile({ kind: 'liked' }, <Heart size={20} fill="currentColor" />, 'Liked songs', liked.length)}
        {tile({ kind: 'recent' }, <Sparkles size={20} />, 'Recently added', Math.min(100, songs.length))}
        {tile({ kind: 'downloaded' }, <Download size={20} />, 'Downloaded', downloaded.size)}
        {tile({ kind: 'most' }, <TrendingUp size={20} />, 'Most played', mostPlayed(songs, data.stats).length)}
      </div>
      <div className="section-head">
        <h2>Playlists</h2>
        <button className="icon-btn" onClick={() => setNewList(true)} aria-label="New playlist" data-new-playlist>
          <Plus size={22} />
        </button>
      </div>
      {data.playlists.length === 0 && <p className="note">No playlists yet. Make one here, or on your computer in Orbit.</p>}
      <div className="rows">
        {data.playlists.map((p) => {
          const first = p.songs.map((path) => byPath.get(path)).find((s) => s?.art)
          return (
            <button key={p.id} className="list-row" onClick={() => go({ kind: 'playlist', id: p.id })} data-playlist={p.name}>
              {first ? <Art song={first} size={52} /> : <span className="art" style={{ width: 52, height: 52 }}><ListMusic size={20} /></span>}
              <span className="song-text">
                <strong>{p.name}</strong>
                <span>Playlist · {p.songs.length} {p.songs.length === 1 ? 'song' : 'songs'}</span>
              </span>
              <ChevronRight size={18} className="faint" />
            </button>
          )
        })}
      </div>
      <h2 className="section-title">Browse</h2>
      <div className="rows">
        <BrowseRow icon={<Music size={20} />} label="Songs" sub={`${songs.length}`} page={{ kind: 'songs' }} />
        <BrowseRow icon={<Disc3 size={20} />} label="Albums" sub={`${albumsOf(songs).length}`} page={{ kind: 'albums' }} />
        <BrowseRow icon={<Mic2 size={20} />} label="Artists" sub={`${artistsOf(songs).length}`} page={{ kind: 'artists' }} />
      </div>
      {newList && <NewPlaylist onClose={() => setNewList(false)} />}
    </div>
  )
}

function BrowseRow({ icon, label, sub, page }: { icon: ReactNode; label: string; sub: string; page: Page }) {
  return (
    <button className="list-row" onClick={() => go(page)} data-browse={page.kind}>
      <span className="tile-icon">{icon}</span>
      <span className="song-text">
        <strong>{label}</strong>
        <span>{sub}</span>
      </span>
      <ChevronRight size={18} className="faint" />
    </button>
  )
}

function NewPlaylist({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  return (
    <Sheet title="New playlist" onClose={onClose}>
      <form
        className="new-playlist"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          const id = crypto.randomUUID()
          editMusic({ kind: 'createPlaylist', id, name: name.trim(), at: Date.now() })
          onClose()
          go({ kind: 'playlist', id })
        }}
      >
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" />
        <button className="btn primary" disabled={!name.trim()}>
          Create
        </button>
      </form>
    </Sheet>
  )
}

/** A page of songs: a playlist, an album, an artist, Liked… */
function ListPage({ page }: { page: Page }) {
  const songs = useLibrary((s) => s.songs)
  const data = useLibrary((s) => s.data)
  const downloadedIds = useLibrary((s) => s.downloaded)
  const byPath = useMemo(() => songsByPath(songs), [songs])
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  let title = ''
  let kicker = ''
  let list: Song[] = []
  let icon: ReactNode = <ListMusic size={44} />
  let numbered = false
  let rows: { song: Song; position?: number }[] | null = null
  let playlistId: string | null = null
  let empty = 'Nothing here yet.'
  switch (page.kind) {
    case 'liked':
      title = 'Liked songs'
      kicker = 'Playlist'
      icon = <Heart size={44} fill="currentColor" />
      list = likedSongs(data, byPath)
      empty = 'Songs you like (the heart) show up here, from your phone and your computer.'
      break
    case 'recent':
      title = 'Recently added'
      kicker = 'Your music'
      icon = <Sparkles size={44} />
      list = recentlyAdded(songs)
      break
    case 'most':
      title = 'Most played'
      kicker = 'Your music'
      icon = <TrendingUp size={44} />
      list = mostPlayed(songs, data.stats)
      empty = 'Songs you play show up here, counted after 30 seconds.'
      break
    case 'downloaded':
      title = 'Downloaded'
      kicker = 'On this phone'
      icon = <Download size={44} />
      list = sortSongs(songs.filter((s) => downloadedIds.has(s.id)))
      empty = 'Download songs, albums or playlists (the arrow) to play them with no signal.'
      break
    case 'playlist': {
      const p = data.playlists.find((x) => x.id === page.id)
      if (!p) return <Gone />
      title = p.name
      kicker = 'Playlist'
      playlistId = p.id
      rows = playlistSongs(p, byPath)
        .filter((e) => e.song)
        .map((e) => ({ song: e.song!, position: e.position }))
      list = rows.map((r) => r.song)
      empty = 'Add songs with ⋯ → Add to playlist.'
      break
    }
    case 'album': {
      const a = albumsOf(songs).find((x) => x.key === page.key)
      if (!a) return <Gone />
      title = a.name
      kicker = `Album · ${a.artist || 'Unknown artist'}`
      list = a.songs
      icon = <Disc3 size={44} />
      numbered = true
      break
    }
    case 'artist': {
      const a = artistsOf(songs).find((x) => x.name === page.name)
      if (!a) return <Gone />
      title = a.name
      kicker = 'Artist'
      list = sortSongs(a.songs)
      icon = <Mic2 size={44} />
      break
    }
  }
  const cover = list.find((s) => s.art)
  const allDownloaded = list.length > 0 && list.every((s) => downloadedIds.has(s.id))
  const downloadingCount = useLibrary((s) => list.filter((x) => x.id in s.downloading).length)
  const doneCount = list.filter((s) => downloadedIds.has(s.id)).length
  return (
    <div className="page">
      <TopBar
        right={
          <button className="icon-btn" onClick={() => setMenu(true)} aria-label="More" data-list-menu>
            <MoreHorizontal size={22} />
          </button>
        }
      />
      <div className="list-head">
        <span className={`big-art ${page.kind === 'artist' ? 'round' : ''}`}>{cover ? <Art song={cover} round={page.kind === 'artist'} /> : icon}</span>
        <span className="kicker">{kicker}</span>
        <h1 data-list-title>{title}</h1>
        <span className="faint">
          {list.length} {list.length === 1 ? 'song' : 'songs'}
          {list.length ? `, ${totalLength(list)}` : ''}
        </span>
      </div>
      <div className="list-actions">
        <button
          className={`icon-btn big ${allDownloaded ? 'accent' : ''}`}
          onClick={() => (allDownloaded ? removeDownloads(list) : downloadSongs(list))}
          disabled={!list.length}
          aria-label={allDownloaded ? 'Remove downloads' : 'Download for offline'}
          data-download-all
        >
          {downloadingCount ? <Ring done={doneCount / list.length} /> : <Download size={22} />}
        </button>
        <span className="grow" />
        <button className="icon-btn big" onClick={() => playSongs(list, 'shuffle')} disabled={!list.length} aria-label="Shuffle" data-shuffle-all>
          <Shuffle size={22} />
        </button>
        <button className="play-btn" onClick={() => playSongs(list, 0)} disabled={!list.length} aria-label="Play" data-play-all>
          <Play size={24} fill="currentColor" />
        </button>
      </div>
      {list.length === 0 ? (
        <p className="note">{empty}</p>
      ) : (
        <div className="rows">
          {(rows ?? list.map((song) => ({ song, position: undefined }))).map((r, i) => (
            <SongRow
              key={`${r.song.id}:${i}`}
              song={r.song}
              number={numbered ? r.song.track || i + 1 : undefined}
              onPlay={() => playSongs(list, i)}
              playlist={playlistId && r.position !== undefined ? { id: playlistId, position: r.position } : undefined}
            />
          ))}
        </div>
      )}
      {menu && !playlistId && <SongMenu songs={list} onClose={() => setMenu(false)} />}
      {menu && playlistId && (
        <Sheet
          title={title}
          sub="Playlist"
          onClose={() => setMenu(false)}
          items={[
            { label: 'Rename', icon: <Pencil size={20} />, onClick: () => setRenaming(true) },
            { label: 'Delete playlist', icon: <Trash2 size={20} />, danger: true, onClick: () => confirm(`Delete “${title}”? The songs stay in your music.`) && (editMusic({ kind: 'deletePlaylist', id: playlistId! }), back()) }
          ]}
        />
      )}
      {renaming && playlistId && <Rename id={playlistId} name={title} onClose={() => setRenaming(false)} />}
    </div>
  )
}

function Rename({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const [value, setValue] = useState(name)
  return (
    <Sheet title="Rename playlist" onClose={onClose}>
      <form
        className="new-playlist"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim() && value.trim() !== name) editMusic({ kind: 'renamePlaylist', id, name: value.trim(), at: Date.now() })
          onClose()
        }}
      >
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} data-rename-input />
        <button className="btn primary" disabled={!value.trim()}>
          Save
        </button>
      </form>
    </Sheet>
  )
}

function Gone() {
  return (
    <div className="page">
      <TopBar />
      <p className="note">That isn’t in your music any more.</p>
    </div>
  )
}

function AllSongs() {
  const songs = useLibrary((s) => s.songs)
  const sorted = useMemo(() => [...songs].sort((a, b) => a.title.localeCompare(b.title)), [songs])
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterSongs(sorted, query), [sorted, query])
  return (
    <div className="page">
      <TopBar title="Songs" />
      <FindBox value={query} onChange={setQuery} placeholder="Find in your songs" />
      <div className="list-actions">
        <span className="faint">{shown.length} songs</span>
        <span className="grow" />
        <button className="icon-btn big" onClick={() => playSongs(shown, 'shuffle')} disabled={!shown.length} aria-label="Shuffle">
          <Shuffle size={22} />
        </button>
        <button className="play-btn" onClick={() => playSongs(shown, 0)} disabled={!shown.length} aria-label="Play">
          <Play size={24} fill="currentColor" />
        </button>
      </div>
      <LongList songs={shown} />
    </div>
  )
}

/** A long list, drawn a screenful at a time as you scroll. */
function LongList({ songs }: { songs: Song[] }) {
  const [count, setCount] = useState(80)
  return (
    <div className="rows">
      {songs.slice(0, count).map((s, i) => (
        <SongRow key={s.id} song={s} onPlay={() => playSongs(songs, i)} />
      ))}
      {songs.length > count && (
        <button className="btn more" onClick={() => setCount(count + 200)} ref={(el) => {
            if (el) observeOnce(el, () => setCount((c) => c + 200))
          }}>
          Show more
        </button>
      )}
    </div>
  )
}

function observeOnce(el: Element, fn: () => void): void {
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect()
      fn()
    }
  })
  io.observe(el)
}

function Albums() {
  const songs = useLibrary((s) => s.songs)
  const albums = useMemo(() => albumsOf(songs), [songs])
  return (
    <div className="page">
      <TopBar title="Albums" />
      <div className="grid">
        {albums.map((a) => (
          <button key={a.key} className="card" onClick={() => go({ kind: 'album', key: a.key })} data-album={a.name}>
            <Art song={a.songs.find((s) => s.art) ?? a.songs[0]} />
            <strong>{a.name}</strong>
            <span>{a.artist || 'Unknown artist'}</span>
          </button>
        ))}
      </div>
      {albums.length === 0 && <p className="note">Songs with an album name show up here.</p>}
    </div>
  )
}

function Artists() {
  const songs = useLibrary((s) => s.songs)
  const artists = useMemo(() => artistsOf(songs), [songs])
  return (
    <div className="page">
      <TopBar title="Artists" />
      <div className="rows">
        {artists.map((a) => (
          <button key={a.name} className="list-row" onClick={() => go({ kind: 'artist', name: a.name })} data-artist={a.name}>
            <Art song={a.songs.find((s) => s.art) ?? a.songs[0]} size={52} round />
            <span className="song-text">
              <strong>{a.name}</strong>
              <span>
                {a.songs.length} {a.songs.length === 1 ? 'song' : 'songs'}
              </span>
            </span>
            <ChevronRight size={18} className="faint" />
          </button>
        ))}
      </div>
    </div>
  )
}

function FindBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <label className="find">
      <Search size={18} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} enterKeyHint="search" spellCheck={false} data-find />
      {value && (
        <button className="icon-btn" onClick={() => onChange('')} aria-label="Clear">
          <X size={16} />
        </button>
      )}
    </label>
  )
}

function SearchPage() {
  const songs = useLibrary((s) => s.songs)
  const [query, setQuery] = useState('')
  const found = useMemo(() => (query.trim() ? filterSongs(songs, query) : []), [songs, query])
  const albums = useMemo(() => {
    if (!query.trim()) return []
    const keys = new Set(found.filter((s) => s.album).map(albumKey))
    return albumsOf(songs).filter((a) => keys.has(a.key)).slice(0, 8)
  }, [found, songs, query])
  return (
    <div className="page">
      <header className="top-bar home">
        <h1>Search</h1>
      </header>
      <FindBox value={query} onChange={setQuery} placeholder="Songs, artists or albums" autoFocus />
      {query.trim() && found.length === 0 && <p className="note">Nothing found.</p>}
      {albums.length > 0 && (
        <div className="chips">
          {albums.map((a) => (
            <button key={a.key} className="chip" onClick={() => go({ kind: 'album', key: a.key })}>
              <Art song={a.songs.find((s) => s.art) ?? a.songs[0]} size={28} />
              {a.name}
            </button>
          ))}
        </div>
      )}
      <LongList songs={found} />
      {!query.trim() && <RecentHistory />}
    </div>
  )
}

function RecentHistory() {
  const songs = useLibrary((s) => s.songs)
  const history = useLibrary((s) => s.data.history)
  const list = useMemo(() => {
    const byPath = songsByPath(songs)
    const seen = new Set<string>()
    const out: Song[] = []
    for (let i = history.length - 1; i >= 0 && out.length < 20; i--) {
      const s = byPath.get(history[i].path)
      if (s && !seen.has(s.path)) {
        seen.add(s.path)
        out.push(s)
      }
    }
    return out
  }, [songs, history])
  if (!list.length) return null
  return (
    <>
      <h2 className="section-title">
        <History size={16} /> Played lately
      </h2>
      <div className="rows">
        {list.map((s, i) => (
          <SongRow key={s.id} song={s} onPlay={() => playSongs(list, i)} />
        ))}
      </div>
    </>
  )
}
