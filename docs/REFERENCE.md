# PanoPlayer Reference

Technical notes for version 0.4.17. See the [README](../README.md) for features and screenshots.

## Install

Install from [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=shijunjie.pano-player)
or run `code --install-extension shijunjie.pano-player`. For a local package, use
**Extensions: Install from VSIX...**.

Open media with **Open With > PanoPlayer** or **PanoPlayer: Open Media**.
Requires VS Code 1.84+, a Node workspace extension host, Web Audio and WebCodecs.
Perspective, EAC and single-eye cropping require WebGL2. No external FFmpeg or Python is needed.

To use PanoPlayer by default for MP4 and WebM, add these associations to your settings:

```json
{
  "workbench.editorAssociations": {
    "*.mp4": "panoPlayer.player",
    "*.webm": "panoPlayer.player"
  }
}
```

## Commands

| Command Palette title | Command ID |
| --- | --- |
| PanoPlayer: Open Media | `panoPlayer.open` |

## Media And Audio

- Containers: MP4, WebM, MOV, MKV and WAV. Playback depends on the contained codecs and browser support.
- MP4/AAC and WebM/Opus audio use bundled WASM decoders; WAV PCM is read incrementally. Playback does not wait for full-file decoding or transcoding.
- Mono/stereo audio passes through unchanged apart from volume and mute. Panorama and Perspective remain available; FOA processing is disabled.
- Videos without audio use a video clock and support both views, seeking and replay without initializing audio decoders or DSP.
- Four-channel input must be first-order Ambisonics, not quadraphonic speaker audio. Select WYZX (ACN) or WXYZ, and SN3D or N3D. Defaults are WYZX/SN3D; FuMa is unsupported.
- Binaural monitoring follows the camera direction. Stereo Monitor stays aligned to the recording axes. WAV can display a standalone PowerMap.
- When audio is present, only the primary audio track and 1, 2 or 4 channels are supported. PowerMap uses single-source MUSIC for qualitative direction review, not calibrated measurement or source separation.

## Projection And View

| Setting | Behavior |
| --- | --- |
| Auto (default) | Infer 180 ERP for a single-eye aspect ratio from 0.9 to 1.1; otherwise use 360 ERP |
| 360 ERP | Full panorama; non-2:1 frames are accepted and the overlay stretches to match |
| 180 ERP | Front hemisphere with a blank rear hemisphere, keeping the full 360-degree PowerMap scale |
| EAC (3x2) | FFmpeg-compatible cube layout; arbitrary face arrangements are unsupported |
| Mono / Stereo SBS / Stereo TB | Full frame / left eye / top eye; playback is monoscopic |

Auto reevaluates each file and selected stereo layout. This is a heuristic, not projection
detection; choose EAC or override ERP manually when needed.

All player settings are remembered across files and restarts in the same extension host:
projection, layout, view, camera direction/FOV, both overlay toggles and opacities, monitor, channel order,
normalization, volume and mute. **Restore default settings** resets these immediately,
without seeking or pausing. Defaults include Auto, Mono, Panorama, WYZX/SN3D, Binaural,
PowerMap off (75% opacity when enabled), volume at 100%, unmuted, and a forward-facing 72-degree FOV.
Mono/stereo Bypass and video-only playback do not overwrite saved FOA settings. Playback
position and play/pause are not preferences. Local and remote hosts keep separate settings.

**Panorama** shows the unfolded image. **Perspective** supports dragging or arrow keys
to look around, scrolling or +/- to change FOV, and Home/Reset to face forward.
The thumbnail marks the current view. PowerMap updates during playback, not paused seeks.

**Grid** in the Overlay row is off by default, with 100% opacity. It adds 30-degree azimuth and elevation lines in
Panorama, Perspective and the overview. Front is 0 degrees, left is positive, right
is negative, and the back seam is +/-180 degrees. Elevation is positive above the
horizon. The grid follows the scene when turning the camera, retains full-sphere
coordinates in 180 ERP, and works independently of audio and PowerMap.

Controls are grouped into Projection, Overlay and Audio rows. Grid and PowerMap each
have an independent toggle and opacity. The Panorama/Perspective tabs and Reset view
button sit in the transport bar. View tabs use compact icons with hover labels and
keyboard navigation. Grid and PowerMap each form a bordered control group. Controls
follow VS Code theme colors, with dark and light fallbacks.
Audio's Channel control selects WYZX/WXYZ order.
The footer combines video resolution, channel count, source audio sample rate and
PowerMap parameters; unavailable audio fields are omitted for video-only media.

## Remote Workspaces

For SSH or Cloud IDE, install in the remote workspace extension host and open files
stored there. Media streams through bounded reads without a separate server or port forwarding.
Startup and seeking depend on network speed; the browser must allow Web Audio, Workers,
WASM and video decoding. Browser-only vscode.dev without a remote host is unsupported.
Source media is not modified or uploaded to a third-party service.

## Development

```sh
git lfs install
git clone https://github.com/jinnsjj/pano-player.git
cd pano-player
git lfs pull
npm ci
npm test
npm run package
code --extensionDevelopmentPath="$PWD"
```

FFmpeg/libav files use Git LFS; fetch the actual objects before building, not just pointer files.
Installed users do not need Git LFS. VSCE rewrites README image links to GitHub HTTPS URLs,
so screenshots in the extension details page require network access.

See [validation](../VALIDATION.md) for test coverage and [third-party notices](../THIRD_PARTY_NOTICES.md) for licenses.
