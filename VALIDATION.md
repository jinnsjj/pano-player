# PanoPlayer Validation

Source version: 0.4.26. Updated 2026-09-21.

## Naming

- Extension: `shijunjie.pano-player`.
- Open command: `panoPlayer.open`.
- Editor view type and activation event: `panoPlayer.player`.
- Browser test interface: `window.__PANO_PLAYER__`.
- Test environment variables use the `PANO_PLAYER_` prefix.
- No previous command/editor aliases or configuration migration are registered.
- The proxy-cache cleanup command has been removed; current playback creates no disk proxies.

## Automated Checks

Run `npm test` for host-file reads, bounded streaming, codec state, PCM channels,
normalization, playback controls, projection, command/editor registration and documentation.
The optional codec integration test requires original media paths in
`PANO_PLAYER_CODEC_FILES`, separated by `|`. A skipped fixture test does not establish
codec playback acceptance.

Packaging checks cover the publisher/version, current editor ID, HTTPS screenshot
links, absence of obsolete runtime identifiers and exclusion of nested VSIX archives.
FFmpeg/libav objects must be fetched through Git LFS before packaging.

## Acceptance Boundary

Version 0.4.26: 84 automated checks passed, one optional codec test skipped.
PWD matches independent time-domain steered beam energy; MUSIC checks cover
one source and two independent sources. Worker/service tests cover option
validation, forwarding, incompatible averaging history and queued reset work.
Local Chrome playback produced nonblank maps for PWD and MUSIC with one/two
sources, without restarting the playback clock. Settings persistence/reset,
PWD source-count disabling, and mono/stereo/video-only restrictions passed.
Both secondary menus fit at 1280, 760, 390 and 320 px in dark/light themes;
screenshots were inspected. Outside-click, Escape, keyboard opening and sliders
passed, including the eight pointer/keyboard focus regressions. No browser
JavaScript errors or installed desktop/Cloud IDE revalidation were recorded.

Version 0.4.25: 79 automated checks passed, one optional codec test skipped.
Reproduced Chrome retaining `:focus-visible` when a keyboard-focused slider is
subsequently dragged. Actual-player checks covered seek, volume, Grid opacity
and PowerMap opacity in dark/light themes: pointer down/drag/release hides the
outline without removing focus; arrow keys still change the value and restore
the outline; Tab away and back restores keyboard focus styling. All eight cases
passed with no browser JavaScript errors. Pointer/keyboard transport screenshots
were inspected. No installed desktop or Cloud IDE revalidation was performed.

Version 0.4.24: 78 automated checks passed, one optional codec test skipped.
Local Chrome checks at 1280, 760, 390 and 320 px confirmed vertically stacked
L/R Peak and True Peak bars with identical x coordinates and track widths.
All ten readouts fit the 240 x 164 px translucent window. A directional FOA tone
produced visibly different L/R bar lengths with the expected 9.54 dB stereo
monitor difference. Meter controls, PanoView and playback checks still pass;
no installed desktop or Cloud IDE revalidation was performed.

Version 0.4.23: 78 automated checks passed, one optional codec test skipped.
The PanoView and Meters windows share their dragging, keyboard movement, close
and viewport-clamping implementation. Local Chrome checks covered independent
toggles, close/Escape, persistence after reopening media, Perspective/Panorama
switches and paused reopening after camera movement. Moving PanoView left the
camera unchanged. Canvas-pixel checks confirmed a nonblank panorama, and the
existing restored-camera/paused-frame regressions still pass. Hidden overviews
skip rendering and refresh immediately on reopening. Dark/light screenshots
and both windows at 1280, 760, 390 and 320 px widths were inspected. No browser
JavaScript errors or installed desktop/Cloud IDE revalidation were recorded.

Version 0.4.22: 76 automated checks passed, one optional codec test skipped.
Local Chrome checks confirmed a 240 x 148 px meter at 1280, 760, 390 and 320 px
viewport widths, with all ten readouts and horizontal bars visible without text
overflow. Computed background alpha is 0.72; panel/readout opacity remains 1.
Dark/light screenshots over a real rendered ERP fixture were inspected alongside
the panorama thumbnail. Dragging, keyboard movement, Escape/close, reset, gain,
mute and all output routes still pass; hover text retains units, maxima and clip
counts. No installed desktop or Cloud IDE revalidation was performed.

Version 0.4.21: 76 automated checks passed, one optional codec test skipped.
The optional meter overlay was checked in local Chrome with mono/stereo bypass,
FOA binaural and stereo monitoring, volume/mute, pause/seek, retained maxima,
reset/close, dragging/keyboard movement, persistence and video-only disabling.
All ten meter tracks fit at 1280, 760, 390 and 320 px widths; dark/light screenshots
were inspected. An intersample-overload fixture triggered True Peak clipping while
sample peaks remained below 0 dBFS. No browser JavaScript errors were recorded.
DSP tests cover 44.1/48/96 kHz K-weighting, phase-independent stereo energy,
150 ms peak decay, gating, LRA and a silent, disabled-by-default worklet.
On a 24-second, 48 kHz stereo stepped-level/silence fixture, independent FFmpeg
`ebur128=peak=true` reported -12.6 LUFS integrated, 20.8 LU LRA and -10.0 dBTP;
the adapted meter returned -12.5996 LUFS, 20.8 LU and -10.0000 dBTP.
These checks are not EBU certification or installed desktop/Cloud IDE validation.

Version 0.4.19: 69 automated checks passed, one optional codec test skipped.
The local browser `/rotation-flac-test` passed 36 GPU pixel comparisons across
0/90/180/270 degrees, mono/SBS/TB and 360/180/EAC, against independent Canvas2D
source rotations. Generated 48 kHz s16 FLAC tones (220 Hz times channel index)
passed 1/2/4-channel PCM comparisons within one quantization step, bounded chunk
decoding, seeks at 0.7 and 5.9 seconds, and exact EOF for six-second files.
Serve these three files in channel-count order with `tests/stream-server.cjs`.
Actual player checks exercised four-channel FLAC playback with live PowerMap,
and 90-degree video rotation in Perspective with a matching overview.
This verifies the local browser host, not a desktop or Cloud IDE reinstall.

Version 0.4.18 fixes thumbnail startup and restored camera synchronization. Regressions
first reproduced a paused first frame being throttled, a restored footprint calculated
from the forward camera, and video readiness waiting for audio. Unit tests now cover
these cases, paused seeks and retention of the 10 Hz playing-thumbnail limit.
Automated checks: 68 passed, one optional codec fixture test skipped.
The local browser `/thumbnail-test` passed real canvas-pixel and footprint comparisons
for 360 ERP, 180 ERP, SBS, TB and EAC. Actual player navigation/reopening with the
person-free ERP/EAC clips retained a turned view and a matching, nonblack overview
while paused. No desktop or Cloud IDE reinstall was performed.

Version 0.4.17 replaces the view icons with Lucide RectangleHorizontal/View and adds
Globe/Layers/AudioLines to the Projection/Overlay/Audio headings. Local Chrome
screenshots verified that all five icons render on light/dark backgrounds and that
Perspective remains selectable. A registry test guards against missing bundled icons.
Automated checks: 64 passed, one optional codec fixture test skipped. This does not
establish installed desktop/Cloud IDE acceptance.
Defaults are now 100% volume and PowerMap off; tests also cover retaining saved
values and skipping PowerMap analysis until enabled.

Version 0.4.16 uses 32px icon-only view tabs with tooltips/accessibility labels,
and compact bordered Grid/PowerMap groups with uniform spacing and internal dividers.
Local Chrome screenshots covered dark/light backgrounds, selected/unselected tabs,
and disabled audio/PowerMap controls on video-only media. Light-theme colors retain
VS Code token overrides with readable fallback foregrounds and control surfaces.
This is browser-host validation, not a desktop/Cloud IDE reinstall.

Version 0.4.15 reorganizes controls into Projection, Overlay and Audio rows, moves
filled-highlight view tabs/Reset view into transport, and removes the fullscreen
button. Local Chrome checks covered independent grid/PowerMap opacity, combined
source and DSP metadata (including 48 kHz source audio), and remembered values in a
new video-only editor. GPU tests also verify that zero grid opacity clears the
projected grid. Unit tests cover markup placement, independent preferences/reset,
44.1/48 kHz metadata and no-audio fields. No desktop/Cloud IDE reinstall was performed.

Version 0.4.14 adds an independent, persisted direction grid and the packaged logo
in the header. Local Chrome checks covered Panorama/Perspective, paused camera motion,
no-audio MP4, four-channel WebM with PowerMap, and grid restoration on opening the next
file. `/grid-test` pixel checks passed at 800px and 360px render widths: the grid is
nonblank, rotates with the scene, disappears completely when disabled, and remains
visible in the blank rear hemisphere of 180 ERP. Unit tests cover axis labels,
settings persistence/reset and the logo resource. Desktop/Cloud IDE installation
has not been repeated for this version.

Version 0.4.13 was checked in the local Chrome test host:

- A GPU regression reproduced black frames when remembered SBS/TB initialized before
  metadata resized the source canvas. Reallocating the texture fixes all four pixel
  checks (SBS/TB, growing/shrinking source). Run `/projection-startup-test` with
  `node tests/stream-server.cjs <media>` to repeat this check.
- Opening VP9 WebM with saved SBS and H.264 MP4 with saved TB/Perspective renders
  the first frame instead of a black canvas. Both video-only fixtures were verified
  by FFprobe to have no audio track.
- Video-only playback advances in Panorama and Perspective; paused and playing seeks
  work. Both formats reach EOF; WebM replays. Audio controls are disabled, not rejected.
- Original four-channel WebM still plays with binaural monitoring and live PowerMap.
  Returning from video-only media restores the saved audio/overlay controls.
- Unit tests cover zero audio initialization, clock startup/pause/seek/EOF/replay,
  unknown duration, worker video-only decoding, and preference preservation.

These are browser-host checks, not a reinstall or revalidation in desktop VS Code
or Cloud IDE. No additional viewport-size sweep was performed.

Source tests and VSIX inspection do not replace playback testing in an installed
desktop or Cloud IDE extension. Version 0.4.11 was checked in a local Chrome test host:
two WebM files retained projection, view, audio and overlay preferences across navigation;
reset restored defaults during playback without resetting the clock. Perspective video
and the panorama thumbnail rendered, and the compact settings groups were inspected at
the current desktop size. Version 0.4.12 restores the brand header and headings above
the PowerMap/Audio parameters while retaining Auto, preferences and reset. This scoped
layout rollback is covered by markup tests, without another browser size sweep.
Local/remote host unit tests cover persisted settings injection
into new editors; the packaged extension was not reinstalled in desktop or Cloud IDE.
Runtime screenshots in `docs/images/` were refreshed at 1920 x 1080 on 2026-09-21
in the local browser test host using the current 0.4.17 UI, rather than upscaling
earlier captures. Only the supplied person-free projection references and the WAV
PowerMap are used in the screenshots. The ERP/EAC reference images were
encoded as temporary silent H.264 clips and rendered through the actual player,
with matching projection selection and a forward-facing Perspective camera.
The source images are examples, not player screenshots or evidence of JPEG support.
Earlier test records remain in Git history rather than this current-release summary.
