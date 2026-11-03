# Plugins

PanoPlayer includes the open-source Annotation plugin, enabled by default in
VS Code and the web player. Expand **Overlay > Annotation** to open a local
annotation file; see [the data contract](ANNOTATIONS.md).
The player also provides a generic versioned interface for additional trusted
modules. A plugin can add settings
and a canvas layer without importing player internals or changing the player.

Bundled implementations live in `plugins/`, registered through `plugins/catalog.cjs`.
The build emits separate ESM and CSS assets, not annotation code inside the
playback core. Both distribution targets use the same catalog and plugin API.
Bundled IDs take precedence over old separately installed copies.

## Installation

### VS Code

Annotation requires only the main PanoPlayer extension. For additional plugins,
install a compatible companion `.vsix` through **Extensions > Install from
VSIX**, then reopen the media editor. Companion extensions and PanoPlayer must
run in the same extension host; for Remote SSH, install both on the remote host.
Disabling or uninstalling a companion requires reopening its media editors or
reloading the window. Nothing is downloaded by the player itself.

Companions declare `extensionDependencies: ["shijunjie.pano-player"]`, use
`extensionKind: ["workspace"]`, and opt in with
`panoPlayerPlugin: { "apiVersion": 1 }` in their extension manifest. On activation:

```js
const extension = vscode.extensions.getExtension('shijunjie.pano-player');
const api = extension.isActive ? extension.exports : await extension.activate();
if (api.apiVersion !== 1) throw new Error('Update PanoPlayer.');
context.subscriptions.push(api.registerPlugin(context.extension.id, {
  apiVersion: 1,
  script: 'media/plugin.js',
  style: 'media/plugin.css'
}));
```

Only installed opt-in extensions may register. Script and stylesheet resources
must live inside that extension's `media/` directory. The player grants access
only to those asset directories, not arbitrary plugin-supplied filesystem roots.
Activation errors are logged and timed out rather than preventing media opening.

### Standalone Web Player

The bundled Annotation plugin appears in **Plugins** and can be disabled or
re-enabled there. It cannot be uninstalled or replaced by an imported package.
Its enablement is saved separately from its code, so updates use the current
bundled implementation without resetting that preference.

For additional plugins, open **Plugins**, select a local `.panoplugin` file and explicitly confirm that
you trust it. A package is installed only after confirmation. Use its checkbox
to enable or disable it, or the trash button to uninstall it. These changes
apply to the current player without reopening media. Files selected by a plugin
remain session-local unless that trusted plugin explicitly stores them.

Installed packages and enablement are saved in IndexedDB for this browser and
site origin. Refreshing preserves installed plugins, but not selected media or
per-media plugin state. Other open tabs pick up changes after a reload. If
browser storage is unavailable, media playback and bundled plugins still work;
bundled-plugin enablement changes then last only for the current page.
Installing a VSIX does not install its web counterpart, and vice versa.

## Browser Interface v1

The bundled ESM entry exports `activate(api)`, returning an optional
`{ dispose(), getState() }` instance. No imports of private player modules are
part of the contract. The API exposes:

| Interface | Contract |
| --- | --- |
| `api.apiVersion` | Currently `1`; reject unsupported versions. |
| `api.getState()` | Snapshot of time, duration, paused state, source dimensions, projection/layout/rotation, view mode, camera pose/FOV/aspect and display widths. |
| `api.onFrame(fn)` | Receives snapshots on playback/render frames, including while paused. Returns a disposable. Keep work bounded and skip unchanged data. |
| `api.createPanel({title, icon, placement, toggle})` | Returns an owned container. Default `placement: "settings"` adds a settings section; `"overlay"` adds an inline disclosure under Overlay. Optional `toggle` is a plugin-owned checkbox input, placed beside the module label and arrow; its visibility logic remains the plugin's responsibility. Expansion and toggle state are independent. Populate only the returned container. Icons use the player's Lucide registry; default is `layers`. |
| `api.refreshIcons()` | Refreshes declared icons after creating controls. |
| `api.createLayer()` | Returns `{canvas, update({visible}), dispose()}`. At most eight layers per plugin. |

Layer canvas coordinates refer to the complete source image before rotation,
single-eye cropping or projection. Draw into the canvas and call `update()`
only when it changes. The player handles image transforms, source-aligned
Panorama/Perspective rendering, PanoView and GPU cleanup. `sourceDisplayWidth`
in the state snapshot can be used to size canvas text and strokes. Hidden
layers do not require a WebGL context. Layer storage is capped at a 2048x1024
full-sphere output; plugin input canvas size remains the plugin's responsibility.

The host owns panels, subscriptions, styles and layers. Unload, replacement,
media close or activation failure releases these resources. Plugin frame and
activation errors are reported separately from playback. `getState()` on an
instance is optional diagnostics, not persisted state. The interface does not
expose media File objects, audio graph objects, player DOM IDs or camera objects.

## Web Package

Packages are UTF-8 JSON, at most 5 MB:

```json
{
  "format": "panoplayer-plugin",
  "apiVersion": 1,
  "id": "example.custom-layer",
  "name": "Custom Layer",
  "version": "1.0.0",
  "code": "export function activate(api) { return { dispose() {} }; }",
  "css": ""
}
```

`code` is a bundled, self-contained ES module, at most 4 MiB. Optional `css` is
at most 512 KiB. A web package cannot select an entry URL. The host loads module
and stylesheet blobs under the existing Content Security Policy; it does not
enable `unsafe-inline` or `unsafe-eval` for plugins.

## Trust And Distribution

Plugins are trusted code, not security-sandboxed code. They share the player
page and can access media or DOM data outside the cooperative interface. The
install confirmation is a trust decision, not a cryptographic identity check.
Do not install unknown packages or put credentials in distributed plugin code.

Additional private implementations can remain in separate repositories and outside the public
checkout. Do not include private code, examples, data, schemas or source maps in
public source or release artifacts. The bundled Annotation implementation is
public, but selected annotation files and source media are not bundled or uploaded.
The web build cleans its output directory
and copies only `public-assets.cjs`; the extension package uses an allowlist in
`.vscodeignore`. Tests run without any companion extension or private checkout.
