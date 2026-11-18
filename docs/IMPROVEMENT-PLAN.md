# PanoPlayer Improvement Plan

Review date: 2026-11-18 (version 0.4.47). Status markers: **[done]** shipped in 0.4.48, the
performance and package-size pass, **[open]** still recommended.

## 1. Architecture

- **A1 [open] Message router for the extension host.** `src/extension.cjs` handles
  about ten webview message types in one `if` chain, repeating `id`/`session`
  validation and per-feature busy flags. Replace it with a table of
  `{ type → { validate, handler, concurrency } }` and one request/response helper
  that attaches `session`/`id` and converts errors into replies. Each handler then
  becomes a small, separately testable module.
- **A2 [open] Shared message protocol.** Message names (`read-media`,
  `video-stream`, …) are string literals duplicated across host, webview, worker
  and tests. Add one `protocol.js` with constants and JSDoc request/reply shapes.
  Make every request receive a reply (a second `select-audio` is silently dropped
  today) and validate `session` on `read-media`.
- **A3 [open] Bundle the extension host.** `.vscodeignore` is a hand-maintained
  allowlist; commit `eeabae4` already fixed a missing file. Bundling the host with
  esbuild into `dist/extension.cjs` removes that class of packaging bug.
- **A4 [open] Plugin trust boundary.** Plugins load with `import()` into the
  player webview and can send every host message (read host JSON, open native
  video streams, write the clipboard). Document that plugins are fully trusted,
  or expose a capability-filtered API if untrusted plugins become a goal.
- **A5 [done] Package size.** Codec source archives moved to a GitHub Release
  (see `codec-sources/README.md`); see section 3.

## 2. Design

- **D1 [open] Cache FFmpeg discovery and abstract the native backend.**
  `src/video-proxy.cjs` re-probes `PATH` (up to 15 s) on every stream open and is
  macOS/VideoToolbox-only. Cache the probe per activation and introduce a backend
  strategy (`videotoolbox`, later `nvenc`/`qsv`/`vaapi`, then WASM).
- **D2 [open] Seek debouncing for the native bridge.** Each seek spawns a new
  FFmpeg process; scrubbing can hit the four-stream cap while old processes
  drain. Debounce on the webview, and cancel the oldest stream instead of
  refusing the newest.
- **D3 [open] Settings precedence.** Document how `globalState` preferences and
  media JSON/JSONPP settings interact; consider `contributes.configuration`.
- **D4 [open] Formatter.** Several files pack many statements per line
  (`media/player.js` is 32 KB in 585 lines). Adopt Prettier or Biome.

## 3. Performance and package size

- **P1 [done] Video frame queue.** The player kept one decoded frame ahead; any
  worker hiccup became a late frame. It now keeps a short queue and presents the
  newest due frame, closing stale ones, so short decode stalls are absorbed.
- **P2 [done] Pipelined host media reads.** Host-backed media (desktop and
  Remote) moved 256 KB per webview round trip with no read-ahead. Reads now ramp
  to 1 MB chunks with one chunk prefetched, cutting round trips by up to 8× —
  the main win on high-latency Remote connections. Host-side reads no longer copy
  each chunk twice.
- **P3 [done] Audio chunk allocation.** Full audio chunks are transferred
  without a second copy.
- **P4 [done] VSIX size.** Codec source archives (≈18 MB) are published as
  release assets with SHA-256 hashes instead of being bundled; the extension
  icon is resized to 256 × 256. No runtime capability changes: all decoders
  remain in the package.
- **P5 [open] Direct `VideoFrame` texture upload.** Frames are drawn to a 2D
  canvas, then uploaded as a `CanvasTexture`. Uploading the `VideoFrame`
  directly would save a GPU copy, but the canvas also serves paused redraws,
  thumbnails and plugins, so it needs a dedicated frame-holder refactor.

### Measured results (2026-11-18, Apple Silicon Mac, VS Code 1.146 / Chrome 150)

| Check | Before | After |
|---|---|---|
| VSIX size | 20 MB | 2.24 MB |
| Host read throughput, simulated 40 ms Remote round trip | 50 Mbit/s | 338 Mbit/s |
| Host read throughput, simulated 80 ms Remote round trip | 26 Mbit/s | 173 Mbit/s |
| Desktop first frame, 4K H.264 (3 runs) | 471–516 ms | 470–495 ms |
| Desktop first frame, 5.7K HEVC via VideoToolbox bridge (3 runs) | 1.08–1.47 s | 1.07–1.13 s |

Local desktop playback was already real time on this machine (≈29.8 fps, 0 drops)
and remains so; the transport gain shows up on high-latency Remote links. Playback
was verified at 30 fps with 0 dropped frames, working seeks and no page errors in:
desktop VS Code (including seek/pause/EOF replay), the static web build (Chrome),
and a real remote extension host via `code serve-web` (`vscode-remote` documents:
JSONPP sessions, direct MP4, and switching to session external audio mid-playback).
Throughput figures come from `tests/host-file.test.cjs`'s latency harness, since a
loopback Remote has no meaningful round-trip time.

## 4. Observability and alerting

| Layer | Signal | Threshold and action |
|---|---|---|
| Runtime (webview) | dropped/total frames, decode time, host-read latency p95, audio underruns, decoder fallbacks | Sample every 10 s to the Output channel; show a transport badge when dropped frames exceed 5 % over 10 s or 3 underruns occur in 30 s. |
| Host | FFmpeg spawn time, exit code, stderr tail, stream cap hits, probe timeouts | Structured log lines; one warning per session with an install link when FFmpeg is missing or fails twice. |
| CI | `tests/playback-performance.cjs` | Fail on a > 20 % regression of frame-time p95 or first-frame time against a committed baseline. |
| Release | VSIX size and file manifest | `tests/vsix-package.test.cjs` checks the manifest; add a size budget. |
| Optional telemetry | the same counters, opt-in | `@vscode/extension-telemetry`, honouring `telemetry.telemetryLevel`. |

## 5. Suggested order

1. Split the uncommitted working tree into feature commits.
2. D1/D2 (FFmpeg probe cache, seek debounce) for the new native bridge.
3. A1/A2 (router and protocol), then A3 (bundled host).
4. P5 and the CI performance budget.
