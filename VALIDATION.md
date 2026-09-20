# PanoPlayer Validation

Source version: 0.4.17. Updated 2026-09-20.

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
Runtime screenshots in `docs/images/` were captured
in Chrome on 2026-09-19 and predate the Perspective tab label.
Earlier test records remain in Git history rather than this current-release summary.
