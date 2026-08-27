# REPLICO

Hear it. Replicate it.

A party game: hear a sound, imitate it into your microphone, get scored on
pitch / timing / energy, and hear your own attempt played back. Runs in the
browser; single-player and a 2-6 player online multiplayer mode both work
today.

## Quick start (local)

REPLICO needs no `npm install` - a portable Node and the one dependency
(`ws`) are already included in this folder.

```
.tools/node-v22.14.0-win-x64/node.exe server.js
```

(or, if `node` is already on your PATH: `node server.js` / `npm start`)

This starts ONE process that serves both:
- the web game at `http://localhost:8710`
- the multiplayer WebSocket server at `ws://localhost:8710/ws`

Open the URL in a browser, allow microphone access, and play. For
multiplayer, open the same URL in multiple browsers/devices on the same
network, or deploy it (see below) and share the real URL.

## Project layout

```
replico/
  server.js            Static file server + attaches the multiplayer WS server
  server/              Multiplayer server code (Node, no browser APIs)
    config.js            Port / WebSocket path - reads env vars, no hard-coded localhost
    rooms.js              Room/turn/score state machine (pure logic, no sockets)
    soundIds.js            Sound id list mirrored from the client library (for turn dealing only)
    wsServer.js            WebSocket message handling, wraps rooms.js
  public/               Everything served to the browser (the actual game)
    index.html            All screens/markup, the garage scene, the character
    style.css             All visual styling/animation
    config.js              Client runtime config (WebSocket URL resolution)
    app.js                 Single-player game loop (unchanged since the first prototype)
    multiplayer.js          Multiplayer game loop (lobby, rooms, turns, leaderboard)
    audio/
      recorder.js           Microphone capture (getUserMedia + MediaRecorder)
      analyzer.js            Signal analysis: envelope, silence trim, pitch detection
      scoring.js              Turns analysis into PITCH/TIMING/ENERGY/OVERALL
      sound-generator.js       The original "boing" test sound (Web Audio synthesis)
      sound-library.js         All sounds (synthesized SFX + real animal recordings) + the sound deck
      samples/                Real animal sound files (mp3) + CREDITS.md
    net/
      multiplayer-client.js   Thin WebSocket client wrapper (no DOM access)
    game-config.js          Tunable gameplay timing (recording duration, etc.)
  node_modules/ws/       The `ws` package (vendored so this works fully offline)
```

## Where things live

- **Sounds**: `public/audio/sound-library.js` - 61 sounds total.
  - Non-animal sound effects (siren, robot beep, kazoo, car horn, ...) are
    still synthesized with the Web Audio API at runtime - no files, no
    copyright concerns.
  - Animal sounds are real recordings (not synthesized) in
    `public/audio/samples/*.mp3`, loaded via `fetch` + `decodeAudioData`.
    46 real animal clips cover chicken, rooster, pig, horse, dog (regular/
    small/big/howl), cat, cow, sheep, goat, duck, turkey, monkey, donkey,
    frog, bird, owl, goose, plus bonus lion/chimp/elephant/bear/wolf clips -
    each sourced from Wikimedia Commons or Internet Archive under CC0/CC-BY/
    Public Domain licenses. See `public/audio/samples/CREDITS.md` for the
    exact source, author, and license of every file.
  - To add an animal sound: drop an mp3 into `public/audio/samples/`, add a
    `sampleEntry('id', 'Display Name', 'file.mp3')` line to
    `ANIMAL_SOUND_ENTRIES` in `sound-library.js`, add the same `id` string to
    `server/soundIds.js` (the server only needs the id, never the audio
    itself, to deal a fair no-repeat sound each round), and add a credit row
    to `CREDITS.md`. To add a non-animal SFX, write a small
    `createX(sampleRate)` function using the existing synth helpers instead.
- **Recording length**: `public/game-config.js` -
  `RECORD_DURATION_MS` (currently 2000ms). Change it there; both
  single-player and multiplayer read from this one place.
- **Character / garage art**: inline SVG in `public/index.html` (the
  `.garage-bg` svg and the `#character` svg). There is one character today;
  multiplayer clones it per connected player via `cloneNode` and tints each
  with a CSS filter - no per-player art yet.
- **Multiplayer settings**: `server/config.js` (server: port, WS path) and
  `public/config.js` (client: WebSocket URL). See below for changing these
  for production.
- **Live voice chat**: `public/net/voice-chat.js` (client, WebRTC mesh) +
  the `voice-signal` relay branch in `server/wsServer.js` (the server never
  looks at the audio, just forwards signaling messages between the two
  players in a room). Multiplayer only - it starts the moment a room is
  joined/created and never runs in single-player.

## Multiplayer, in short

- Open the site, click MULTIPLAYER, enter a name, then either **HOST GAME**
  (get a 4-letter room code to share) or **JOIN GAME** (enter a friend's
  code). 2-6 players per room.
- Everyone appears in the garage immediately after joining and stays
  visible there for the whole match - only the active player's character
  walks to the mic each turn; everyone else just watches from their spot.
- The host presses **START GAME**. Each round, the server deals ONE sound
  from a shared no-repeat-until-exhausted deck, and every player in the
  room imitates that SAME sound in turn (not a different sound each) -
  hear it, countdown, record, hear your own playback, see your
  pitch/timing/energy score.
- After the last player's turn in a round, a ROUND RESULTS screen ranks
  that round only (1st/2nd/3rd/...). Then the next round deals a new
  sound.
- Only the active player's browser actually records their microphone and
  runs the (unchanged) analyze/score pipeline locally; it then sends the
  score + the recorded audio to the server, which broadcasts both to
  everyone so the whole room hears the attempt and sees the reaction/score
  together.
- After 5 rounds, everyone sees a ranked FINAL RESULTS screen with each
  player's 5-round total and a clear winner banner.
- Known limitation (by design, for this first version): if a player closes
  their tab mid-match, the match does not reassign their turn - this keeps
  the turn logic simple for now. Fine for a private game with friends;
  worth hardening before a public release.

## Test multiplayer right now

You do **not** need a second computer to try this - separate browser tabs
(or windows) each get their own independent connection, so they act as
separate players even on one machine.

1. Make sure the server is running (`node server.js`, or it may already be
   running from development - check for `http://localhost:8710` in your
   browser history/an open tab).
2. Open `http://localhost:8710` in **Tab A**. Click MULTIPLAYER, type a
   name, click **HOST GAME**. Note the 4-letter room code shown.
3. Open a **new tab** (or a new window - regular or private/incognito,
   either works) at the same `http://localhost:8710`. Click MULTIPLAYER,
   type a different name, type the room code from step 2, click
   **JOIN GAME**.
4. Repeat step 3 in more tabs for more players (up to 6 total).
5. Allow the microphone permission prompt in **every** tab (each one asks
   separately).
6. Back in Tab A (the host), click **START GAME**.
7. Switch between tabs as the "YOUR TURN" label changes - each tab shows
   whose turn it is, plays the shared sound, and only records when it's
   that tab's turn.

For a real test with friends over the internet, deploy it (next section)
and just send them the one URL - no room code sharing needed until they're
both on the page.

## Deploying the web version

REPLICO's networking is never hard-coded to `localhost`:

- **Server side** (`server/config.js`): reads `PORT` from the environment
  (most hosts set this for you) and defaults to `8710` locally.
- **Client side** (`public/config.js`): `WS_URL` defaults to empty, which
  means "auto-detect from the page's own origin" - so the exact same
  static files work on `localhost` during development and on a real
  domain in production with zero edits. Only set `WS_URL` explicitly if
  your WebSocket server will live on a *different* host than the one
  serving the static files.

To deploy:
1. Upload this whole `replico/` folder to any Node-capable host (a plain
   VM, Render, Railway, Fly.io, etc. - anything that can run
   `node server.js` and exposes one HTTP port for both the page and the
   WebSocket upgrade).
2. Point your domain (e.g. `replico.yourdomain.com`) at that host.
3. That's it - `https://replico.yourdomain.com` will serve the game, and
   the browser will automatically speak `wss://replico.yourdomain.com/ws`
   for multiplayer.

If you ever split static hosting (e.g. a CDN) from the multiplayer server
(a separate always-on host), set `window.REPLICO_CONFIG.WS_URL` in
`public/config.js` to that server's full `wss://...` URL before uploading
the static files.

## Toward a downloadable / Steam build (not built yet, on purpose)

Nothing Steam-specific exists yet, per the current instructions - but the
code is already organized to make that a re-skin, not a rewrite:

- `public/audio/*.js` (recorder, analyzer, scoring, sound library) and
  `public/net/multiplayer-client.js` touch **only** the Web Audio API and
  WebSocket - zero DOM/`document` references. They can be reused as-is in
  any Chromium-based desktop shell.
- The most common path to a Steam build is wrapping this same `public/`
  folder in Electron (Steam ships plenty of Electron games) - the HTML/CSS/
  JS would run largely unchanged, with `server.js` either bundled locally
  for offline single-player or pointed at a hosted multiplayer server via
  `public/config.js`.
- The parts that *would* need work for a store release: Steamworks SDK
  integration (achievements, friends, overlay), an installer/build
  pipeline, and replacing the fixed turn-pacing delays in
  `server/wsServer.js` with proper per-client ready-acknowledgements.

## Known simplifications (first working version)

- Turn pacing between players is a fixed server-side delay (4s between
  turns, 3.5s between rounds) rather than waiting for explicit "I'm ready"
  acknowledgements from every client. Fine on a normal connection; a very
  slow client could feel rushed.
- No reconnect/resume support if a player's connection drops mid-match.
- Only one character design exists; multiplayer distinguishes players with
  a color tint + name tag rather than unique art.
- Voice chat uses public STUN (Google) and a free public TURN fallback
  (Open Relay Project) for NAT traversal - works for the vast majority of
  home networks, but a small number of very restrictive/corporate networks
  could still fail to establish a direct peer connection without a
  dedicated paid TURN server.
