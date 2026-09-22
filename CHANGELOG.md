# Changelog

## 0.4.28 - 2026-09-22

### Changed

- Compact media settings with tighter spacing, borderless dropdowns and matching Grid and PowerMap controls, with responsive wrapping in narrow panels.
- Shorten the Stereo Monitor option to Stereo.

## 0.4.27 - 2026-09-22

### Added

- Audio track selection with names, languages, channel counts and codecs. Switching preserves playback position and play/pause state and updates Bypass or FOA processing for the selected track.
- A single question-mark button in Output Meters opens explanations of Peak, True Peak, RMS, LUFS and LRA. Click again, click outside or press Escape to dismiss.

## 0.4.26 - 2026-09-21

### Added

- PWD / MUSIC PowerMap selection and one/two assumed sources for MUSIC, remembered across files.
- Collapsible Grid and PowerMap settings menus, keeping opacity sliders and algorithm controls out of the main toolbar.

### Fixed

- Clear queued analysis and incompatible averaging history when changing PowerMap settings, without interrupting playback.

## 0.4.25 - 2026-09-21

### Fixed

- Hide slider focus outlines during mouse/touch interaction, including after keyboard focus, while retaining focus and keyboard navigation for seek, volume and overlay opacity controls.

## 0.4.24 - 2026-09-21

### Changed

- Stack L/R Peak and True Peak bars vertically with aligned origins, equal track lengths and the same scale, while retaining the compact translucent meter window.

## 0.4.23 - 2026-09-21

### Changed

- Move the panorama overview into an independently toggleable PanoView floating overlay, sharing the compact translucent frame, dragging, keyboard movement and close controls with Meters.
- Remember PanoView visibility across files; hide it outside Perspective without clearing that preference. Skip hidden thumbnail rendering and refresh immediately when reopened, including while paused.

## 0.4.22 - 2026-09-21

### Changed

- Compact Output Meters to a thumbnail-sized 240 x 148 px overlay with translucent background and opaque readouts. Keep all metrics visible as horizontal mini-bars; show units, retained maxima and clipping counts on hover.

## 0.4.21 - 2026-09-21

### Changed

- Replace the inline meter with an optional, movable Output Meters overlay, with close and statistics-reset controls.
- Adapt Cockos' JSFX loudness analysis for continuous audio-thread Peak/True Peak, RMS-M/I, LUFS-M/S/I and LRA measurement. Peak bars decay with a 150 ms amplitude half-life; markers retain the maximum until reset.
- Remember overlay visibility, stop meter DSP when closed, and reset statistics on playback start, seeking and monitor format changes.

## 0.4.20 - 2026-09-21

### Added

- Live L/R output meters with RMS dBFS, sample-peak markers and clipping indicators, following volume and mute in Bypass, Binaural and Stereo Monitor modes.

## 0.4.19 - 2026-09-21

### Added

- Remembered clockwise source rotation (0/90/180/270 degrees), applied before stereo cropping and projection in both views and the overview. Reset restores zero rotation; audio coordinates are unchanged.
- FLAC in Open With, the context menu and the file picker, using the existing streaming pipeline and native WebCodecs decoding. Mono/stereo bypass and four-channel FOA processing remain available without additional dependencies.

## 0.4.18 - 2026-09-21

### Fixed

- Refresh the Perspective overview immediately when a paused first frame or seek completes, without waiting for playback or camera input.
- Make decoded video available to the overview while audio is still initializing.
- Apply the remembered camera direction before calculating the overview window when opening a new media file.

### Documentation

- Add default-editor configuration instructions and refresh screenshots with person-free, 1920 x 1080 player captures.
- Compare ERP and EAC reference layouts with their actual Perspective rendering.

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
