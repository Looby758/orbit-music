import { useState } from 'react'
import { ChevronDown, Heart, ListMusic, MoreHorizontal, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, X } from 'lucide-react'
import { useLibrary } from '../library'
import { back, openNowPlaying, useNav } from '../nav'
import { cycleRepeat, jump, next, previous, removeFromQueue, seek, toggle, toggleShuffle, usePlayer } from '../player'
import { formatTime } from '../song'
import { Art, SongMenu, toggleLike } from './common'

/** The bar above the tabs: the song, and play/pause. Tap it for the full player. */
export function MiniPlayer() {
  const song = usePlayer((s) => s.queue[s.index])
  const playing = usePlayer((s) => s.playing)
  const loading = usePlayer((s) => s.loading)
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const liked = useLibrary((s) => !!song && song.path in s.data.liked)
  if (!song) return null
  return (
    <div className="mini" data-mini>
      <button className="mini-main" onClick={openNowPlaying} aria-label="Open the player">
        <Art song={song} size={42} />
        <span className="song-text">
          <strong>{song.title}</strong>
          <span>{loading !== null ? `Getting the song… ${Math.round(loading * 100)}%` : song.artist || 'Unknown artist'}</span>
        </span>
      </button>
      <button className={`icon-btn ${liked ? 'accent' : ''}`} onClick={() => toggleLike(song)} aria-label={liked ? 'Remove from Liked songs' : 'Add to Liked songs'}>
        <Heart size={20} fill={liked ? 'currentColor' : 'none'} />
      </button>
      <button className="icon-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} data-mini-toggle>
        {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
      </button>
      <span className="mini-progress" style={{ width: `${duration ? (position / duration) * 100 : 0}%` }} />
    </div>
  )
}

/** The full-screen player: big cover, the progress bar, every button, and Up next. */
export function NowPlaying() {
  const open = useNav((s) => s.nowPlaying)
  const { queue, index, playing, position, duration, shuffle, repeat, loading, error } = usePlayer()
  const song = queue[index]
  const liked = useLibrary((s) => !!song && song.path in s.data.liked)
  const [scrub, setScrub] = useState<number | null>(null)
  const [menu, setMenu] = useState(false)
  const [showQueue, setShowQueue] = useState(false)
  if (!open || !song) return null
  const shown = scrub ?? position
  const upNext = queue.slice(index + 1)
  return (
    <div className="now" data-now-playing>
      <header className="top-bar">
        <button className="icon-btn" onClick={back} aria-label="Close the player">
          <ChevronDown size={28} />
        </button>
        <span className="grow center faint small">{showQueue ? 'Up next' : 'Now playing'}</span>
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="More">
          <MoreHorizontal size={22} />
        </button>
      </header>
      {showQueue ? (
        <div className="now-queue rows">
          {upNext.length === 0 && <p className="note">Nothing after this song.</p>}
          {upNext.map((s, i) => (
            <div key={`${s.id}:${i}`} className="song-row">
              <button className="song-main" onClick={() => jump(index + 1 + i)}>
                <Art song={s} size={44} />
                <span className="song-text">
                  <strong>{s.title}</strong>
                  <span>{s.artist || 'Unknown artist'}</span>
                </span>
              </button>
              <button className="icon-btn" onClick={() => removeFromQueue(index + 1 + i)} aria-label={`Take ${s.title} out of Up next`}>
                <X size={18} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="now-art">
          <Art song={song} />
        </div>
      )}
      <div className="now-info">
        <span className="song-text">
          <strong data-now-title>{song.title}</strong>
          <span>{song.artist || 'Unknown artist'}</span>
        </span>
        <button className={`icon-btn big ${liked ? 'accent' : ''}`} onClick={() => toggleLike(song)} aria-label={liked ? 'Remove from Liked songs' : 'Add to Liked songs'} data-now-like>
          <Heart size={26} fill={liked ? 'currentColor' : 'none'} />
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="now-seek">
        <input
          type="range"
          min={0}
          max={Math.max(1, duration || 0)}
          step={0.5}
          value={Math.min(shown, duration || 0)}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => {
            if (scrub !== null) seek(scrub)
            setScrub(null)
          }}
          onKeyUp={() => {
            if (scrub !== null) seek(scrub)
            setScrub(null)
          }}
          style={{ '--fill': `${duration ? (Math.min(shown, duration) / duration) * 100 : 0}%` } as React.CSSProperties}
          aria-label="Where in the song"
        />
        <span className="times">
          <span>{formatTime(shown * 1000)}</span>
          <span>{loading !== null ? `Getting the song… ${Math.round(loading * 100)}%` : ''}</span>
          <span>{formatTime((duration || 0) * 1000)}</span>
        </span>
      </div>
      <div className="now-buttons">
        <button className={`icon-btn ${shuffle ? 'accent' : ''}`} onClick={toggleShuffle} aria-label={shuffle ? 'Shuffle is on' : 'Shuffle'}>
          <Shuffle size={22} />
        </button>
        <button className="icon-btn big" onClick={previous} aria-label="Previous">
          <SkipBack size={30} fill="currentColor" />
        </button>
        <button className="play-btn huge" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} data-now-toggle>
          {playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
        </button>
        <button className="icon-btn big" onClick={next} aria-label="Next" data-now-next>
          <SkipForward size={30} fill="currentColor" />
        </button>
        <button className={`icon-btn ${repeat !== 'off' ? 'accent' : ''}`} onClick={cycleRepeat} aria-label={repeat === 'one' ? 'Repeating this song' : repeat === 'all' ? 'Repeating all' : 'Repeat'}>
          {repeat === 'one' ? <Repeat1 size={22} /> : <Repeat size={22} />}
        </button>
      </div>
      <div className="now-foot">
        <button className={`btn ${showQueue ? 'primary' : ''}`} onClick={() => setShowQueue(!showQueue)} data-now-queue>
          <ListMusic size={18} /> Up next{upNext.length ? ` (${upNext.length})` : ''}
        </button>
      </div>
      {menu && <SongMenu songs={[song]} onClose={() => setMenu(false)} />}
    </div>
  )
}
