# Annotation Overlay v1

Annotation is an open-source, bundled PanoPlayer plugin. Its implementation lives
in `plugins/annotations/` and uses the same plugin API as optional extensions.
It is included and enabled by default in both VS Code and the standalone web
player; no separate installation is required.

Open a video, expand **Overlay > Annotation**, then choose **Open annotation JSON**.
Collapsing the module hides its controls without hiding the canvas annotations.
The expandable **JSON format** reference includes valid bbox/point examples,
required fields, interval semantics, source-frame coordinates and file limits.
In the web player, **Plugins** can disable or re-enable the bundled module.
Files are read
locally in the browser or webview; no upload is performed. Each media session
owns one annotation file. Opening another media file clears its annotations.
The Annotation checkbox in the Overlay row controls visibility independently of
the settings arrow. It becomes available after importing a valid file; hiding
annotations preserves that file and its filters. Labels controls captions; source checkboxes filter
methods independently. The same geometry appears in Panorama, Perspective and
PanoView, above the PowerMap and direction grid.

## Format

```json
{
  "version": 1,
  "annotations": [
    {
      "start": 0,
      "end": 0.2,
      "label": "person",
      "source": "visual-model",
      "bbox": [0.1, 0.2, 0.4, 0.8]
    },
    {
      "start": 0,
      "end": 0.1,
      "point": [0.3, 0.4]
    },
    {
      "start": 0,
      "end": 0.3
    }
  ]
}
```

- `start` and `end` are finite video seconds, with `0 <= start < end`.
- Visibility is half-open: `start <= currentTime < end`. Geometry is held
  constant inside its interval, without interpolation or extension across gaps.
- `label` and `source` are optional. The former describes the object, part or
  position; the latter identifies the annotator or method, not the physical
  sound source. Omitted, null or whitespace-only values are treated as absent;
  provided strings may contain at most 2,000 characters. Only provided text is
  displayed: a label without a source has no source suffix; a source without a
  label can display its source. When neither is provided, no caption or
  placeholder is drawn.
- An item may provide one shape: `bbox: [left, top, right, bottom]` or
  `point: [x, y]`. If both are omitted or null, that item is not drawn and does
  not create a source filter, but remains part of the total imported count.
  Items without a source are not assigned a synthetic source group and are not
  hidden by named-source filters. Non-null shapes are still validated; invalid
  shapes or two simultaneous shapes reject the import rather than being repaired.
  Coordinate values are finite normalized numbers in `[0, 1]`, with the
  origin at the top left and positive axes rightward and downward. Boxes have
  positive area. Split boxes crossing the ERP360 seam into two items.
- Coordinates refer to the full decoded source frame, before rotation,
  single-eye selection or projection, never to the viewport. Annotations follow
  the same transforms as the image. For EAC this means native EAC frame
  coordinates, not ERP coordinates.
- Files may contain up to 200,000 annotations and may be at most 20 MB.
  Invalid imports leave the current file unchanged. The player cannot verify
  that an arbitrary file belongs to the currently opened video.

Colors, captions and line widths are player settings, not annotation fields.
The parser copies recognized fields and ignores unrelated metadata. A JSON
Schema is provided in [annotation.schema.json](annotation.schema.json).

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
