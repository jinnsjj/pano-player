# Changelog

## 0.4.48 - 2026-11-18

### Improved

- Stream host-backed media faster on desktop and VS Code Remote: prefetch the next block while the current one is decoded and grow blocks to 1 MiB. Sustained reads at a 40 ms Remote round trip rise from about 50 to about 338 Mbit/s, keeping high-bitrate panoramic video fed over slow links.
- Queue up to three decoded WebCodecs frames and present the newest due frame when behind, absorbing short decoder stalls. WASM HEVC keeps a single frame to bound memory.
- Shrink the VSIX from 20 MB to 2.2 MB. Codec source archives are published with SHA-256 hashes as assets of the `codec-sources-v1` GitHub Release, linked from `codec-sources/README.md` and `THIRD_PARTY_NOTICES.md`; every decoder remains bundled, so all playback features work immediately after installation. The extension icon is now 256 x 256.

## 0.4.47 - 2026-11-14

### Added

- Select custom annotation fields individually in Label fields and append their JSON values to region, point and sidebar labels. Preserve false, zero, null and empty values without changing annotation visibility; keep extra fields hidden by default.

## 0.4.46 - 2026-11-13

### Improved

- Allow annotation JSON to omit `version`, defaulting to v1. Continue rejecting explicitly invalid or unsupported versions; keep timing, FPS and per-entry validation unchanged.

## 0.4.45 - 2026-11-13

### Added

- Accept annotation samples with second-based `timestamp` or zero-based `frame`, both requiring explicit annotation `fps` and displaying one sampling period. Support root FPS defaults and per-item overrides while preserving existing `start/end` intervals, source filtering and import rollback.

### Fixed

- Skip invalid annotation entries instead of rejecting valid entries in the same file. Report loaded/skipped counts and bounded errors with original entry numbers; retain the previous file on file-level failures or when every entry is invalid. Keep conversion validation strict.

## 0.4.44 - 2026-11-11

### Improved

- Smooth HEVC Main SDR playback on macOS with live VideoToolbox hardware decoding and H.264 transport when native WebCodecs HEVC is unavailable and host FFmpeg is installed. Begin from streamed video fragments without preparing or storing a whole-file cache.
- Keep original audio samples, channel layouts, track switching and media timestamps separate from the live video bridge. Preserve annotation coordinates and source metadata; cap bridge dimensions at 4096 while retaining aspect ratio.
- Restart live decoding at the selected timestamp on seek, bound memory with backpressure, and cancel decoder processes on close. Untrusted workspaces and unsupported hosts retain bundled WASM decoding; Main 10 and HDR stay on the precision-preserving path.

## 0.4.43 - 2026-11-10

### Added

- Copy the opened JSONPP configuration or video path together with the current playback time or selected loop range, in seconds with millisecond precision, without changing files or playback.
- Display timed text annotations without a region or point beside the video, or below it on narrow screens, using the existing timeline, visibility and source filters.

## 0.4.42 - 2026-11-04

### Added

- Open `.jsonpp` media configurations in PanoPlayer by default, including in Remote workspaces, while keeping ordinary `.json` files in the text editor by default.
- Recognize JSONPP configurations in the Open Media picker, explorer menu and selected-path command, with the same paths, audio and annotation format as JSON configurations.

## 0.4.41 - 2026-11-04

### Added

- Open JSON media configurations with a video path, multiple optional external audio paths and an optional annotation JSON path, including on VS Code Remote hosts.
- Accept `audio_path` as either a single path string or an array of paths.
- Resolve relative references beside the configuration and add every external audio track without replacing the video's audio by default. Silent videos select the first usable external file; manual selection takes precedence.
- Load annotations after plugin activation and isolate optional file failures from video playback. See `docs/MEDIA-JSON.md` for the version 1 format.

## 0.4.40 - 2026-11-03

### Fixed

- Keep the Open annotation JSON folder button beside the Annotation visibility checkbox and settings arrow, available even when settings are collapsed.
- Open annotation JSON through VS Code's native extension-host file dialog, starting in the current media directory and using remote host paths for Remote SSH sessions.
- Preserve the current annotations and playback when file selection is canceled or reading fails. The standalone web player continues to use the browser file chooser.

## 0.4.39 - 2026-11-03

### Added

- Drag one annotation JSON file onto the playback interface in the web player or VS Code to import it and reveal Annotation settings without replacing media or changing playback position or play/pause state.
- Accept URI-only annotation drops in VS Code by reading files on the extension host, limited to 20 MiB and local files or the current remote host.

### Fixed

- Keep the previous annotations and playback intact when a dropped JSON file is invalid, empty or oversized, and show validation errors in the expanded Annotation settings.

## 0.4.38 - 2026-11-03

### Added

- Plugin interface with settings panels and source-aligned canvas layers.
- Open-source Annotation plugin, bundled and enabled by default on web and VS Code, with an expandable Overlay entry for local bbox/point JSON, labels and source filters.
- Separately installed companion extensions and trusted local web plugin packages.

### Changed

- Accept optional annotation labels, sources and positions; omit missing caption text and skip drawing entries without a bbox or point while preserving time and geometry validation.
- Align Grid, PowerMap and Annotation with independent visibility checkboxes and inline settings disclosures; collapsing settings does not hide overlays.
- Build the web player from an explicit asset allowlist and remove stale output before each build.
- Defer observed playback-area height updates to avoid resize notification loops during projection changes.

## 0.4.37 - 2026-10-29

### Added

- Timeline range looping with mouse and touch selection, adjustable boundaries, and keyboard boundary controls.
- One repeat button to create a full-media loop when no range is selected, or clear an existing loop range.
- Keep looping enabled when seeking outside the selection: play into the range from before it, or continue to the media end and return to the loop start from after it.

## 0.4.36 - 2026-10-29

### Added

- Optional center crosshair with live azimuth and elevation in Perspective and a zero-degree center reference in Panorama.
- Persist the Center overlay setting across media and include it in default-settings reset.

## 0.4.35 - 2026-10-27

### Added

- External audio sources selected through one combined source-and-track menu in the extension and web player.
- Pre-render channel mapper with numbered input/output channels, custom routing, bypass, Direct/Silent presets, and FOA Solo/HL Solo for six-channel sources.

### Changed

- Prebuffer audio replacements and switch at the current playback time without pausing or seeking the video, restarting its decoder, or clearing the picture. Failed switches keep the previous audio.
- Scroll only the lower settings and media information while keeping the video and transport fixed. Playback-area resizing reserves space for settings in short windows.

## 0.4.34 - 2026-10-15

### Added

- Persisted Perspective aspect selection: 4:3 (default) and 16:9. The canvas width follows its height and selected aspect without stretching the image.
- Resize the playback area using its bottom divider, with pointer and keyboard controls.
- Standalone local-file web player sharing the extension's playback, projection, FOA and analysis core, with a static build and Cloudflare Pages deployment support.

### Changed

- Match the playback area to the selected Perspective aspect to remove internal black bars.

### Fixed

- Resize the existing extension icon to meet the Marketplace's 1024-pixel limit without changing its design.

## 0.4.33 - 2026-10-12

### Fixed

- Allow editor context playback on remote extension hosts that expose native file URIs instead of remote URIs.

## 0.4.32 - 2026-10-12

### Added

- Play with PanoPlayer from the text editor context menu using a selected absolute media path or the current line. Supports files outside the workspace and mounted drives; remote windows resolve paths on the remote host.

## 0.4.31 - 2026-09-23

### Fixed

- Read AAC channel counts from the codec header before configuring playback, so six-channel FOA+HL files with PCE layouts are not mistaken for stereo. Keep decoded PCM channel validation enabled.

## 0.4.30 - 2026-09-23

### Added

- Six-channel FOA+HL playback: channels 1-4 carry FOA and channels 5/6 carry head-locked left/right audio in both listening modes, with shared volume and mute. HL is excluded from camera rotation, FOA normalization and PowerMap.

### Fixed

- Suppress false PowerMap hotspots and clear stale maps for silent, W-only and near-W-only input.
- Preserve flat spectra through interpolation and normalization, and prevent two-source MUSIC from using zero-energy signal directions.

## 0.4.29 - 2026-09-23

### Fixed

- Hide dropdown focus outlines after mouse or touch interaction while preserving focus and keyboard navigation.

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
