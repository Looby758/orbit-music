import { useEffect, useState, type ReactNode } from 'react'
import { Check, Download, Heart, ListEnd, ListPlus, ListStart, Music, MoreHorizontal, Disc3, Mic2, Trash2, X, Minus } from 'lucide-react'
import { artUrl, downloadSongs, editMusic, removeDownload, useLibrary } from '../library'
import { addToQueue, playNext, usePlayer } from '../player'
import { go } from '../nav'
import { formatTime, type Song } from '../song'

/** A song's cover, or a music note while there isn't one. */
export function Art({ song, size, round }: { song?: Song; size?: number; round?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    if (song) void artUrl(song).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [song?.id, song?.art])
  return (
    <span className={`art ${round ? 'round' : ''}`} style={size ? { width: size, height: size } : undefined}>
      {url ? <img src={url} alt="" /> : <Music size={size ? Math.max(14, size * 0.36) : 18} />}
    </span>
  )
}

export const isLiked = (path: string): boolean => path in useLibrary.getState().data.liked

export function toggleLike(song: Song): void {
  editMusic({ kind: 'like', paths: [song.path], liked: !isLiked(song.path), at: Date.now() })
}

export function totalLength(songs: Song[]): string {
  const mins = Math.round(songs.reduce((t, s) => t + s.durationMs, 0) / 60000)
  return mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} min` : `${mins} min`
}

/** A small round progress ring for a download. */
export function Ring({ done }: { done: number }) {
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <svg className="ring" width="18" height="18" viewBox="0 0 18 18" aria-label={`Downloading, ${Math.round(done * 100)}%`}>
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${c * done} ${c}`} transform="rotate(-90 9 9)" strokeLinecap="round" />
    </svg>
  )
}

export function SongRow({ song, onPlay, number, playlist }: { song: Song; onPlay: () => void; number?: number; playlist?: { id: string; position: number } }) {
  const current = usePlayer((s) => s.queue[s.index]?.id === song.id)
  const downloaded = useLibrary((s) => s.downloaded.has(song.id))
  const progress = useLibrary((s) => s.downloading[song.id])
  const [menu, setMenu] = useState(false)
  return (
    <div className={`song-row ${current ? 'current' : ''}`} data-song={song.title}>
      <button className="song-main" onClick={onPlay}>
        {number !== undefined ? <span className="song-number">{number}</span> : <Art song={song} size={46} />}
        <span className="song-text">
          <strong>{song.title}</strong>
          <span>
            {downloaded && <Download size={11} className="downloaded-mark" aria-label="Downloaded" />}
            {progress !== undefined && <Ring done={progress} />}
            {song.artist || 'Unknown artist'}
            {song.album && number === undefined ? ` · ${song.album}` : ''}
          </span>
        </span>
        {number !== undefined && song.durationMs > 0 && <span className="song-time">{formatTime(song.durationMs)}</span>}
      </button>
      <button className="icon-btn" onClick={() => setMenu(true)} aria-label={`More for ${song.title}`} data-song-menu>
        <MoreHorizontal size={20} />
      </button>
      {menu && <SongMenu songs={[song]} onClose={() => setMenu(false)} playlist={playlist} />}
    </div>
  )
}

export interface SheetItem {
  label: string
  icon: ReactNode
  onClick: () => void
  danger?: boolean
}

/** A menu that slides up from the bottom of the screen. */
export function Sheet({ title, sub, art, items, onClose, children }: { title: string; sub?: string; art?: ReactNode; items?: SheetItem[]; onClose: () => void; children?: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          {art}
          <span className="song-text">
            <strong>{title}</strong>
            {sub && <span>{sub}</span>}
          </span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {items?.map((it) => (
          <button
            key={it.label}
            className={`sheet-item ${it.danger ? 'danger' : ''}`}
            onClick={() => {
              onClose()
              it.onClick()
            }}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
        {children}
      </div>
    </div>
  )
}

/** What you can do with a song (or a few). */
export function SongMenu({ songs, onClose, playlist }: { songs: Song[]; onClose: () => void; playlist?: { id: string; position: number } }) {
  const [pick, setPick] = useState(false)
  const liked = useLibrary((s) => songs.every((x) => x.path in s.data.liked))
  const downloaded = useLibrary((s) => songs.every((x) => s.downloaded.has(x.id)))
  const one = songs.length === 1 ? songs[0] : null
  if (pick) return <PlaylistPicker songs={songs} onClose={onClose} />
  const items: SheetItem[] = [
    { label: 'Play next', icon: <ListStart size={20} />, onClick: () => playNext(songs) },
    { label: 'Add to Up next', icon: <ListEnd size={20} />, onClick: () => addToQueue(songs) },
    {
      label: liked ? 'Remove from Liked songs' : 'Add to Liked songs',
      icon: <Heart size={20} fill={liked ? 'currentColor' : 'none'} />,
      onClick: () => editMusic({ kind: 'like', paths: songs.map((s) => s.path), liked: !liked, at: Date.now() })
    },
    { label: 'Add to playlist', icon: <ListPlus size={20} />, onClick: () => setTimeout(() => setPick(true)) },
    downloaded
      ? { label: 'Remove download', icon: <Trash2 size={20} />, onClick: () => songs.forEach((s) => void removeDownload(s.id)) }
      : { label: 'Download', icon: <Download size={20} />, onClick: () => downloadSongs(songs) }
  ]
  if (playlist) items.push({ label: 'Remove from this playlist', icon: <Minus size={20} />, danger: true, onClick: () => editMusic({ kind: 'removeFromPlaylist', id: playlist.id, positions: [playlist.position], at: Date.now() }) })
  if (one?.album) items.push({ label: 'Go to album', icon: <Disc3 size={20} />, onClick: () => go({ kind: 'album', key: albumKey(one) }) })
  if (one) items.push({ label: 'Go to artist', icon: <Mic2 size={20} />, onClick: () => go({ kind: 'artist', name: one.artist || 'Unknown artist' }) })
  return (
    <Sheet title={one ? one.title : `${songs.length} songs`} sub={one ? one.artist || 'Unknown artist' : undefined} art={one ? <Art song={one} size={44} /> : undefined} items={items} onClose={() => !pick && onClose()} />
  )
}

export const albumKey = (s: Song): string => `${s.album.toLowerCase()}\u0000${(s.artist || '').toLowerCase()}`

function PlaylistPicker({ songs, onClose }: { songs: Song[]; onClose: () => void }) {
  const playlists = useLibrary((s) => s.data.playlists)
  const [name, setName] = useState('')
  const add = (id: string): void => {
    editMusic({ kind: 'addToPlaylist', id, songs: songs.map((s) => s.path), at: Date.now() })
    onClose()
  }
  return (
    <Sheet title="Add to playlist" sub={songs.length === 1 ? songs[0].title : `${songs.length} songs`} onClose={onClose}>
      <form
        className="new-playlist"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          editMusic({ kind: 'createPlaylist', id: crypto.randomUUID(), name: name.trim(), songs: songs.map((s) => s.path), at: Date.now() })
          onClose()
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist name" />
        <button className="btn primary" disabled={!name.trim()}>
          Create
        </button>
      </form>
      <div className="sheet-list">
        {playlists.map((p) => (
          <button key={p.id} className="sheet-item" onClick={() => add(p.id)}>
            <ListPlus size={20} />
            <span className="grow">{p.name}</span>
            {songs.every((s) => p.songs.includes(s.path)) && <Check size={16} className="accent" />}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
