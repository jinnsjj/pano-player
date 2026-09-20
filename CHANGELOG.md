# Changelog

## 0.4.17 - 2026-09-20

### Added

- Optional direction grid with azimuth and elevation labels in Panorama, Perspective and the overview thumbnail, including 180 ERP.
- Independent, remembered visibility and opacity controls for Grid and PowerMap.
- Playback for videos without an audio track, including seeking, replay and Perspective view.
- Source audio sample rate alongside resolution, channel count and PowerMap information.

### Changed

- Organize settings into Projection, Overlay and Audio rows, with compact overlay control groups.
- Move Panorama/Perspective tabs and Reset view into the playback bar; remove the fullscreen button.
- Use compact Lucide view icons, matching section icons and the PanoPlayer logo in the header.
- Improve control contrast and selected states on light and dark themes.
- Rename the audio Order label to Channel.
- Set default volume to 100% and PowerMap to off. Existing remembered settings are preserved; Restore default settings applies the new defaults.

### Fixed

- Prevent black video when a remembered Stereo SBS or Stereo TB layout is applied before the next video's dimensions are available.
- Keep audio and PowerMap controls disabled for video-only media without overwriting saved FOA preferences.

## 0.4.12

- Add Auto projection, inferring 180 or 360 ERP from the single-eye aspect ratio.
- Remember player settings across files and restarts in the same extension host.
- Add Restore default settings without interrupting playback.
