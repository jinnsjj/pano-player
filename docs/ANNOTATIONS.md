# Annotation Overlay v1

Annotation is an open-source, bundled PanoPlayer plugin. Its implementation lives
in `plugins/annotations/` and uses the same plugin API as optional extensions.
It is included and enabled by default in both VS Code and the standalone web
player; no separate installation is required.

Open a video, then drop a single annotation `.json` file onto the player, or
click the **Open annotation JSON** folder button beside the Annotation visibility
checkbox and settings arrow in the Overlay row. The folder button remains
available when Annotation settings are collapsed.
In VS Code, this command opens the native extension-host file dialog in the
current media directory. With Remote SSH, both the dialog and file reads use
paths on the remote workspace host, not the client machine. The standalone web
player uses the browser file chooser. Canceling selection or a file-level import failure
leaves the current annotations and playback unchanged.
Dropping annotations preserves the current media, playback position and play/pause state.
VS Code also accepts URI-only drops from its file tree. These files are read by
the extension host without changing the webview's resource roots. Only local
files or files on the currently opened media's remote host are accepted, with
the same 20 MiB limit and annotation validation as direct file imports.
Collapsing settings hides the secondary controls without hiding the canvas
annotations or the folder-open button.
The expandable **JSON format** reference includes valid region, point and text-only examples,
required fields, interval semantics, source-frame coordinates and file limits.
In the web player, **Plugins** can disable or re-enable the bundled module.
Files are read by the browser in the web player or by the extension host in
VS Code; no annotation data is uploaded to an external service. Each media
session owns one annotation file. Opening another media file clears its annotations.
The Annotation checkbox in the Overlay row controls visibility independently of
the settings arrow. It becomes available after importing a valid file; hiding
annotations preserves that file and its filters. Labels controls captions; source checkboxes filter
methods independently. The same geometry appears in Panorama, Perspective and
PanoView, above the PowerMap and direction grid.
When annotations contain extra fields, **Label fields** lists a separate checkbox
for each custom field found across the file's displayable valid entries. All are
unchecked on import. Checked fields are appended to region, point and sidebar
labels as `field: JSON-value`, in field-name order; missing fields on a row are
omitted. `false`, `0`, `null`, empty strings, arrays and objects are preserved.
For example, selecting `active` and `confidence` can show
`AC153 | active: false | confidence: 0.88`. These settings only affect captions:
`active: false` is metadata, not a visibility filter. Hiding Labels retains the
field choices; replacing or clearing the file resets them. Failed imports leave
the current choices unchanged. Timing, label, source and geometry fields are
not custom-field options.
Timed labels without a region or point appear under **Annotations** beside
the video (below it on narrow screens), independently of projection or camera
direction. Concurrent labels are listed separately with their optional sources.
The same visibility, Labels and source controls apply, even with settings collapsed.
These entries share the region/point timeline, overlapping-interval behavior
and source filtering; only the rendering position differs.

## Format

```json
{
  "fps": 25,
  "annotations": [
    {
      "start": 0,
      "end": 0.2,
      "label": "Region A",
      "source": "method-a",
      "bbox": [0.1, 0.2, 0.4, 0.8],
      "active": false,
      "confidence": 0.88
    },
    {
      "start": 0,
      "end": 0.1,
      "point": [0.3, 0.4]
    },
    {
      "start": 0,
      "end": 0.3,
      "label": "Scene note"
    },
    {
      "timestamp": 0.1,
      "point": [0.4, 0.5]
    },
    {
      "frame": 5,
      "label": "Face",
      "bbox": [0.2, 0.2, 0.4, 0.5]
    }
  ]
}
```

- The root object requires an `annotations` array. `version` is optional:
  omitting it defaults to v1. If provided, it must be the number `1`; null,
  strings and unsupported versions reject the file.
- Each annotation uses exactly one timing form: `start/end`, `timestamp`, or
  `frame`. They may be mixed in one file but not within one item.
- `start` and `end` remain finite video seconds, with `0 <= start < end`.
- `timestamp` is a finite nonnegative time in **seconds**, not milliseconds.
  It **requires an explicit `fps`**, either on the root object or on the item,
  and displays for `[timestamp, timestamp + 1 / fps)`: one annotation sampling
  period. Use `start/end` for longer or variable-length intervals.
- `frame` is a **zero-based**, nonnegative safe integer. It **requires an
  explicit `fps`**, either on the root object or on the item, and displays for
  `[frame / fps, (frame + 1) / fps)`. One-based exports must first subtract 1
  from their frame numbers. Frame ranges can use the existing second intervals.
- `fps` must be a finite positive number, including fractional rates such as
  `29.97`. A root `fps` supplies the default; an item's `fps` overrides it.
  This is the **annotation sampling rate**, never an automatically detected
  video FPS. For example, `{ "frame": 250, "fps": 25 }` and
  `{ "frame": 100, "fps": 10 }` both start at 10 seconds. The latter could
  describe a 10 Hz SELD label over a 29.97 FPS video. Per-item overrides allow
  these streams to coexist. An invalid root FPS rejects the file; an invalid
  item FPS skips that item, even when it has an explicit second interval.
- Visibility is half-open: `start <= currentTime < end`. Geometry is held
  constant inside its interval, without interpolation or extension across gaps.
  Samples normalize to these same intervals; simultaneous samples stay
  independent. No duration is inferred from the next row or video FPS. Converted
  intervals must be finite and have positive representable duration.
- All times refer to the currently opened video's timeline. Apply any clip
  offset before import. For original frames of variable-frame-rate video, use
  true frame timestamps rather than dividing by average FPS. Frame input adds
  time-format compatibility, not a guarantee of exact displayed-frame locking.
- `label` and `source` are optional. The former is free-form annotation text
  describing a region, point or entire time interval; the latter identifies
  the annotation source or method for filtering and color. Omitted, null or whitespace-only values are treated as absent;
  provided strings may contain at most 2,000 characters. Only provided text is
  displayed: a label without a source has no source suffix; a source without a
  label can display its source on a region or point. When neither is provided, no caption or
  placeholder is drawn.
- An item may provide one shape: `bbox: [left, top, right, bottom]` or
  `point: [x, y]`. If both are omitted or null, a nonblank `label` is displayed
  beside the video for the same half-open interval.
  These labels participate in the same source filters and active count, but are
  not projected into the image. Without a shape or label, the item is not
  displayed and does not create a source filter, but remains part of the total imported count.
  Items without a source are not assigned a synthetic source group and are not
  hidden by named-source filters. Non-null shapes are still validated; invalid
  shapes or two simultaneous shapes skip that item rather than being repaired.
  Coordinate values are finite normalized numbers in `[0, 1]`, with the
  origin at the top left and positive axes rightward and downward. Boxes have
  positive area. Split boxes crossing the ERP360 seam into two items.
- Coordinates refer to the full decoded source frame, before rotation,
  single-eye selection or projection, never to the viewport. Annotations follow
  the same transforms as the image. For EAC this means native EAC frame
  coordinates, not ERP coordinates.
- Files may contain up to 200,000 annotations and may be at most 20 MB.
  Limits apply to the input, including invalid rows. Malformed JSON, an invalid
  root object/version/annotations array, an invalid root FPS, or exceeded limits
  leave the current annotations unchanged. The player cannot verify
  that an arbitrary file belongs to the currently opened video.
- Invalid individual entries (including timing, geometry, metadata and item FPS)
  are skipped while all valid entries in the same file are loaded. The status
  reports loaded and skipped counts and the first 10 errors, using the original
  one-based entry numbers, not text line numbers. The active/total counter counts
  only valid entries. Skipped entries are not repaired and the source file is
  never modified. If every entry in a nonempty file is invalid, the previous
  annotations and filters are preserved instead. A valid empty array can still
  replace the current file. Clean imports and Remove annotations clear warnings.

Colors, captions and line widths are player settings, not annotation fields.
The parser normalizes timing to `start/end`, copies recognized display fields
and retains extra per-annotation fields for optional caption display. Extra
root-level metadata is ignored. This does not add native AVA CSV, DCASE CSV or
pickle import; those need conversion to this JSON and its normalized coordinates. A JSON
Schema is provided in [annotation.schema.json](annotation.schema.json). The schema
and conversion tool remain strict; skipping invalid entries is a player import
recovery behavior, not a relaxation of the format.

## Export Conversion

```sh
node tools/merge-annotations.cjs \
  /path/to/annotation-export \
  output/annotations/annotations.json \
  /path/to/source-video.mp4
```

The converter reads `av_annotation.json`, `record.jsonl` and the four structured
JSON files in `audio/`. It does not run models or decode NPZ prediction tensors.
Available NPZ files in `audio_raw/` are checksum-checked against the structured
results. The optional source video must match the recorded SHA256.

Visual object and emitter boxes become separate bbox annotations. The object
box retains the event label; the emitter label adds ` / <emitter_part>`.
Null geometry is not invented. Each sample holds for at most
`1 / location_fps` seconds, clipped to the next sample and event end.

Audio candidate intervals are preserved, including the static window-length
SO-7B QA answers. XYZ directions use X front, Y left, Z up. On ERP video:

```text
azimuth = atan2(Y, X)
elevation = atan2(Z, hypot(X, Y))
u = 0.5 - azimuth / horizontal_fov_radians
v = 0.5 - elevation / pi
```

The horizontal FOV is read from source metadata, not guessed from the filename.
Rear-hemisphere directions cannot be encoded in an ERP180 source frame; they
are excluded from the display file and listed individually in the companion
`.report.json`, rather than projected onto the front hemisphere.

PSELD and SO-Encoder labels are unified only through an explicit small alias
table, for example `Speech -> speech` and `Walk, footsteps -> footsteps`.
Different method predictions remain independent; no object identity,
cross-method confidence or event association is inferred. Physical IV,
TF peaks and MUSIC results use `sound direction` because they do not predict
a semantic class. Structural validation and a matching source checksum do not
establish event, association or localization accuracy.
