# Local Web Player

The web target shares the extension's player, projection, decoder, audio graph,
PowerMap, envelope and meter code. It is a static site, not a media-processing
server. The VS Code extension remains a separate build target.

## Build And Run

Use Node.js 22 or newer with npm:

```sh
npm ci
npm run build:web
npm run preview:web
```

Open the printed URL (normally `http://127.0.0.1:4173`). The preview binds only
to loopback and chooses a free port if 4173 is occupied. Set `PORT` to choose
another port. Rebuild after source changes, then reload the page.

The output directory is `output/web`. It includes HTML, scripts, styles, icons,
WASM and license notices, without media samples or repository source files.
The preview only serves that directory and accepts GET/HEAD, not uploads.
Do not open `index.html` with `file://`: module fetches, workers and audio APIs
need an appropriate origin. Node is only a build/preview tool, not a deployed
runtime dependency.

## Runtime And Privacy

- Use a recent desktop Chrome or Edge first. WebCodecs, AudioWorklet, WebGL and
  a secure context (HTTPS or localhost) are required. Other browsers and mobile
  devices need their own codec and performance validation.
- Open or drop one file at a time. MP4, WebM, WAV, FLAC, MOV and MKV are offered;
  the actual codec/profile must be decodable on that browser and machine.
- A `File` is structured-cloned to decoder/envelope workers. Mediabunny's
  `BlobSource` reads ranges from the local file without uploading it or buffering
  the entire compressed file in JavaScript memory. Decoding still consumes RAM;
  envelope analysis eventually scans the audio track.
- Scripts, WASM and icons are bundled. No CDN, telemetry, media upload endpoint,
  native FFmpeg process or Python runtime is used in the web playback path.
- Settings alone are stored in localStorage. File bytes, names, paths and file
  handles are not persisted. Refreshing the main page requires selecting the
  file again. The player's Retry button reloads the current in-memory selection.
- A new same-origin iframe owns each player session. Replacing/closing a file
  disposes its audio graph, workers and renderer before removing that frame.
- Below 560 px, analysis panels flow below the settings instead of floating
  over playback controls. On larger screens they remain draggable overlays.
- On Pages, the browser fetches application assets from the host. Local media
  processing is not the same as guaranteed offline page startup: this version
  has no service worker or installable PWA cache. Fully disconnected use is
  supported by serving the built directory locally.
- Deployment administrators must not inject analytics or third-party scripts
  if they want to retain the no-telemetry property.

## Media Semantics

The same limitations as the extension apply. Four channels do not prove FOA;
choose WYZX/WXYZ and SN3D/N3D to match the source. Six channels are interpreted as
FOA plus head-locked L/R, not ordinary 5.1 surround. SBS/TB selects a single eye;
it does not provide VR headset stereoscopic output. PowerMap is qualitative,
not calibrated localization. Video dimensions, codecs and hardware determine
playback limits; there is no universal HEVC or 8K performance guarantee.

VS Code commands, arbitrary filesystem paths and Remote-SSH workspace access
are not browser features. Select a file that is locally accessible instead.

## Cloudflare Pages

Live site: [pano-player.pages.dev](https://pano-player.pages.dev/).
The `pano-player` project uses Direct Upload with production branch `main`.
Rebuild and publish explicitly; the build alone does not deploy:

```sh
npm run build:web
npx wrangler@4 pages deploy output/web --project-name pano-player --branch main --commit-dirty=true
```

Wrangler must be authenticated with Pages write permission. The branch flag is
a Pages deployment label, not a Git checkout or commit. `--commit-dirty=true`
acknowledges local uncommitted changes; no Git commit or push is performed.
Only `output/web` is uploaded. Direct Upload projects cannot later switch to
Git integration in place; use a new project if Git integration is needed.

For a separate Git-integrated Pages project, use these settings:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Root directory | Repository root |
| Build command | `npm run build:web` |
| Build output directory | `output/web` |
| Node version | `NODE_VERSION=22` |

Keep npm development dependencies enabled: esbuild and the bundled browser
libraries are build-time dependencies. The lockfile uses public npm URLs.
Alternatively, build locally and use Pages Direct Upload for `output/web`.
No Functions, Workers backend, secrets, database, object storage or media upload
binding is required. Publish the directory contents, not the repository root.

The output includes `_headers` with security headers and revalidation for
unhashed assets. Each HTML entry has its own restrictive CSP; the player allows
same-origin assets and blob workers with WASM execution. The shell cannot make
fetch requests. The local preview applies the same global response headers.
`404.html` avoids Pages treating missing asset paths as SPA routes.

References: [Pages static HTML](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/),
[Pages custom headers](https://developers.cloudflare.com/pages/configuration/headers/).

## Verification

```sh
npm run test:web
npm test
```

For the optional real-browser smoke test, make `playwright` resolvable (for
example with `NODE_PATH` pointing at an existing installation), install Chrome,
start the preview, then run:

```sh
node tests/web-browser.cjs http://127.0.0.1:4173 /absolute/video.mp4 /absolute/foa.wav
```

Use a video longer than four seconds with visible content, and a four-channel
FOA WAV with a directional signal. The test checks playback/seek, nonblank
Panorama/Perspective pixels, view interaction, 390/320 px layouts, preferences,
file replacement/disposal, PowerMap/meters, corrupt-file recovery and network
requests. Screenshots and results go to `output/playwright/web`.
