# External audio track feasibility

Inspected: 2026-09-24, PanoPlayer 0.4.31. Source review only; no external-audio prototype or playback validation was performed.

## Conclusion

An audio file in another directory can be used as the video's replacement soundtrack without remuxing or changing either source file. This is feasible with the existing architecture, but is not implemented today. Initially scope this to files accessible on the same workspace host as the video, with WAV and FLAC as the first validation targets. Do not promise arbitrary codecs or local-to-remote file access.

## Current evidence

- The extension binds one `hostFile` to the opened document. Its range reader uses Node file handles, so it is not intrinsically restricted to the video's directory. The binding, not the reader, must support another explicitly selected file. [Extension](../src/extension.cjs), [range reader](../src/host-file.cjs)
- `createHostFetch` intercepts exactly one source URL. Add source routing and unambiguous request IDs; two independent adapters starting IDs at zero would collide on the shared message channel. Do not accept arbitrary filesystem paths in webview read requests. [Fetch bridge](../src/host-fetch.js)
- The worker currently creates one Mediabunny `Input`, taking both audio and video tracks from it. A second input can supply `AudioSampleSink` while the original supplies `VideoSampleSink`. Audio format detection, including WebM/Opus timing, must follow the audio input rather than the video input. Dispose both inputs on replacement/close. [Worker](../src/stream-worker.js), [codecs](../src/stream-codecs.js)
- The player uses consumed PCM frames as its playback clock and draws video according to timestamps. Keep this single clock; do not introduce a separately playing HTML audio element. [Player](../src/stream-player.js), [PCM processor](../src/powermap/wav-stream-processor.js)
- Existing track switching rebuilds the audio graph while retaining position and play/pause intent. Reuse that flow for external source selection and returning to embedded audio. Envelope decoding must also follow the selected audio source. [Monitor](../src/browser-monitor.js), [player](../src/stream-player.js), [controls](../media/player.js)
- Discrete multichannel PCM and FOA monitoring already exist. An external four-channel source can feed that route without first becoming stereo; four channels alone do not establish Ambisonic order or normalization. Retain explicit channel-order and SN3D/N3D settings. [Monitor](../src/browser-monitor.js), [player](../src/stream-player.js)

## Recommended behavior

The official Mediabunny documentation describes one `Input` per media file and sinks constructed from individual tracks. Using separate inputs for picture and sound is an architectural inference from these APIs, not a built-in synchronized-player promise. The repository pins Mediabunny 1.56.2; validate against that installed version rather than assuming every current documentation API exists. [Reading media](https://mediabunny.dev/guide/reading-media-files), [media sinks](https://mediabunny.dev/guide/media-sinks)

VS Code restricts direct webview resource access with `localResourceRoots`. Prefer the existing host range bridge for selected external audio rather than broadening those roots. This also avoids changing roots on an active panel, which the current extension explicitly avoids due to iframe reload behavior. [Official webview guide](https://code.visualstudio.com/api/extension-guides/webview#loading-local-content), [current bridge](../src/extension.cjs)

In Remote SSH and similar configurations, workspace extensions and their Node filesystem APIs run on the remote host, while the webview runs on the client. A client Mac path cannot simply be passed to the remote Node reader. Preserve and validate the selected URI's scheme and authority; unsupported cross-host selections need an explicit error or a separate transfer feature. [Official remote extension guide](https://code.visualstudio.com/api/advanced-topics/remote-extensions)

1. Add an explicit audio-file picker and a return-to-embedded-audio action. Select the file in the extension host and expose only an opaque source ID to the webview. Keep original files read-only.
2. Replace the active soundtrack, rather than mix external and embedded audio. Preserve playback position, projection, orientation, and play/pause intent.
3. Use the video's existing timeline duration as the playback boundary. Short external audio should become silence until video end; long audio should stop at video end. Today PCM EOF ends playback and overwrites duration, so simply swapping the input is insufficient. [EOF handler](../src/stream-player.js)
4. Define timestamp origins explicitly and allow a numeric offset if alignment is needed: positive offset means the external audio starts later in the video. Apply the same mapping to playback, seek, and envelope placement. A fixed offset does not repair clock drift in independently recorded material.
5. Probe the candidate's track metadata and decoder before discarding the active source. Failed selection should leave the original soundtrack usable; switching must cancel stale reads and decoded results.

No new decoder dependency, FFmpeg process, remux pipeline, playlist system, or automatic directory search is needed for this scope. Cross-host upload and HTTP URL support are separate features, not implied by supporting another directory.

## Acceptance checks before release

- Different-directory WAV/FLAC replacement; embedded stereo to external FOA and back; silent video plus external audio.
- Paused and playing selection; repeated switching and seeks; candidate cancellation, missing files, and unsupported codecs.
- Shorter/longer audio, nonzero start timestamps, positive/negative offsets, and seeks outside the audio span.
- Channel preservation, order/normalization, PowerMap, envelope, and meter following the active source.
- Long playback A/V synchronization with known sync markers, plus a remote-workspace file on the remote host. Source review is not evidence these cases already work.
