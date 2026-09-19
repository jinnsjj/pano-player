# PanoPlayer

**Explore panoramic video, listen to spatial audio, and see sound directions live in VS Code.**

PanoPlayer brings panoramic video, four-channel first-order Ambisonics (FOA), and a live PowerMap into one player. Review spatial recordings, explore panoramic footage, and compare sound directions with the scene. Standard mono and stereo media play too.

![PanoPlayer Panorama view with a live sound-direction overlay and playback and audio controls below](docs/images/panorama.jpg)

*Panorama view shows the full scene alongside sound directions. Projection, view, PowerMap, and audio settings stay together below the picture.*

## Explore The Scene

- **Panorama** unfolds the image for a full-scene overview of the picture and sound directions.
- **Perspective** renders a perspective view of your current heading. Drag to look around, scroll to adjust the field of view, and reset to face forward.
- **Viewfinder thumbnail** marks the current field of view on a panorama overview, so you always know where you are looking.
- Switch views directly with tabs without reopening the media. Seek, adjust volume, mute, or enter full screen from the playback controls.

![PanoPlayer perspective view with a panorama viewfinder thumbnail and Binaural monitoring selected](docs/images/spatial.jpg)

*The panorama thumbnail marks the current view. With Binaural selected, FOA audio rotates with your viewing direction.*

## See And Hear Sound Directions

**Live PowerMap** estimates sound directions from four-channel FOA audio and updates a MUSIC heatmap during playback. Toggle the overlay or adjust its opacity to compare sound locations with the picture, without changing the source media.

**Binaural monitoring** uses Omnitone to render FOA for headphones. In Perspective view, turning the camera also changes your listening direction. Stereo Monitor provides an alternative mix fixed to the recording axes.

**Explicit FOA settings** support WYZX / WXYZ channel order and SN3D / N3D normalization. Set order and normalization independently without reopening the file.

> Four channels do not automatically mean FOA. Spatial processing expects first-order Ambisonics, not ordinary quadraphonic speaker audio. PowerMap currently uses single-source MUSIC for qualitative direction review; it is not a calibrated sound-pressure measurement or source-separation tool.

## 180°, 360°, And EAC

| Source | Playback |
| --- | --- |
| 360° ERP | Panorama or Perspective view, including frames that are not exactly 2:1; the overlay stretches to match the image |
| 180° ERP | Placed in the front half of a full 360° coordinate domain, with a blank rear hemisphere to avoid horizontally compressing the direction map |
| EAC (3×2) | Real-time projection conversion for the supported cube-face layout, without transcoding the whole video first |
| Mono / Stereo SBS / Stereo TB | Mono plays directly; side-by-side uses the left eye, and top-bottom uses the top eye |

Near-square frames default to 180° ERP; other aspect ratios default to 360° ERP. This is an initial guess, not projection detection. Confirm Projection and Layout manually for EAC and stereo sources. Stereo support means **single-eye playback**, not stereoscopic output to a VR headset.

## Spatial Audio Without Video

Play FOA WAV files with a standalone full-sphere PowerMap, channel-order and normalization settings, and binaural monitoring. No placeholder video is needed.

![PanoPlayer playing four-channel WAV with a standalone PowerMap and spatial audio controls](docs/images/wav.jpg)

*A live direction map from four-channel WAV. Mono and stereo audio automatically use Bypass, without FOA analysis or binaural rendering.*

Mono and stereo video retain Panorama and Perspective viewing. Audio passes through with its decoded channels preserved, with volume and mute controls.

## Streaming And Remote Media

- **Four-channel MP4 + AAC and WebM + Opus** use bundled WASM audio decoders. Playback decodes as data arrives rather than waiting for a whole-file transcode.
- **WAV playback** is supported. MOV and MKV also have open-with entries; playback depends on the codecs inside, not just the file extension.
- **Local, Remote SSH, and Cloud IDE** media are read from the workspace host, without manually downloading the entire file first.
- **No extra decoder setup**: the current player needs no user-installed FFmpeg, FFprobe, or Python, and no additional server or port forwarding.
- **Source files stay unchanged**, and media is not uploaded to third-party processing services.

Video decoding depends on the host browser's WebCodecs support. Perspective view, EAC, and single-eye cropping require WebGL2. The player supports 1, 2, or 4 channels and uses the primary audio track. Other channel counts, track selection, FuMa normalization, and arbitrary cube-face layouts are not supported.

## Open Your Media

Choose **Open With > PanoPlayer** on a media file, or run **PanoPlayer: Open Media**.

Requires VS Code 1.84+ and a Node extension host with access to workspace files. Cloud IDE must allow Webviews, Workers, WebAssembly, and Web Audio. Browser-only vscode.dev without a remote extension host is not supported.

Screenshots show the actual player Webview running in a local Chrome test host, not mockups. They do not imply validation on every Cloud IDE or platform.

For installation, migration, and development, see the [technical reference](docs/REFERENCE.md). See [third-party notices](THIRD_PARTY_NOTICES.md) for component licenses.
