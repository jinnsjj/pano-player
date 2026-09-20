<p align="center">
  <img src="media/icon.png" width="128" height="128" alt="PanoPlayer logo">
</p>

# PanoPlayer

[![Marketplace version](https://badgen.net/vs-marketplace/v/shijunjie.pano-player)](https://marketplace.visualstudio.com/items?itemName=shijunjie.pano-player)
[![Marketplace installs](https://badgen.net/vs-marketplace/i/shijunjie.pano-player)](https://marketplace.visualstudio.com/items?itemName=shijunjie.pano-player)
[![VS Code compatibility](https://img.shields.io/badge/VS%20Code-1.84%2B-3575b5)](docs/REFERENCE.md)
[![MIT license](https://img.shields.io/github/license/jinnsjj/pano-player?color=858585)](LICENSE)

**Explore panoramic video, listen to spatial audio, and see sound directions live in VS Code.**

Review 180° and 360° video with four-channel first-order Ambisonics (FOA), camera-relative binaural audio, and live PowerMap overlays. Standard mono and stereo media play without spatial processing, locally or through Remote SSH and Cloud IDE.

[Get PanoPlayer](https://marketplace.visualstudio.com/items?itemName=shijunjie.pano-player) · [Technical reference](docs/REFERENCE.md) · [Report an issue](https://github.com/jinnsjj/pano-player/issues)

![PanoPlayer Panorama view with a live sound-direction overlay and playback and audio controls below](docs/images/panorama.jpg)

*Panorama view shows the full scene alongside sound directions. Projection, view, PowerMap, and audio settings stay together below the picture.*

## Explore The Scene

- **Panorama**: see the unfolded scene and sound directions together.
- **Perspective**: drag to look around, scroll to change the field of view, and reset to face forward.
- **Viewfinder thumbnail**: locate your current view within the full panorama.
- **Playback controls**: switch view tabs, seek, adjust volume, mute, and enter full screen without reopening the file.

![PanoPlayer perspective view with a panorama viewfinder thumbnail and Binaural monitoring selected](docs/images/spatial.jpg)

*The panorama thumbnail marks the current view. With Binaural selected, FOA audio rotates with your viewing direction.*

## See And Hear Sound Directions

**Live PowerMap** estimates sound directions from four-channel FOA audio during playback. Toggle the MUSIC heatmap or adjust its opacity to compare sound locations with the picture.

**Binaural monitoring** uses Omnitone to render FOA for headphones. Turning the Perspective camera changes your listening direction. **Stereo Monitor** keeps the mix aligned to the recording axes.

Choose **WYZX / WXYZ** channel order and **SN3D / N3D** normalization independently, without reopening the file.

> Four channels do not automatically mean FOA. Spatial processing expects first-order Ambisonics, not ordinary quadraphonic speaker audio. PowerMap currently uses single-source MUSIC for qualitative direction review; it is not a calibrated sound-pressure measurement or source-separation tool.

## 180°, 360°, And EAC

| Source | Playback |
| --- | --- |
| Auto (default) | Infer 180° ERP for a near-square single-eye image; otherwise use 360° ERP |
| 360° ERP | Panorama or Perspective view, including frames that are not exactly 2:1; the overlay stretches to match the image |
| 180° ERP | Placed in the front half of a full 360° coordinate domain, with a blank rear hemisphere to avoid horizontally compressing the direction map |
| EAC (3×2) | Real-time projection conversion for the supported cube-face layout, without transcoding the whole video first |
| Mono / Stereo SBS / Stereo TB | Mono plays directly; side-by-side uses the left eye, and top-bottom uses the top eye |

Auto reevaluates each video and stereo layout. It is a heuristic, not projection detection: choose EAC or override ERP when needed. Stereo support means **single-eye playback**, not stereoscopic output to a VR headset.

## Keep Your Settings

Projection, layout, view, camera direction, audio, volume, mute, and overlay settings carry over between files and restarts. Use **Restore default settings** to reset them without interrupting playback. Playback position is not carried over; local and remote extension hosts keep separate preferences.

## Spatial Audio Without Video

Play FOA WAV files with a standalone full-sphere PowerMap, channel-order and normalization settings, and binaural monitoring. No placeholder video is needed.

![PanoPlayer playing four-channel WAV with a standalone PowerMap and spatial audio controls](docs/images/wav.jpg)

*A live direction map from four-channel WAV. Mono and stereo audio automatically use Bypass, without FOA analysis or binaural rendering.*

Mono and stereo video retain Panorama and Perspective viewing. Audio passes through with its decoded channels preserved, with volume and mute controls.

## Streaming And Remote Media

- **Four-channel MP4 + AAC and WebM + Opus** use bundled WASM audio decoders. Playback decodes as data arrives rather than waiting for a whole-file transcode.
- **MP4, WebM, MOV, MKV, and WAV** are available in Open With. Playback depends on the codecs inside each file.
- **Local, Remote SSH, and Cloud IDE** media are read from the workspace host, without manually downloading the entire file first.
- **No extra decoder setup**: no user-installed FFmpeg, FFprobe, Python, server, or port forwarding.
- **Source files stay unchanged**, and media is not uploaded to third-party processing services.

Video decoding depends on the host browser's WebCodecs support. Perspective view, EAC, and single-eye cropping require WebGL2. The player supports 1, 2, or 4 channels and uses the primary audio track. Other channel counts, track selection, FuMa normalization, and arbitrary cube-face layouts are not supported.

## Open Your Media

Choose **Open With > PanoPlayer** on a media file, or run **PanoPlayer: Open Media**.

Requires VS Code 1.84+ and a Node extension host with access to workspace files. Cloud IDE must allow Webviews, Workers, WebAssembly, and Web Audio. Browser-only vscode.dev without a remote extension host is not supported.

Screenshots show the actual player Webview running in a local Chrome test host, not mockups. They do not imply validation on every Cloud IDE or platform.

For installation and development, see the [technical reference](docs/REFERENCE.md). See [third-party notices](THIRD_PARTY_NOTICES.md) for component licenses.
