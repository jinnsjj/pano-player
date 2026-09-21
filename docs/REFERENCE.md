# PanoPlayer Reference

See the [README](../README.md) for features and screenshots.

## Install

Install from [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=shijunjie.pano-player)
or run `code --install-extension shijunjie.pano-player`. For a local package, use
**Extensions: Install from VSIX...**.

Open media with **Open With > PanoPlayer** or **PanoPlayer: Open Media**.
Requires VS Code 1.84+, a Node workspace extension host, Web Audio and WebCodecs.
Perspective, EAC, rotation and single-eye cropping require WebGL2. No external FFmpeg or Python is needed.

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

- Containers: MP4, WebM, MOV, MKV, WAV and FLAC. Playback depends on the contained codecs and browser support.
- FLAC uses the host WebCodecs decoder through the existing incremental demuxer, preserving 1/2/4 channels. No additional decoder is bundled.
- MP4/AAC and WebM/Opus audio use bundled WASM decoders; WAV PCM is read incrementally. Playback does not wait for full-file decoding or transcoding.
- Mono/stereo audio passes through unchanged apart from volume and mute. Panorama and Perspective remain available; FOA processing is disabled.
- Videos without audio use a video clock and support both views, seeking and replay without initializing audio decoders or DSP.
- Four-channel input must be first-order Ambisonics, not quadraphonic speaker audio. Select WYZX (ACN) or WXYZ, and SN3D or N3D. Defaults are WYZX/SN3D; FuMa is unsupported.
- Binaural monitoring follows the camera direction. Stereo Monitor stays aligned to the recording axes. WAV and FLAC can display a standalone PowerMap.
- When audio is present, only the primary audio track and 1, 2 or 4 channels are supported. PowerMap offers PWD or MUSIC with one/two assumed sources for qualitative direction review, not calibrated measurement or source separation.

## PowerMap

The arrow beside **PowerMap** opens algorithm, MUSIC source-count and opacity controls.
PWD displays steered beam energy (`Y^T C Y`); MUSIC displays a noise-subspace
pseudo-spectrum with one or two assumed sources. This is not automatic source counting.
Both use the existing 1024-sample Hann-windowed, broadband real covariance, an
812-direction scan and a 140 x 70 display, updated every 140 ms. Input is converted
to ACN/N3D for analysis. Temporal map averaging is 0.666; switching algorithm or
source count clears the old map and averaging history without interrupting audio.

The PWD quadratic form follows the method documented in SAF's
[`generatePWDmap`](https://github.com/leomccormack/Spatial_Audio_Framework/blob/master/framework/modules/saf_sh/saf_sh.c).
This browser implementation retains its broadband covariance analysis; it does not
replicate SPARTA's frequency-band processing. Correlated or diffuse sources can
make MUSIC's assumed source count unsuitable.

## Output Meters

**Overlay > Meters** opens a movable, non-modal analysis window, approximately
240 x 164 px, with a translucent background and opaque text and bars. All metrics
remain visible; hover a readout for units, retained maxima and clipping counts.
Its visibility is
remembered; closing it stops meter DSP. It measures the final stereo playback mix
after monitoring, volume and mute, without altering the audible path.

- Peak and True Peak have separate L/R bars stacked vertically with matching origins, lengths and scales for direct comparison, plus clipped-sample counts and retained maxima. Bars attack immediately and decay with a 150 ms amplitude half-life. Markers retain maxima until reset, not the current window's peak above RMS. Clipping turns the readout and marker red.
- RMS-M and LUFS-M use 400 ms windows; LUFS-S uses 3 seconds. Statistics advance every 100 ms. RMS-I accumulates playback energy; LUFS-I applies absolute and relative gating.
- RMS sums L/R energy, matching the reference JSFX's stereo convention. It is not the arithmetic average of channel dB values. LUFS uses K-weighting; LRA uses gated short-term loudness and 10th/95th percentiles with 0.1 LU histogram bins.
- True Peak uses the reference's 32-tap sinc interpolation: 4x below 96 kHz and 2x at higher rates. This is a reconstructed-peak estimate, not a hardware output measurement.
- Values show `--` before enough samples exist. LRA requires at least 20 accepted short-term observations. Pause retains statistics; Reset, starting playback, seeking, changing monitor mode/order/normalization, or reopening the overlay clears them. Volume and mute do not erase historical peaks.

The DSP is adapted from Cockos `analysis/loudness_meter` shipped with REAPER 7.52;
the original JSFX, adapted source and LGPL license are included in the VSIX.

## Projection And View

Rotation corrects the video source clockwise by 0/90/180/270 degrees before eye selection and projection. Auto uses the resulting single-eye aspect ratio. Rotation is remembered and resets to 0; it does not rotate audio or direction overlays.

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
projection, layout, view, camera direction/FOV, Grid/PowerMap toggles and opacities, PowerMap algorithm and MUSIC source count, Meters/PanoView visibility, monitor, channel order,
normalization, volume and mute. **Restore default settings** resets these immediately,
without seeking or pausing. Defaults include Auto, Mono, Panorama, WYZX/SN3D, Binaural,
PowerMap off (MUSIC, one source, 75% opacity when enabled), volume at 100%, unmuted, and a forward-facing 72-degree FOV.
Mono/stereo Bypass and video-only playback do not overwrite saved FOA settings. Playback
position and play/pause are not preferences. Local and remote hosts keep separate settings.

**Panorama** shows the unfolded image. **Perspective** supports dragging or arrow keys
to look around, scrolling or +/- to change FOV, and Home/Reset to face forward.
**Overlay > PanoView** toggles the panorama thumbnail in Perspective. It defaults
to on and remembers its setting across files. Like Meters, it uses a 240 px-wide
floating window with a translucent frame, a draggable title bar, arrow-key
movement, and a close button/Escape. Closing PanoView does not close Meters or
change the camera. Its image marks the current field of view; reopening while
paused refreshes the image and footprint immediately. Panorama mode hides the
window without changing its saved toggle. PowerMap updates during playback, not paused seeks.

**Grid** in the Overlay row is off by default, with 100% opacity. It adds 30-degree azimuth and elevation lines in
Panorama, Perspective and the overview. Front is 0 degrees, left is positive, right
is negative, and the back seam is +/-180 degrees. Elevation is positive above the
horizon. The grid follows the scene when turning the camera, retains full-sphere
coordinates in 180 ERP, and works independently of audio and PowerMap.

Controls are grouped into Projection, Overlay and Audio rows. Grid and PowerMap each
have an independent toggle and a collapsible settings menu for opacity. PowerMap's
menu also contains algorithm and source count; Sources is disabled under PWD.
Menus start closed, close on outside clicks or Escape, and support keyboard navigation.
The Panorama/Perspective tabs and Reset view
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

VSIX packages are written to `output/pano-player-<version>.vsix`.

FFmpeg/libav files use Git LFS; fetch the actual objects before building, not just pointer files.
Installed users do not need Git LFS. VSCE rewrites README image links to GitHub HTTPS URLs,
so screenshots in the extension details page require network access.

See [validation](../VALIDATION.md) for test coverage and [third-party notices](../THIRD_PARTY_NOTICES.md) for licenses.
