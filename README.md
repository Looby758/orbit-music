# Orbit Music

The phone app for Orbit's music player: your own music, straight from your Google Drive music
folder, with the same playlists, liked songs and play counts as Orbit on your computer.

It's a web app you add to your phone's home screen. It runs from GitHub Pages at
`https://looby758.github.io/orbit-music/`.

## What it does

- Signs in with Google and reads the music folder Orbit uses (MP3, M4A, FLAC, WAV, OGG, Opus),
  including the folders inside it.
- Shows songs, albums, artists, playlists, Liked songs, Recently added and Most played, with the
  covers and details saved inside the MP3 files.
- Plays with the lock screen and headphone controls, shuffle, repeat and Up next.
- Crossfades between songs (Settings → Playing, up to 12 seconds). iPhones don't let web apps change a
  song's volume, so there the sound goes through Web Audio once crossfade is on.
- Likes, plays and playlist changes are written to `orbit-music.json` in the music folder, the same
  file Orbit on the computer uses, so both stay in step.
- Downloads songs, albums or playlists to the phone for playing with no signal.
- **Control my computer**: with the phone remote turned on in Orbit (Music page → phone button),
  Home shows each computer; tap one to play, pause, skip, seek, change the volume and pick from Up
  next there. Orbit says where its remote is in `orbit-remote-<computer>.json` in the music folder.
  The phone needs to be on the same Wi-Fi.

## Setting it up (once)

1. **Turn on GitHub Pages** for this repository: Settings → Pages → Source: **GitHub Actions**.
   Every push to `main` then publishes the app.
2. **Make a Google client ID** in the same Google Cloud project as Orbit's Google sign-in:
   - Enable the **Google Drive API**.
   - Credentials → Create credentials → OAuth client ID → **Web application**.
   - Authorised redirect URIs: `https://looby758.github.io/orbit-music/`
   - If the project is in testing, add your Google account under OAuth consent screen → Audience →
     Test users.
3. Open the app on your phone, paste the client ID, sign in and choose your music folder.
4. Add it to the home screen: Safari → Share → **Add to Home Screen** (Android Chrome: ⋮ → **Add to
   Home screen**).

## Things to know

- Downloaded songs always play from the phone, signed in to Google or not.
- Google gives the app a key that lasts about an hour. When the app opens after that, it goes to
  Google and straight back by itself for a new one (no tap), and only shows the "Reconnect" bar if
  Google wants you to choose something.
- **Stay signed in** (Settings → Google account): paste the client ID's **Client secret** (Google
  Cloud → Credentials → the Orbit Music client) and the app gets new keys by itself in the
  background, with no trip to Google at all. Publish the app under OAuth consent screen → Audience,
  or Google ends that long-lasting key every 7 days while it's in "Testing". The secret stays on the
  phone.
- If a song's file comes back in Drive with a new id (same name and size), its download is kept
  rather than fetched again. Downloads stopped by losing sign-in or signal carry on afterwards.
- Downloaded songs live inside the app's own storage on the phone, not in the Files app.

## Working on it

```
npm install
npm run dev        # http://localhost:5173
npm test
npm run build      # into dist/
```

`src/musicLibrary.ts` is a copy of `src/shared/musicLibrary.ts` from Orbit (notes-app), so both
read and change `orbit-music.json` the same way (including `months`, the plays kept by month for
Orbit's listening stats). Keep them the same.
