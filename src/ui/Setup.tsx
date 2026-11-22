import { useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Folder as FolderIcon, HardDrive, LogOut, RefreshCw, Search, Trash2 } from 'lucide-react'
import { chooseFolder, forgetFolder, refreshLibrary, report, setKeepAll, useLibrary, type Folder } from '../library'
import { fileInfo, findFolders, folderIdFromLink, FOLDER, foldersIn, type DriveFile } from '../drive'
import { returnAddress, saveClientId, savedClientId, signIn, signOut } from '../google'
import { back } from '../nav'
import * as db from '../db'
import { volumeWorks, setCrossfade, usePlayer } from '../player'
import { CROSSFADE_MAX } from '../crossfade'

/** First time: your Google client ID, then signing in, then your music folder. */
export function Setup() {
  const signedIn = useLibrary((s) => s.signedIn)
  const folder = useLibrary((s) => s.folder)
  const error = useLibrary((s) => s.error)
  const [clientId, setClientId] = useState<string | null>(null)
  useEffect(() => {
    void savedClientId().then(setClientId)
  }, [])
  if (clientId === null) return null
  return (
    <div className="page setup">
      <header className="setup-head">
        <img src="./icon.svg" alt="" width={64} height={64} />
        <h1>Orbit Music</h1>
        <p className="faint">Your own music, from your Google Drive.</p>
      </header>
      {error && <p className="error">{error}</p>}
      {!clientId ? <ClientIdStep onSaved={setClientId} /> : !signedIn ? <SignInStep clientId={clientId} onChange={() => setClientId('')} /> : !folder ? <FolderPicker /> : null}
    </div>
  )
}

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="copy-box">
      <code>{text}</code>
      <button
        className="icon-btn"
        onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
        aria-label="Copy"
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </span>
  )
}

function ClientIdStep({ onSaved }: { onSaved: (id: string) => void }) {
  const [value, setValue] = useState('')
  const ok = /^[\w-]+\.apps\.googleusercontent\.com$/.test(value.trim())
  return (
    <section className="card-box">
      <h2>1. Connect to your Google</h2>
      <p>Orbit Music reads your music straight from Google Drive. Google needs a “client ID” for that, made once in the same Google Cloud project you set up for Orbit’s Google sign-in:</p>
      <ol className="steps">
        <li>
          Open{' '}
          <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">
            Google Drive API <ExternalLink size={12} />
          </a>{' '}
          and press <strong>Enable</strong> (pick your Orbit project at the top).
        </li>
        <li>
          Open{' '}
          <a href="https://console.cloud.google.com/apis/credentials/oauthclient" target="_blank" rel="noreferrer">
            Create OAuth client ID <ExternalLink size={12} />
          </a>
          . Application type: <strong>Web application</strong>, name it “Orbit Music”.
        </li>
        <li>
          Under <strong>Authorised redirect URIs</strong>, add this app’s address:
          <CopyText text={returnAddress()} />
        </li>
        <li>
          Press <strong>Create</strong> and copy the <strong>Client ID</strong> (it ends in .apps.googleusercontent.com). Paste it here:
        </li>
      </ol>
      <form
        className="new-playlist"
        onSubmit={(e) => {
          e.preventDefault()
          if (!ok) return
          void saveClientId(value).then(() => onSaved(value.trim()))
        }}
      >
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="…apps.googleusercontent.com" spellCheck={false} autoCapitalize="off" data-client-id />
        <button className="btn primary" disabled={!ok}>
          Save
        </button>
      </form>
      <p className="faint small">
        If Google says the app isn’t verified, that’s expected for your own project: in Google Cloud, under <strong>OAuth consent screen → Audience</strong>, add your Google account as a test user.
      </p>
    </section>
  )
}

function SignInStep({ clientId, onChange }: { clientId: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <section className="card-box">
      <h2>2. Sign in with Google</h2>
      <p>Use the Google account your music folder is in. Orbit Music only uses this to play your music and keep your playlists and likes in step with your computer.</p>
      <button
        className="btn primary wide"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void signIn(true).catch((err) => {
            setBusy(false)
            report(err)
          })
        }}
        data-sign-in
      >
        Sign in with Google
      </button>
      <p className="faint small">
        Client ID: <code>{clientId.slice(0, 24)}…</code>{' '}
        <button className="link-btn" onClick={() => void saveClientId('').then(onChange)}>
          Change
        </button>
      </p>
    </section>
  )
}

/** Choosing the music folder: browse your Drive, search for it by name, or paste its link. */
export function FolderPicker({ onDone }: { onDone?: () => void }) {
  const [path, setPath] = useState<Folder[]>([{ id: 'root', name: 'My Drive' }])
  const [folders, setFolders] = useState<DriveFile[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const here = path[path.length - 1]

  const load = (run: () => Promise<DriveFile[]>): void => {
    setFolders(null)
    setError(null)
    run()
      .then(setFolders)
      .catch((err) => {
        setFolders([])
        setError(err instanceof Error ? err.message : String(err))
        report(err)
      })
  }
  useEffect(() => {
    if (!query.trim()) load(() => foldersIn(here.id))
  }, [here.id])

  const pick = async (f: Folder): Promise<void> => {
    setBusy(true)
    await chooseFolder(f)
    setBusy(false)
    onDone?.()
  }

  return (
    <section className="card-box">
      <h2>{onDone ? 'Choose your music folder' : '3. Choose your music folder'}</h2>
      <p>The Google Drive folder your music is in (the same one Orbit uses on your computer).</p>
      <form
        className="find"
        onSubmit={(e) => {
          e.preventDefault()
          const id = folderIdFromLink(query)
          if (id)
            void fileInfo(id)
              .then((f) => (f.mimeType === FOLDER ? pick({ id: f.id, name: f.name }) : setError('That link isn’t a folder.')))
              .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          else if (query.trim()) load(() => findFolders(query))
          else load(() => foldersIn(here.id))
        }}
      >
        <Search size={18} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Folder name, or paste its Drive link" enterKeyHint="search" data-folder-search />
      </form>
      {!query.trim() && (
        <div className="crumbs">
          {path.length > 1 && (
            <button className="icon-btn" onClick={() => setPath(path.slice(0, -1))} aria-label="Up a folder">
              <ChevronLeft size={20} />
            </button>
          )}
          <HardDrive size={16} />
          <span>{path.map((p) => p.name).join(' / ')}</span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {here.id !== 'root' && !query.trim() && (
        <button className="btn primary wide" disabled={busy} onClick={() => void pick(here)} data-use-folder>
          Use “{here.name}”
        </button>
      )}
      <div className="rows folder-list">
        {folders === null && <p className="note">Looking…</p>}
        {folders?.length === 0 && !error && <p className="note">{query.trim() ? 'No folders with that name. Folders synced from a computer can be found by name too.' : 'No folders in here.'}</p>}
        {folders?.map((f) => (
          <div key={f.id} className="list-row folder-row">
            <button
              className="grow folder-open"
              onClick={() => {
                setQuery('')
                setPath(query.trim() ? [{ id: 'root', name: 'My Drive' }, { id: f.id, name: f.name }] : [...path, { id: f.id, name: f.name }])
              }}
              data-folder={f.name}
            >
              <FolderIcon size={20} />
              <span>{f.name}</span>
              <ChevronRight size={18} className="faint" />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

export function SettingsPage() {
  const folder = useLibrary((s) => s.folder)
  const email = useLibrary((s) => s.email)
  const songs = useLibrary((s) => s.songs.length)
  const downloaded = useLibrary((s) => s.downloaded.size)
  const keepAll = useLibrary((s) => s.keepAll)
  const totalSize = useLibrary((s) => s.songs.reduce((n, x) => n + x.size, 0))
  const downloadingNow = useLibrary((s) => Object.keys(s.downloading).length)
  const pending = useLibrary((s) => s.pending.length)
  const crossfade = usePlayer((s) => s.crossfade)
  const [choosing, setChoosing] = useState(false)
  const [usage, setUsage] = useState<string>('')
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => e.usage && setUsage(`${(e.usage / 1024 / 1024).toFixed(0)} MB`))
  }, [downloaded])
  if (choosing) return <div className="page"><FolderPicker onDone={() => setChoosing(false)} /></div>
  return (
    <div className="page">
      <header className="top-bar">
        <button className="icon-btn" onClick={back} aria-label="Back">
          <ChevronLeft size={26} />
        </button>
        <h1>Settings</h1>
      </header>
      <section className="card-box">
        <h2>Music folder</h2>
        <p>
          <FolderIcon size={14} /> {folder?.name ?? 'None'} · {songs} songs
        </p>
        <div className="buttons">
          <button className="btn" onClick={() => void refreshLibrary()}>
            <RefreshCw size={16} /> Check for new songs
          </button>
          <button className="btn" onClick={() => setChoosing(true)}>
            Change folder
          </button>
        </div>
        {pending > 0 && <p className="faint small">{pending} {pending === 1 ? 'change waits' : 'changes wait'} to be saved to Drive (next time you’re online).</p>}
      </section>
      <section className="card-box" data-crossfade-setting>
        <h2>Playing</h2>
        <label className="range-row">
          <span className="grow">
            <strong>Crossfade between songs</strong>
            <span className="faint small">
              {crossfade
                ? `The next song fades in over the last ${crossfade} ${crossfade === 1 ? 'second' : 'seconds'} of this one.`
                : 'Off: each song plays after the last one ends.'}
              {!volumeWorks && crossfade > 0 && ' On iPhone this is new: if the music stops when you lock the screen, turn it off.'}
            </span>
          </span>
          <span className="range-value">{crossfade ? `${crossfade} s` : 'Off'}</span>
        </label>
        <input type="range" className="setting-range" min={0} max={CROSSFADE_MAX} step={1} value={crossfade} onChange={(e) => setCrossfade(Number(e.target.value))} data-crossfade aria-label="Crossfade between songs" />
      </section>
      <section className="card-box">
        <h2>Downloads</h2>
        <label className="switch-row" data-keep-all>
          <span className="grow">
            <strong>Keep all my music on this phone</strong>
            <span className="faint small">Downloads every song (about {totalSize >= 1024 ** 3 ? `${(totalSize / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(totalSize / 1024 ** 2))} MB`}), and new ones as they appear, so everything plays without internet.</span>
          </span>
          <input
            type="checkbox"
            className="switch"
            checked={keepAll}
            onChange={(e) => {
              if (e.target.checked && totalSize > 2 * 1024 ** 3 && !confirm(`That’s about ${(totalSize / 1024 ** 3).toFixed(1)} GB. Make sure your phone has room, and you’re on Wi-Fi. Carry on?`)) return
              void setKeepAll(e.target.checked)
            }}
          />
        </label>
        <p>
          {downloaded} of {songs} {songs === 1 ? 'song' : 'songs'} on this phone{usage ? `, ${usage} used` : ''}.
          {downloadingNow > 0 && ` Downloading ${downloadingNow} more…`}
        </p>
        {keepAll && downloadingNow > 0 && <p className="faint small">Keep the app open while it downloads. If you leave it, it carries on next time you open it.</p>}
        <button
          className="btn danger"
          disabled={!downloaded}
          onClick={() => {
            if (!confirm('Remove every downloaded song from this phone? They stay in your Drive.')) return
            void setKeepAll(false)
              .then(() => db.clear('songs'))
              .then(() => useLibrary.setState({ downloaded: new Set() }))
          }}
        >
          <Trash2 size={16} /> Remove all downloads
        </button>
      </section>
      <section className="card-box">
        <h2>Google account</h2>
        <p>{email || 'Signed in'}</p>
        <button
          className="btn"
          onClick={() => {
            if (!confirm('Sign out? Downloaded songs stay on this phone until you remove them.')) return
            void signOut().then(() => useLibrary.setState({ signedIn: false, needsSignIn: false }))
          }}
        >
          <LogOut size={16} /> Sign out
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (!confirm('Start again? This forgets your folder, downloads and Google client ID on this phone (nothing in Drive changes).')) return
            void (async () => {
              await forgetFolder()
              await signOut()
              await saveClientId('')
              location.reload()
            })()
          }}
        >
          Start again
        </button>
      </section>
      <p className="faint small center">Orbit Music · your playlists, likes and plays are shared with Orbit on your computer through orbit-music.json.</p>
    </div>
  )
}
