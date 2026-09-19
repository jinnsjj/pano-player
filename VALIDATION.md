# Validation

## Marketplace Publisher Configuration, 2026-09-19

Source version: 0.4.8. The first Marketplace package uses the existing publisher
`shijunjie`, with display name `Junjie Shi`, as confirmed by the user. The extension
ID is now `shijunjie.pano-player`. Earlier local VSIX packages used `JunjieShi`;
uninstall those before enabling this package to avoid duplicate editor commands.
This configuration entry alone is not evidence of Marketplace approval.

## GitHub Publication And README Images, 2026-09-19

Source version: 0.4.8. Repository: https://github.com/jinnsjj/pano-player.
Removed base64 README generation: VS Code's extension-details Markdown sanitizer
filters data-URI media even though its outer CSP permits data images. Earlier
archive-content tests did not establish that installed screenshots rendered.
VSCE now rewrites relative screenshots and documentation links to GitHub HTTPS
URLs on `main`. FFmpeg/libav remain in Git LFS; caches and VSIX files stay ignored.
Marketplace publication and installed-page visual acceptance remain separate checks.

## Perspective Tab And Icon, 2026-09-19

Source version: 0.4.7. Renamed the Spatial tab, accessible view label and error
message to Perspective. Internal view IDs and playback behavior are unchanged.
The extension manifest uses the user-provided PNG as `media/icon.png`, unchanged.
Documentation follows the new label; existing runtime screenshots predate it.
Tests cover the visible tab label, accessible label and packaged icon reference.

## English Overview, 2026-09-19

Source version: 0.4.6. The default README and packaged extension details are now
English, including feature descriptions, screenshot captions, and image alt text.
The three runtime screenshots and feature scope are unchanged. No author credit
was reintroduced; publisher remains `JunjieShi`. No playback code changes.

- README checks cover English headings and reject Chinese text in the source and
  generated package overview. Existing embedded-image checks remain in place.

## VSIX Publisher, 2026-09-19

Source version: 0.4.5. Removed the README author credit. The VSIX-only developer
label now uses publisher identifier `JunjieShi` (spaces are invalid in publisher
identifiers); author metadata is `Junjie Shi`. The new extension ID is
`JunjieShi.pano-player`; remove the previous publisher's package to avoid duplicate
editor/command registrations. This is not a Marketplace publisher registration.

- 51 tests passed; one optional codec fixture test skipped. Manifest tests check
  the publisher and author independently; README tests reject the author credit.
- No playback or screenshot changes. No repeated viewport testing.

## Feature Overview And Branding, 2026-09-19

Source version: 0.4.4. Display name, editor name, command labels and player header
are PanoPlayer; author metadata and overview credit are Junjie SHI. Package and
command identifiers stay unchanged. README now leads with features and three
runtime screenshots; installation and development details moved to docs/REFERENCE.md.

- 51 tests passed; one optional codec fixture test skipped. Added checks cover
  branding, author, JPEG signatures and embedded images in the generated README.
- Real Chrome captures at the existing 1272x788 viewport: WebM Panorama/PowerMap,
  Spatial with view footprint and binaural status, and FOA WAV PowerMap. No mocks,
  image edits or repeated width tests. Screenshot tab and test server closed.
- WebM reached 5.5335 seconds / 166 video frames with 40 map results and zero
  stalls or dropped frames. WAV reached 53.5177 seconds with 383 map results and
  zero stalls. These are local browser observations, not Cloud IDE acceptance.
- VSIX content verified to contain author/name metadata and all three embedded
  JPEGs. Installation succeeded in isolated /tmp VS Code directories. The normal
  desktop and Cloud IDE installations were not updated; the installed extension
  details page was not visually verified in the isolated instance.

## Unified Parameters, 2026-09-18

Source version: 0.4.3. Projection, layout and view tabs now share the lower
Media settings region with PowerMap and Audio, directly below transport. DOM
and keyboard order follow the visible arrangement. Playback/DSP code unchanged.

- 50 tests passed, one optional codec test skipped; markup checks require all
  parameter controls to remain within the shared region. Layout detector clean.
- Single existing Chrome viewport: parameters share one region; projection and
  view tabs stay on one row, with no horizontal overflow. Footer bottom 772.5px
  in a 788px viewport. Spatial video and overview visibly render; WebM reaches
  0:17 / 0:17, with no browser console errors. Preview tab/server closed.
- No repeated width sweep or fresh VS Code/Cloud IDE installation.

## Header Information Hierarchy, 2026-09-18

Source version: 0.4.2. Independent Impeccable design and evidence reviews support
removing the redundant filename from the header and moving MUSIC/source metadata
below the PowerMap controls. The badge ID and mono/stereo hiding are preserved.
No playback or DSP code changes. The review archive is excluded from the VSIX.

- 50 tests passed; one opt-in codec test skipped. Regression checks cover header
  content, PowerMap metadata placement, title escaping and bypass visibility.
- Chrome at the existing desktop size: WebM reached 0:17 / 0:17 with four-channel
  binaural status and DSP updates. No console errors. Header contains only the
  brand; the MUSIC note belongs to the PowerMap fieldset. No horizontal overflow;
  footer bottom 724.5px within a 732px viewport. Preview tabs/server closed.
- Baseline template detector: zero findings. No injected detector overlay because
  browser evaluation is read-only. No repeated width sweep, screen-reader test,
  light-theme acceptance, or fresh VS Code/Cloud IDE installation.

## Review UI, 2026-09-18

Source version: 0.4.1. Used UI UX Pro Max from
https://github.com/nextlevelbuilder/ui-ux-pro-max-skill at `15de38f`.
Ran its design-system and keyboard-focus searches. Landing-page suggestions were
rejected as inappropriate for a custom editor; applied compact control grouping,
semantic theme tokens, visible focus and reduced-motion guidance instead.

- 49 tests passed; one opt-in codec test skipped. The UI adds percentage readouts,
  moves projection/layout/view tabs above the media, and groups PowerMap and audio.
  No decoding, projection math or DSP changes in this UI update.
- Real Chrome at the existing desktop viewport: original 4ch WebM completed
  17.9735 seconds / 539 frames / 129 maps, with zero reported late frames or
  starvation. Keyboard tab switching, slider percentage updates, Spatial and
  overview rendering were verified. Final layout had no horizontal overflow;
  the footer fit within the viewport. Mono WAV shows its audio-only state and
  disables FOA/projection controls. EAC MP4 controls and Spatial also exercised.
- No repeated width sweep, fresh installed VS Code/Cloud IDE validation or
  light-theme visual acceptance was performed. VS Code theme variables are
  preserved; a packaged VSIX is not evidence of installation.

## pano-player / EAC / Stereo, 2026-09-18

Source version: 0.4.0. Renamed package and visible labels; retained the existing
editor/command IDs. Remove the old FOA PowerMap Player package before installation.

- `npm test`: 47 passed, one opt-in codec test skipped. Existing audio decoding
  and bypass code is unchanged by this projection update.
- Chrome GPU pixel check: EAC-to-ERP mean absolute RGB error 0.280/255 against
  FFmpeg `v360=eac:e:interp=linear`, with all 460800 output pixels nonblack.
  Distinct-color eyes verify SBS left and TB top selection, including Y orientation.
- Spatial pixel check: 2304/2304 samples nonblack and 2304 changed after turning;
  source-canvas replacement and size changes while paused also pass.
- Actual webview UI in Chrome: eight-second 4ch EAC/AAC MP4, ERP SBS/Opus WebM
  and ERP TB/AAC MP4 each completed 240 frames with zero reported late frames or
  starvation. MUSIC produced 58, 57 and 58 updates respectively. EAC seek to
  three seconds resumed to the end. Spatial, thumbnail and 180 blank-side
  rendering were visually checked at the existing desktop viewport.
- This is local browser validation, not installation or fresh Cloud IDE validation.
  EAC supports the conventional padded 3x2 layout, not arbitrary cube layouts.

Reproduce the GPU check (FFmpeg is a test-only dependency):

```sh
ffmpeg -f lavfi -i "nullsrc=s=960x480,format=rgb24,geq=r='128+100*sin(2*PI*X/W)':g='128+100*cos(2*PI*X/W)':b='32+190*Y/H'" -vf 'v360=e:eac:w=720:h=480' -frames:v 1 -y /tmp/pano-eac.png
ffmpeg -i /tmp/pano-eac.png -vf 'v360=eac:e:w=960:h=480:interp=linear' -frames:v 1 -y /tmp/pano-reference.png
node tests/stream-server.cjs /tmp/pano-eac.png /tmp/pano-reference.png
```

Open `/projection-test` on the printed local URL; it must report PASS.

## Mono/Stereo Bypass, 2026-09-16

Source version: 0.3.5. Mono/stereo preserve their decoded channel count and route
PCM directly to the volume gain. No FOA capture, MUSIC worker or Omnitone renderer
is initialized for these inputs. Spatial controls affect video only.

- `npm test`: 46 passed, one opt-in codec test skipped by default.
- The opt-in codec test was separately run on eight generated fixtures: mono/stereo
  WAV, AAC and Opus, plus four-channel AAC and Opus. Each decoded channel matched
  independent FFmpeg PCM with normalized squared error below 1e-6.
- Real Chrome using the extension's webview code: mono AAC MP4 and stereo Opus
  WebM both completed about 12 seconds, 240 video frames, zero reported late frames,
  zero starvation and zero PowerMap frames. Spatial view, camera rotation and
  thumbnail rendered; stereo seek to 6 seconds resumed and completed.
- Mono/stereo WAV both completed 3 seconds with Bypass shown and FOA controls
  disabled. Four-channel AAC still initialized binaural audio and updated MUSIC.
- These are generated test assets and local browser checks, not a fresh installed
  desktop/Cloud IDE acceptance run or a subjective listening-quality evaluation.

## Bundled Streaming Codecs, 2026-09-14

This section records 0.3.2. Earlier sections below describe retired implementations.

- AAC uses the bundled decoder-only LGPL FFmpeg 7.1.5 WASM build; Opus uses
  libopus multistream WASM. There is no host FFmpeg/Python dependency. Release
  bundles are minified with esbuild. VS Code's own installation is not patched.
- 40 extension checks pass; one original-media check is opt-in. Three shared
  PCM worklet checks pass. New checks cover bounded host-file reads, exact offsets,
  resource streaming/backpressure/cancellation, stale seek epochs, starvation,
  overflow, and resampling of the consumed-PCM clock.
- The opt-in original-file check passes separately for `target_foa.mp4` (AAC)
  and `_74aGilhTGU_289.webm` / `_74aGilhTGU_1306.webm` (Opus). All four decoded
  planes match independent FFmpeg float PCM with normalized squared error below
  1e-6, including AAC priming and Opus preskip. First two seconds read 820217,
  235332 and 126410 bytes respectively, not the complete files. Decode-only
  times in this Node/release check were 44.4, 33.9 and 18.7 ms. These are not
  end-to-end playback startup or CPU/RTF measurements.
- Desktop VS Code 1.136.1, installed 0.3.0 with the streaming resource bridge:
  the 70-second AAC QA fixture completed at 70.0013 s, 500 maps, 2090 video frames,
  zero late frames and zero starvation events. Original `_74aGilhTGU_1306.webm`
  completed at 15.9735 s with 114 maps, 401 frames and zero late/starvation events.
  Actual computer-use screenshots showed video plus the live overlay. The long
  AAC fixture is extended test material, not an untouched 70-second recording.
- The initial Cloud IDE HTTP-based attempts failed with corrupted packets and
  video flush errors. VS Code 1.84's resource service worker returns a full file
  with a zero-start Content-Range even for nonzero range requests. Version 0.3.2
  bypasses that transport for media using document-scoped, bounded 256 KiB reads
  through the extension messaging API. No arbitrary client-supplied path is read.
- Installed 0.3.2 Cloud IDE WebM playback reached 18.9735 s for `_74aGilhTGU_289.webm`
  with four channels, 85 maps and 241 presented frames after user seek activity;
  three late frames and two starvation events were recorded. This is not a clean
  uninterrupted run or a zero-stall claim. A separate `0FB9jMXMP8A_123.webm` run
  completed at 9.9735 s with 72 maps, 299 frames, zero late frames and zero starvation.
- Cloud IDE original `gen_cfg5.0_foa.mp4` (H.264/AAC, 640x640) completed at
  10.0310 s with 72 maps, 149 presented frames, zero late frames and zero starvation.
  Seeking to 5.02 s and replaying reached the end again, with cumulative 108 maps
  and 223 frames. A computer-use screenshot verified nonblank 180 ERP Spatial
  view with the current-view thumbnail. First-frame/canplay was 880.1/899.7 ms.
  `target_foa.mp4` also decoded four-channel audio and completed, but its video
  was hidden during part of the test, so its one-frame report is not video QA.
- WAV's four PCM channels also passed the independent FFmpeg comparison; the
  first two seconds read 1.20 MB of the 31.09 MB input. Desktop 0.3.2 WAV reached
  canplay at 87.9 ms and the original WebM at 286.6 ms. Further desktop GUI
  replay was not accepted as verified: computer-use returned ScreenCaptureKit
  failures/stale window state, and its approval service intermittently failed
  at capacity. The completed desktop playback measurements above are from 0.3.0;
  final document-scoped transport is tested in Cloud IDE and automated checks.
- Cloud cold readiness remained variable: 16.127 s for the first WebM above and
  2.867 s for the second. The earlier 0.3.0 first-frame metric incorrectly equated
  audio readiness with a video frame; 0.3.1+ measures actual canvas presentation.
  No claim of instant startup or precise native-preview speedup is made.

Remaining boundaries: no guarantee for every browser video codec, damaged media,
Windows/Linux desktop playback, or subjective headphone quality. WAV full GUI
replay with the new host-file transport remains unverified in this test session.

Reproduce the independent PCM check:

```sh
FOA_CODEC_FILES='/absolute/original.mp4|/absolute/original.webm' \
FOA_FFMPEG=/absolute/ffmpeg node --test tests/stream-codecs.test.cjs
```

FFmpeg is a test reference only. Runtime acceptance uses the packaged extension
and computer-use UI actions. Subjective headphone listening and OS-device audio
capture were not performed in this rewrite's validation.

## Native Rewrite, 2026-09-14

Current source is 0.2.3. Older sections below describe the retired 0.1.x pipeline,
not the architecture or acceptance status of native preview.

- 35 extension Node checks pass, including no host-processing imports on local
  and remote editor startup, parent-directory resource roots, native controls
  independent of DSP initialization, single-clock monitoring, stale-frame epochs,
  channel-order switching, non-FOA fallback and paused audio-thread suspension.
  A regression check first failed, then passed with the 0.2.3 fix: `playing`
  resets channel validation so an ignored paused-state error is reported again.
  The suite also retains historical backend tests; those are not native acceptance.
- 21 shared browser DSP checks pass: MUSIC/reference agreement, display-axis flips,
  discrete channel reorder, worklet epoch reset, silence and bounded worker queues.
- Isolated real Chrome replay passed for WebM/Opus, MP4/AAC and float WAV. All
  exposed four channels to the capture worklet and generated live PowerMaps.
  WAV played through its eight seconds; MP4 through its five seconds. These short
  checks do not establish every codec, WAV encoding, or long-session reliability.
- Latest WebM run advanced to 11.016 s, received 79 maps, recorded 176 video frames,
  zero drops and zero buffering waits. A previous run dropped 1/176, so this is
  not a zero-drop guarantee. Spatial drag changed yaw to .5 and pitch to .1;
  the sampled RGB framebuffer contained 12288 nonzero components.
- Independent Chrome contexts using the same loopback media server recorded
  native-element canplay at 338.8/292.1 ms and plugin canplay at 469.2/287.7 ms.
  Another warmed open took 557 ms. These are browser-page measurements, not
  local VS Code or Cloud IDE click-to-preview measurements. Reproduce with
  `PLAYWRIGHT_PATH=/path/to/playwright node tests/native-browser.cjs /absolute/file.webm`.
  Generated reports/screenshots are in `output/` and intentionally not committed.
- Cloud IDE 1.84 installation 0.2.1 was visibly verified with the original
  2560x1440 `_74aGilhTGU_56.webm`: it reached the end, showed 4ch WYZX/SN3D binaural
  mode and live DSP updates, and rendered Spatial view plus the panorama footprint.
  `_74aGilhTGU_289.webm` also reached native metadata/controls without host processing.
- Cloud diagnostic first-frame/canplay readings were 6265.9 ms and 9954.0 ms for
  those files. Do not describe cloud cold opens as instantaneous. The built-in
  Video Preview was confirmed to use the same resource origin/path and decode
  the same 2560x1440 source, but its exact readiness timing was not captured.
  A UI wait initially found no native video; a later observation found it ready.
  That coarse observation is not a precise native-versus-plugin benchmark.
- Installed 0.2.1 in local VS Code and an isolated local profile. Full local
  custom-editor GUI playback is still pending: native automation encountered
  ScreenCaptureKit failures/window changes. Chrome page tests do not close this gap.

### Follow-up Native Acceptance

- Cloud IDE 0.2.2 completed `_74aGilhTGU_289.webm` at 19.003 s with 182 maps,
  326 video frames, two drops and one buffering wait. First-frame/canplay was
  7678.7/7679.1 ms in its diagnostic log. This was not a zero-buffering run.
- A continuous UI polling comparison on the same Cloud IDE file measured
  plugin reopen-to-ready at 11.720 s and 15.007 s, and built-in Video Preview
  at 13.020 s and 20.489 s. These include UI/RPC observation latency, are repeated opens
  without cache purging, and are not precise browser event timestamps or a
  statistical benchmark. They show comparable multi-second transport waits,
  not instantaneous cloud loading or a proven speed advantage.
- Built 0.2.3 browser assets passed a paired 63-second real Chrome run:
  native 62.949 s / 1323 frames / 78 drops; plugin 63.007 s / 1323 frames /
  65 drops, 450 maps, no buffering waits, no unexpected pause and no errors.
  Both drop rates are nonzero (5.9% and 4.9%); this headless fixture/platform
  result must not be represented as smoothness validation of desktop VS Code.
  Plugin canplay was 83.1 ms in this warmed run; separate fresh contexts
  measured native 281.4/32.9 ms and plugin 81.3/78.6 ms. No latency guarantee.
- `tests/native-audio.cjs` feeds generated 4ch WYZX/SN3D PCM WAV through the
  actual media element, capture worklet and playback gains. Output energy
  for a left source was L=.014384 / R=.002144. Thirty-one left-arrow view
  steps (yaw=3.1 rad) reversed it to L=.002124 / R=.014382. Reset restored
  left dominance; mute measured zero in both channels; stereo L/R energy
  ratio was 9. These are digital graph measurements, not a subjective listening
  test or a recording of the system audio device.
- The original long test unexpectedly paused at 48.971 s. It lacked event
  diagnostics and its cause is unresolved. Two stricter subsequent runs
  advanced past 63 s; the latter recorded only expected play/playing events.
  Long-run QA now asserts the requested media-time advance instead of merely
  checking that playback reached three seconds.
- Reproduce the paired run with `FOA_PLAYBACK_MS=60000` and the command above.
  Generated reports/screenshots remain in `output/`.
- Version 0.2.3 was installed successfully in the Cloud IDE workspace extension
  directory, reloaded and played the same 19.003-second WebM to completion:
  163 maps, 326 video frames, 22 drops and one buffering wait. Browser diagnostic
  first-frame/canplay was 6043.5/6044.4 ms. The frame-drop variability versus
  the previous run is real; do not promise zero drops. The CUA DOM facade cannot
  expose the native preview's frame counters, so its cloud drop-rate comparison
  remains unmeasured (the paired Chrome-page comparison above is separate).
  Local default VS Code remains at the previously installed 0.2.2.
  A new local validation-window launch was explicitly denied by the permission
  reviewer because the user had selected Chrome-only operation. No bypass was
  attempted. Local GUI validation requires renewed user approval.

### Authorized Local GUI Check

The user subsequently explicitly authorized local VS Code testing and requested
the computer-use tool rather than Orca CLI. Version 0.2.3 is now installed in the
default local VS Code profile. No product runtime code changed in this follow-up.

- Actual VS Code 1.136.1, Restricted Mode: the local WAV
  `/tmp/foa-powermap-real-70s.wav` reached its actual end at 53.9835 s (the file
  name does not reflect its duration). First data/canplay was 38.6/39.5 ms,
  with 386 maps, four decoded channels and zero buffering waits. The GUI showed
  binaural mode and a visible heatmap, then 0:53 / 0:53 at completion.
- The VP9/Opus ambisonic WebM fixture failed both the custom editor and built-in
  Video Preview. The custom editor reported `DEMUXER_ERROR_COULD_NOT_OPEN`;
  native preview displayed its video-loading error. This is a measured local
  decoding boundary, not evidence of a plugin-only resource failure. Chrome
  handles this same fixture. Do not generalize to every WebM or VS Code version.
- An H.264/4ch-AAC fixture was extended to 70 s by stream-copy looping solely
  for QA, not by adding transcoding to the extension. Local installed-plugin
  logs show first frame 97.6 ms and canplay 98.0 ms. Its GUI long playback and
  native timing comparison remain unverified.
- After desktop unlock, the MP4 title and controls matched and playback was
  started through computer-use. The installed-plugin log recorded 10.624245 s,
  322 video frames, zero dropped frames and zero stalls, but only two channels
  reached the worklet. FFprobe confirms the file contains AAC with four
  channels (`4.0`). The UI correctly disabled spatial processing and retained
  native audio; zero PowerMaps were produced. This is not a successful FOA
  video acceptance result. The cause of the local channel reduction remains
  unproven; do not infer it from container metadata alone.
- A QA-only VP9/Vorbis four-channel copy was prepared at
  `/tmp/foa-powermap-local-vorbis.webm`. FFmpeg warned about the ambisonic layout
  and an Opus packet; this copy is not direction-correctness evidence. Its
  playback is unverified because computer-use repeatedly rejected the open
  action with `The user changed ... Re-query the latest state` even after a
  fresh state read. Further UI actions were stopped.
- Native computer-use became inconsistent: the window title changed to the MP4
  while its returned accessibility body and screenshot still showed the older
  WAV and Quick Input. Resetting the tool and reselecting the window did not
  reconcile them. Further clicking was stopped rather than treating the stale
  UI as proof of MP4 playback. An unrelated temporary TFLite file was briefly
  opened during this mismatch; it was not edited.
- Local evidence: `Code/logs/20260912T204706/window5/exthost/`
  `output_logging_20260914T131502/1-FOA PowerMap.log` under the user's Library
  Application Support directory. The running player remains 0.2.3.

Remaining acceptance: sustained local video playback and local native-startup
comparison, plus a controlled cold-cache Cloud IDE timing study. Authorization
is no longer the blocker; reliable native UI targeting is needed for the next
video check. The full local-and-cloud goal is incomplete.

### 0.2.4 Codec Diagnostic Correction

- The user-visible `target_foa.mp4` is H.264 640x640 with four-channel AAC
  (`4.0`), verified with FFprobe. Installed 0.2.3 recorded 10.030998 s and 150
  video frames without drops or stalls, but zero maps and two worklet channels.
  Evidence is in `window6/exthost/output_logging_20260914T140424/4-FOA PowerMap.log`
  under the same local VS Code log session above.
- This does not prove a four-to-two-channel downmix. The locally installed
  `extensions/media-preview/README.md` explicitly excludes AAC in MP4.
  [Chromium's media source implementation](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webaudio/media_element_audio_source_handler.cc)
  defaults its output to two channels and can generate silence before a valid
  audio format is available. Missing codec support is a supported explanation,
  not a directly observed decoder trace for this file.
- 0.2.4 reports the observed Web Audio channel count, never promises audible
  fallback, and adds an AAC capability hint on MP4 channel errors only when
  `canPlayType` reports no AAC support. This synchronous check runs on the
  error path, not before playback. A red/green regression covers unsupported
  AAC, supported AAC and non-MP4 input; all 36 Node tests pass.
- This is a diagnostic fix, not added AAC decoding. Installed local and Cloud
  IDE runtime acceptance above still describes 0.2.3; 0.2.4 GUI acceptance and
  the remaining full-goal checks are not yet complete.
- Local installation of 0.2.4 subsequently succeeded through the official
  VS Code CLI. The existing window reports an extension restart is required;
  no 0.2.4 runtime result is claimed yet. The UI changed to another editor
  during testing, so a short uninterrupted GUI test interval was requested.
- `/tmp/foa-powermap-local-vorbis-clean.webm` uses the existing video and the
  separately verified four-channel WAV, with explicit identity channel mapping
  into Vorbis quad. A full decode of the resulting file completed without
  errors. This is only a test fixture, not a product fallback or proof of AAC
  support. Its GUI playback has not yet been verified.

### Uninterrupted 0.2.4 Local Recheck

After the user granted an uninterrupted test interval, computer-use reloaded
the workspace and verified 0.2.4's new diagnostic on the actual
`gen_cfg5.0_foa.mp4`. The file reached canplay in 25.3 ms and its 10.030998 s end
with 154 frames, zero drops and zero stalls. It still exposed two worklet
channels and produced no maps. The generic codec/channel hint appeared, not
the conditional AAC-unsupported hint; no exact codec capability result or
decoder root cause is inferred from that UI.

The clean VP9/Vorbis fixture failed to open. A QA-only VP8/Vorbis copy at
`/tmp/foa-powermap-local-vp8.webm` also failed in both the plugin and built-in
Video Preview. The former reported `DEMUXER_ERROR_COULD_NOT_OPEN`; the latter
displayed its video-loading error. This rules out claiming that these fixtures
provide successful local four-channel video acceptance. It does not establish
which media-library component rejected them.

Current evidence: `window6/exthost/output_logging_20260914T141517/6-FOA PowerMap.log`
under the local log session above. The local window is now running 0.2.4;
Cloud IDE remains on the previously tested 0.2.3. This recheck supersedes the
pending-reload and unverified-fixture notes above, not the outstanding full-goal
acceptance requirements.

## Historical 0.1.x Validation

Verified on 2026-09-10, macOS arm64, VS Code 1.136.1. The actual VSIX was
installed in an isolated extensions directory and activated by a separate
test harness extension. Normal user settings/extensions were not modified.

## Automated Checks

- 14 Node tests passed: input/track validation, actual first-frame timestamps,
  FFmpeg argument boundaries, latest-only queue, cancellation, stale replies,
  media-clock fallback, CSP escaping and opt-in custom editor registration.
- 4 Python tests passed: streaming/batch skill equivalence with history,
  known front/left/up direction peaks, WYZX/WXYZ equivalence, silence,
  non-finite rejection and RGBA elevation/alpha behavior.
- Real-data WebM/Opus and MP4/AAC integration checks passed. Four-channel PCM
  comparison against an independent decode was exactly equal after accounting
  for the actual decoded timestamps. Warm cache reuse and analyzer reset passed.
- A clipped source had container start 0 but first decoded video frame 5.305 s.
  The plugin now normalizes to that actual frame and trims/pads audio using its
  decoded PTS. The test compared 192000 float values per format across all four
  channels, with maximum absolute sample error 0.

## Installed VS Code Playback

The fixture used real `nagycDdW04w_10.0` footage/audio from the workspace,
normalized to 960x480 and looped to 70 s for sustained QA. No PowerMap was baked
into this fixture. Its usable video timeline after first-frame normalization
was 64.719 s. This is an extended QA fixture, not a new 70-second recording.

Measured in the production interpreter/extension, without a debug build:

| Check | Result |
| --- | --- |
| Continuous media-time advance | 61.187 s |
| PowerMap updates during run | 432 |
| DSP median / P95, 61 periodic samples | 1.81 / 2.63 ms |
| Largest periodically sampled map age | 143.94 ms |
| Stale-generation replies displayed | 0 |
| Nonzero overlay-alpha pixels at paused endpoint | 9791 / 9800 |
| Captured playback audio peak | 0.01270 |
| Audio decoded bytes | 1681920 |
| Video frames / dropped frames | 1599 / 39 |
| Backward / forward seek | 12 s / 48 s, map matched each position |
| Pause and overlay disable/enable | Passed |
| WYZX/WXYZ switch and return | Passed, retained 48 s position |
| Narrow panel | 390 px viewport, 390 px scroll width |
| Narrow video and overlay rectangles | Both x=8, y=67, 374x187 |

The video drop count is cumulative through the seek checks, not an isolated
decoder benchmark. This is not a zero-frame-drop claim. Audio was checked by
capturing a nonzero playback waveform; subjective headphone listening was not
performed. CPU utilization and RTF were not measured.

The initial WebM playback proxy failed in this VS Code build despite reporting
codec support. H.264/MP3 MP4 playback succeeded. The extension therefore uses
that compatible preview format, while keeping four-channel analysis separate.

## Remaining Boundaries

- First open transcodes a full preview and decodes PCM; large files can take time
  and disk space. No claim of instantaneous startup or bounded total disk use.
- Preview is 960x480, not full-resolution source playback.
- Windows, Linux, Remote SSH and browser-hosted VS Code were not validated.
  Remote/browser hosts are explicitly outside this release's support scope.
- SN3D and panorama/FOA orientation are user input contracts. Arbitrary quad
  speaker tracks and misaligned camera orientation cannot be inferred reliably.
- A local custom editor is used; this does not patch VS Code's built-in player.

## Workspace Evidence

`output/playwright/foa-vscode-playing.png`, `foa-vscode-narrow.png`,
`foa-vscode-qa.json` and `foa-vscode-controls.json` in the parent workspace hold
screenshots and raw test observations. These private media artifacts and all
test-harness scripts are excluded from the VSIX.
# 0.1.1 Default-Settings Regression Check

Verified on 2026-09-10 with the installed 0.1.1 VSIX in a new isolated VS Code
profile. No executable settings were written. The test extension host forced
`PATH=/usr/bin:/bin` before activating the player.

- Automatically found Homebrew FFmpeg/ffprobe and the user's Conda Python,
  including required Python imports.
- Real 4ch video advanced 61.204 seconds with 430 live map updates; audio peak
  was 0.01270 and the overlay contained 9,793 nontransparent pixels.
- Maximum sampled map age was 144.24 ms; seeks to 12 and 48 seconds matched.
- 22 Node tests and 4 Python tests passed. Discovery coverage includes missing
  dependencies, legacy defaults, explicit overrides, and cancellation.
- Playback counters were 1,599 frames / 34 dropped, including seek operations;
  this is not a zero-drop claim.

Report: `output/playwright/foa-vscode-autodiscovery-qa.json` in the parent repo.
This verifies automatic discovery on macOS, not a dependency-free installation
on a clean computer. External runtimes are not bundled.
# 0.1.2 Aspect Ratio and Direction Regression Check

Verified on 2026-09-11 with the installed 0.1.2 VSIX in an isolated default-settings
VS Code profile. A 1280x720 H.264/4ch AAC fixture encodes +Y (left) for the first
four seconds and -Y (right) for the next four seconds.

- Preview decoded at 854x480, retaining 16:9 within even-pixel rounding.
- Display peak columns were 33 for left and 103 for right on the 140-column map.
  Both WYZX and WXYZ synthetic Python tests match skill rendering byte-for-byte.
- Actual playback advanced 2.053 seconds; 21 maps had arrived after seek/play
  checks. Video and overlay rectangles matched at 1200px and 390px viewports,
  with no horizontal overflow. Desktop and narrow screenshots were inspected.
- 24 Node tests and 5 Python tests passed. Square and portrait aspect handling
  are unit-tested; installed-host playback was tested with 16:9 media.
- Independent four-channel PCM decoding matched exactly (maxError=0); warm
  cache reuse passed. Cache revision changed to prevent reuse of stretched previews.

Artifacts in the parent repo: `output/playwright/foa-vscode-aspect-directions.json`,
`foa-vscode-aspect-desktop.png`, and `foa-vscode-aspect-narrow.png`.
Stretching a spherical map does not geometrically calibrate perspective/cropped video.
# 0.1.3 WAV Playback Check

Verified on 2026-09-11 with the installed 0.1.3 VSIX and default executable
settings. Four-channel WAV opens as an audio-only player with a standalone map.

- PCM16/44.1kHz, PCM24/48kHz, and Float32/48kHz WAV integration checks passed;
  all four analysis channels matched independent decoding exactly (maxError=0).
  Cached stereo MP3 reuse and analyzer seek resets passed. MP4 regression passed.
- A 70-second PCM24 fixture, looped from real FOA audio, advanced 61.288 seconds
  in the installed player with 410 map updates. Captured audio peak was 0.01874;
  the map had 9,786 nontransparent pixels. Maximum sampled map age was 162.4 ms.
- Pause, seeks to 12/48 seconds, map toggle, and WYZX/WXYZ switching passed.
  Order changes preserved the 48-second position. A 390px editor had no horizontal
  overflow and a 374x187 standalone map. Desktop/narrow screenshots inspected.
- 27 Node tests and 5 Python tests passed. Tests reject stereo input rather than
  manufacturing FOA channels. No video is encoded for WAV playback.
- The playback harness now explicitly pauses/plays instead of assuming the
  initial toggle-button state. Earlier toggle-based runs did not pass and are
  not used as successful playback evidence.

Artifacts in parent repo: `output/playwright/foa-vscode-wav-playback.json`,
`foa-vscode-wav-controls.json`, `foa-vscode-wav-desktop.png`, `foa-vscode-wav-narrow.png`.
# 0.1.4 180 ERP Projection Check

Verified on 2026-09-11 with an installed 0.1.4 VSIX, a square 480x480 test video,
and four-channel audio with known +45/-45 degree sources.

- At a 900px viewport the video rectangle was 434x434 and the full map was
  868x434. At 390px they were 187x187 and 374x187. Video started at exactly 25%
  of the full map width, preserving its aspect ratio with equal side padding.
- Known left/right peaks mapped to 21.4%/75.7% of the video width (grid/MUSIC
  resolution and AAC input affect peak precision); the coordinate transform
  is `(map_fraction - 0.25) * 2`, not full-map compression into the video.
- During playback, 360 -> 180 switching preserved source URL, session and
  generation; media advanced 1.447 seconds with continued map updates.
- The selected 180 mode survived Webview rebuilding on FOA order change.
  Desktop/narrow screenshots were inspected. WAV mode ignores projection;
  non-square source ratios and preference restoration are covered by unit tests.
- 29 Node tests and 5 Python tests passed. One initial UI test exceeded the
  browser user-gesture window before play(); the successful run initiates
  playback before asynchronous seek/layout checks.

Artifacts in parent repo: `output/playwright/foa-vscode-180.json`,
`foa-vscode-180-desktop.png`, and `foa-vscode-180-narrow.png`.
This supports a single ERP view, not stereo unpacking or fisheye conversion.
# 0.1.5 Automatic Projection Selection

Verified on 2026-09-11: 30 Node tests passed. Near-square decoded video ratios
(0.9 through 1.1 inclusive) select 180 ERP automatically; near-2:1 and other
ratios select 360 ERP. Tests cover the tolerance edges, portrait and 16:9 input,
stale saved projection values, manual overrides, and audio-only playback.

Projection/channel-order persistence was removed per the revised request.
Channel order remains manually selectable with WYZX as the initial default.
Existing 0.1.4 layout/playback validation applies to the unchanged renderer;
the installed-host UI was not rerun for this heuristic-only update.

# 0.1.6 Real-Time Binaural Playback

Verified on 2026-09-11 in an isolated desktop VS Code profile using the packaged
extension and default executable discovery.

- 31 Node tests and 5 Python tests passed. WAV/video preparation and cache reuse
  passed; independent sidecar decoding matched raw analysis PCM exactly after
  WYZX/WXYZ reordering (maxError=0). Analysis PCM remains in source order.
- A 70-second real-FOA WAV fixture advanced 61.248 seconds with 409 map updates.
  Captured post-Omnitone peak was 0.005571; maximum sampled media-clock difference
  was 42.33 ms, with no corrective seeks during sustained playback.
- A 70-second square video with the same FOA audio advanced 61.240 seconds with
  409 map updates, 1,578 video frames and zero reported dropped frames in this run.
  Post-Omnitone peak was 0.005351; maximum sampled clock difference was 42.55 ms.
  DSP median/P95 were 2.350/3.563 ms; maximum sampled map age was 154.27 ms.
  Pause, seek to 12/48 seconds and overlay toggling passed; paused seeks aligned
  both media clocks. These measurements are not a sample-exact sync guarantee.
- Offline rendering through the bundled Omnitone produced left-source ear
  energies [0.0496497, 0.00409644], swapped for a right source. Listening mode,
  mute and volume checks verified exclusive binaural/stereo routing.
- WYZX/WXYZ switching rebuilt the renderer while preserving the 48-second
  position. Desktop and 390px layouts were inspected; no horizontal overflow,
  and the 180 ERP video remained centered in the double-width map.
- Strict Webview CSP is retained. Omnitone's empty `new Function` error handler
  was replaced by an ordinary empty function; the initial CSP-failing run is
  not counted as successful playback evidence. HRIR data is bundled offline.

Reports: `output/playwright/foa-binaural-{wav,video,direction}.json` in the parent
repository. Rendering faces forward; head tracking and sample-accurate clock
locking are not implemented.

# 0.1.7 Camera-Relative Spatial View

Verified on 2026-09-11 in the isolated installed VS Code extension:

- 32 Node and 5 Python tests passed. Real WebGL pixel checks verified nonblank
  180 front/360 rear views and a fully black 180 rear with the map disabled.
  A map marker at +45 azimuth/+30 elevation landed at the view center when the
  camera faced that direction. WebGL video pixel hashes changed during playback.
- Omnitone rendered a forward source predominantly into the right ear when
  looking left, and the left ear when looking right: ear energies were
  [0.00409644, 0.0496497] and the reverse. Flat mode restored identity rotation.
- Real mouse dragging changed yaw/pitch. Keyboard direction, wheel FOV, pitch
  clamp, reset, and 390px no-overflow checks passed. Screenshots were inspected.
- In spatial mode, video advanced 61.247 seconds with 409 new maps. There were
  2 reported dropped frames out of 1,582; this is not a zero-drop result.
  Maximum sampled audio-clock difference was 49.77 ms, without corrective seeks.
  Captured output peak was 0.005351. Pause/seeks/overlay toggles passed.
- Initial paused-texture testing found a black first frame. The view now
  explicitly uploads the current decoded frame; a fresh installed-host rerun
  passed without manually modifying texture state.
- WAV spatial playback advanced 61.237 seconds with 409 new maps, a captured
  output peak of 0.005327 and maximum sampled clock difference of 40.88 ms.
  Audio-only geometry, seeks and nonblank projected map pixels were checked.

Reports are `output/playwright/foa-view.json` and `foa-view-playback.json` in the
parent repository. Three.js is bundled locally. There is no hardware tracking,
perspective-video calibration, or filtering out sound beyond the camera FOV.

# 0.1.9 VS Code 1.84 Compatibility

Verified on 2026-09-12 using the official macOS arm64 VS Code 1.84.1 build
2b35e1e6d88f1ce073683991d1eff5284a32690f in an isolated profile.
The previous ^1.90.0 manifest unnecessarily prevented installation; the minimum
is now ^1.84.0. The packaged VSIX installed successfully in 1.84.1.

33 Node tests passed. The old host loaded the editor, generated maps, rendered
180/360 spatial views and passed camera-relative Omnitone checks. A playback
run advanced 61.228 seconds with 430 map updates and nonzero audio output.
Pause and seeks passed. However, video quality counters reported 1,788 dropped
frames out of 2,279 cumulative frames, and a separate five-second check also
reported heavy dropping. Installation/functionality is verified, not smooth
video on this old host; the cause of the old-host frame dropping is unresolved.
Reports: output/playwright/foa-vscode-184-{view,playback}.json in the parent repo.

# 0.1.11 Workspace/Cloud Host Adaptation

The extension now declares workspace execution rather than UI-only execution.
Local files on remote hosts and vscode-remote documents are accepted; virtual
documents/URL streams and relative paths remain rejected. Cache resources retain
the storage URI's scheme and authority when passed to asWebviewUri. No custom
network server or public file access is introduced.

35 Node tests passed, including mocked local/remote extension-host loads checking
the source filesystem path, media URLs and allowed resource roots. These tests do
not prove compatibility with a particular Cloud IDE gateway, its media range
request handling, cloud dependency installation or network playback performance.
Cloud IDE deployment/playback validation is pending.
