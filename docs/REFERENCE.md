# PanoPlayer Technical Reference

For a feature overview and runtime screenshots, see the [introduction](../README.md).

Preview ERP/EAC panoramas and mono or stereo video in VS Code, with a live
MUSIC direction map and binaural audio for four-channel FOA sources.

## Install

Install the current `pano-player-*.vsix` using **Extensions: Install from VSIX...**,
then right-click media and select **Open With > PanoPlayer**.
**PanoPlayer: Open Media** also opens local or workspace-host files.
The VSIX publisher identifier is `JunjieShi`, so the extension ID is
`JunjieShi.pano-player`. For a VSIX-only installation the developer label uses
this identifier (spaces are not supported); `author` metadata is `Junjie Shi`.
Uninstall `spatial-audio-tools.pano-player` or the older
`spatial-audio-tools.foa-powermap-player` before using the new package. Internal
`foaPowermap.*` command/editor IDs remain stable for existing editor associations;
do not enable the old and new packages together.
MOV and MKV are also offered in Open With, the context menu and the file picker;
they use the existing playback pipeline and codec restrictions unchanged.

Requires VS Code 1.84+ with a Node workspace extension host, Web Audio and a
browser with WebCodecs video decoding. Perspective, EAC and stereo cropping require WebGL2.
No FFmpeg, FFprobe, Python, NumPy, SciPy or OpenCV installation is needed.
Old executable-path settings are no longer used.

The bundled libav.js AAC decoder is JavaScript/WebAssembly, not an OS-specific
FFmpeg executable. The same codec files can run on compatible Windows, macOS and
Linux browsers/webviews, including Cloud IDE. This is architectural portability,
not a claim that all platforms have been tested. Video decoding still depends on
the host browser's WebCodecs codec support; a Node workspace extension host is
required, so browser-only vscode.dev without a remote host is not supported.

## Streaming Playback

MP4/AAC and WebM/Opus four-channel audio uses bundled WASM decoders, independently
of VS Code's native audio codec support. WAV PCM is decoded incrementally too.
Mediabunny demuxes the original file through range requests; there is no host
inspection, full-file transcode, proxy generation, Python or subprocess startup.
Network buffering and codec initialization still take time on remote storage.

An AudioWorklet consumes discrete four-channel PCM and supplies the playback clock.
WebCodecs video frames, MUSIC overlays and camera-relative Omnitone binaural output
follow that clock. The PCM queue is bounded to four seconds, encoded cache to 8 MiB,
and video presentation retains one upcoming frame. These are application queue
limits, not a cap on browser, codec or GPU memory.

Mono and stereo inputs play through a bypass path preserving their decoded channels,
with volume/mute but no MUSIC, normalization, rotation or binaural rendering.
Perspective video and panorama navigation remain available; FOA-only controls are disabled.
Four-channel inputs retain the FOA path. Other channel counts are rejected instead
of silently downmixing or inventing FOA channels. The primary track is used;
arbitrary track selection is not provided.
Unsupported video codecs fail explicitly. The extension never changes source files,
uploads them elsewhere, or modifies VS Code's built-in Media Preview/libraries.

## Spatial Review

- Input must be FOA, not ordinary quadraphonic speaker audio. Default order is
  WYZX (AmbiX ACN); WXYZ maps to WYZX using [0, 2, 3, 1]. Normalization is an explicit
  selection (SN3D default or N3D), not inferred from the channel count. N3D input
  leaves W unchanged and divides X/Y/Z by sqrt(3) before MUSIC, stereo monitoring
  and binaural rendering. Changing order or normalization does not reopen media.
  WXYZ does not imply FuMa normalization; FuMa normalization is not supported.
- WAV plays directly with a standalone full-sphere PowerMap. No dummy video or
  complete JavaScript audio buffer is generated.
- Projection defaults to 180 ERP for aspect ratios 0.9 through 1.1, and 360 ERP
  otherwise. This is a heuristic with a manual override, not projection detection.
  Projection/order choices are not remembered; overlay opacity and enablement are.
- 180 ERP centers the source with blank sides in a double-width panorama, preserving
  the full 360-degree map domain. Non-2:1 360 ERP retains the source aspect ratio and
  stretches the spherical overlay accordingly.
- **Layout** selects Mono, Stereo SBS (left eye), or Stereo TB (top eye).
  Cropping happens before rendering and works with both 180/360 ERP and EAC.
  Set projection and layout explicitly for stereo sources; the aspect heuristic
  cannot distinguish 180 mono from 360 TB, or 360 mono from 180 SBS.
- **EAC (3x2)** uses the conventional left/front/right and down/back/up layout,
  face rotations and two-pixel padding compatible with
  [FFmpeg v360](https://ffmpeg.org/doxygen/8.0/vf__v360_8c_source.html).
  A local GPU pass unfolds it to ERP for Panorama, Perspective and the overview.
  No full-file conversion occurs; the full-sphere PowerMap and audio stay unchanged.
  Other cube layouts, fisheye and headset stereoscopic rendering are not supported.
- Panorama/Perspective tabs preserve playback. Drag or use arrows to turn, scroll or
  +/- to change FOV, and Home/Reset to face forward. The thumbnail marks the current
  view, including seam wraparound and the blank rear hemisphere in 180 mode.
- Binaural audio follows the camera. Stereo Monitor uses the fixed recording-axis
  mix L = .5W + .25X + .25Y and R = .5W + .25X - .25Y. Volume/mute do not change analysis.
- MUSIC uses one source, 1024-sample windows, 140x70 maps, averaging .666 and a
  140 ms capture interval. Seek/order changes invalidate queued results.
  This is a qualitative localization view, not calibrated acoustic measurement.
  Maps update while audio plays; paused seeks do not precompute a new map.

## Cloud IDE

Install the VSIX in the Cloud IDE workspace and reload that workspace window.
Open files on its workspace host, not paths from the browser computer.
Media travels in bounded 256 KiB reads through the extension's webview messaging;
only the opened document can be read, with at most four concurrent requests.
This avoids VS Code 1.84's incorrect/non-streaming HTTP Range implementation.
Bundled code uses VS Code's webview resource mechanism;
there is no extra server, port forwarding or public sharing.
Cloud IDE must allow media resource reads, seeking and Web Audio/Worker/WASM execution.
A backpressured window-to-worker bridge preserves bounded reads. No extra server
is required. Network speed and video codec support still matter.

**PanoPlayer: Clear Playback Cache** explicitly removes old 0.1.x proxy files.
The streaming player does not create such files or run cleanup during preview startup.

## Development

```sh
git lfs install
git lfs pull
npm ci
npm test
npm run package
code --extensionDevelopmentPath="$PWD"
```

This directory is an independent Git repository. Run the commands above from its
root; no sibling checkout or parent project is required. The initial source snapshot
comes from `foa-recon-demo/vscode-foa-powermap`; earlier history stays in that project.
FFmpeg/libav source archives and libav runtime files use Git LFS. Installed VSIX
users do not need Git LFS; only source checkouts need the objects downloaded before
testing or packaging. Do not package a checkout containing LFS pointer placeholders.

`README.md` is the feature overview; screenshots in `docs/images/` were captured
from the real player using `tests/stream-server.cjs` in Chrome on 2026-09-19.
Panorama and Perspective use `C5JzzjCHMuA_470.webm`; WAV uses `voice_o1_ambix.wav`.
These screenshots predate the tab rename from Spatial to Perspective.
No media samples are included in the package. Screenshots are unedited JPEG captures.
The source README keeps relative image and documentation links. `npm run package`
uses VSCE's standard GitHub URL rewriting against the repository's `main` branch.
Installed extension details load screenshots over HTTPS and require network access
to GitHub's raw image host. Base64 images are not used: VS Code's Markdown sanitizer
removes their addresses. Publishing the GitHub repository is separate from publishing
the extension to Marketplace.

`build.cjs` bundles the capture and MUSIC code in `src/powermap/` for
webview-compatible workers. Runtime dependencies are bundled; esbuild is build-only.
Retired Python/proxy code remains in the repository for reference tests but is
excluded from the VSIX. See [validation](../VALIDATION.md) for measured results and remaining checks.
