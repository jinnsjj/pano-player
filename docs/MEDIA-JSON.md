# JSON Media Configuration

Open a configuration with **Open With > PanoPlayer**, **PanoPlayer: Open Media**,
or **Play with PanoPlayer** on an absolute JSON path in a text editor. Ordinary
JSON files still open in the text editor by default. This entry point requires
the VS Code extension; the standalone web player cannot read host filesystem paths.

Configurations may use `.json` or `.jsonpp`. **Opening a `.jsonpp` file normally
opens PanoPlayer directly**, while ordinary `.json` files remain text-editor
documents unless you explicitly choose **Open With > PanoPlayer**. Use
**Reopen Editor With > Text Editor** to edit a `.jsonpp` file as JSON. Explicit
user editor associations take precedence over the extension's default. This
also applies when the extension is installed on a VS Code Remote workspace host.

```json
{
  "version": 1,
  "video_path": "./video.mp4",
  "audio_path": [
    "./audio/reference.wav",
    "./audio/predicted_foa.wav"
  ],
  "annotation": "./annotations.json"
}
```

For a single external audio file, `audio_path` can also be a string:

```json
{
  "version": 1,
  "video_path": "./video.mp4",
  "audio_path": "./audio/reference.wav"
}
```

## Fields

| Field | Value |
| --- | --- |
| `version` | Required integer `1`. |
| `video_path` | Required MP4, WebM, MOV or MKV file path. |
| `audio_path` | Optional single file path string or array of up to 32 MP4, WebM, MOV, MKV, WAV or FLAC file paths. A string is equivalent to a one-element array. Omit it or use `[]` for no external audio. Duplicate resolved paths are loaded once, preserving their first position. |
| `annotation` | Optional path to a separate [annotation JSON](ANNOTATIONS.md). The annotation contents are not embedded in this configuration. Omit this field when unused. |

Unknown fields, unsupported versions and incorrect field types are rejected.
The configuration must be valid UTF-8 JSON, at most 64 KB. Comments and trailing
commas are not supported. Actual playback still depends on the contained codecs.

## Paths And Remote Windows

Paths may be absolute or relative to the **configuration file's directory**, not
the workspace folder or the video directory. Spaces, Unicode, `#` and `%` are
literal filename characters. Use the workspace host's path syntax; JSON Windows
backslashes must be escaped. URLs, `~` expansion and environment-variable
expansion are not supported.

In Remote SSH, Dev Containers or another VS Code Remote window, install
PanoPlayer on the workspace host. Store the configuration and referenced files
on that host (including accessible mounts). Relative paths and absolute paths
are resolved there, never against the client computer. The extension reads the
video and audio incrementally over its existing message transport. No download
step, FFmpeg process, HTTP server or port forwarding is required. References may
be outside the workspace; only the configuration's listed media receive opaque
session IDs, without granting webview access to their parent directories.

## Playback

The video's own audio tracks remain the default. Each external file's tracks are
added to **Audio > Track** in configuration order, without mixing them together.
If the video has no audio tracks, the first usable external file is selected
automatically. A manual selection made during loading takes precedence. With no
usable external audio, a silent video remains silent. Unavailable external files
are shown as disabled entries; their failure does not stop the video.

External audio shares time zero with the video, with no automatic alignment or
offset. The existing track-switching behavior and shorter-duration playback
limit apply. Audio choices and loaded annotations are local to the current
player session, not saved into the configuration or cross-file preferences.

The annotation file is loaded automatically through the enabled annotation
plugin after activation. An annotation read or validation error is reported
without stopping playback. The configuration and source files are never modified.
Close and reopen the configuration to reread changed paths.
