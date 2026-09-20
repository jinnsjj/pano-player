# PanoPlayer Validation

Source version: 0.4.12. Updated 2026-09-20.

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
