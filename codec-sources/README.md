# Bundled Codec Sources

The AAC and HEVC binaries are LGPL-2.1-or-later, decoder-only FFmpeg 7.1.5 builds through
libav.js commit `c05a676d16c1068cce6115594858c50a7ecad4b8`. No GPL or nonfree
FFmpeg components are enabled. The original source archives, including libav.js
patches and the emfiberthreads dependency, are kept in the project repository
(`codec-sources/`) and published as assets of the `codec-sources-v1` GitHub
Release. They are not bundled in the VSIX to keep installs small; the player
does not load them at runtime.

| Archive | SHA-256 |
|---|---|
| [ffmpeg-7.1.5.tar.xz](https://github.com/jinnsjj/pano-player/releases/download/codec-sources-v1/ffmpeg-7.1.5.tar.xz) | `de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f` |
| [libav.js.tar.gz](https://github.com/jinnsjj/pano-player/releases/download/codec-sources-v1/libav.js.tar.gz) | `b3a9326145224b032780a7565387a48e1a7457931bbc702d4affdfdecce1b3c4` |
| [emfiberthreads-1.3.tar.gz](https://github.com/jinnsjj/pano-player/releases/download/codec-sources-v1/emfiberthreads-1.3.tar.gz) | `0fe933d7742de3b3213608e0fb087a1ae0d060604d5835f7c9cdfcee0fc8cbcb` |
| [mediabunny-1.56.2.tar.gz](https://github.com/jinnsjj/pano-player/releases/download/codec-sources-v1/mediabunny-1.56.2.tar.gz) | `7db24cf2f17954a66e4108b40f8fc7159ade5afefcc689ab35dd205c367e3ccc` |

The same files are also available from the repository at
https://github.com/jinnsjj/pano-player/tree/main/codec-sources. If neither link
works, open an issue at https://github.com/jinnsjj/pano-player/issues and the
corresponding source will be provided.

To rebuild on a machine with Emscripten 3.1.74, Node.js, make, curl and tar,
download the archives above into this directory, verify them with
`shasum -a 256 -c` against the table, then:

```sh
mkdir libav-build
tar -xzf libav.js.tar.gz -C libav-build
cd libav-build
mkdir -p build
cp ../ffmpeg-7.1.5.tar.xz ../emfiberthreads-1.3.tar.gz build/
npm install --registry=https://registry.npmjs.org
make -j6 FFMPEG_VERSION_MAJOR=7 FFMPEG_VERSION_MINREV=1.5 \
  dist/libav-6.10.7.1.5-decoder-aac.js \
  dist/libav-6.10.7.1.5-decoder-aac.wasm.js

# HEVC uses a separate, optimized SIMD build, loaded only for the software fallback.
make -j6 FFMPEG_VERSION_MAJOR=7 FFMPEG_VERSION_MINREV=1.5 \
  OPTFLAGS='-O3 -msimd128' \
  dist/libav-6.10.7.1.5-decoder-hevc.js \
  dist/libav-6.10.7.1.5-decoder-hevc.wasm.js
```

For each variant, replace the matching three files in `media/` (frontend JS, WASM loader JS and
WASM binary) with the outputs in `dist/`. The extension loads these separately,
so replacement does not require changes to the rest of the player. Running
`node build.cjs` builds the MIT application worker without modifying the codec.

Mediabunny 1.56.2 is MPL-2.0. Its complete original `src/`, license and package
manifest are in `mediabunny-1.56.2.tar.gz` (see the table above). It is used unmodified. The application
adapters live separately in `src/stream-*.js`.

The HEVC adapter is `src/hevc-decoder.js`. It uses libav.js's built-in
`decoder-hevc` configuration without changing the archived sources. HEVC Main
and Main 10 are decoded to planar YUV without transcoding or reducing bit depth.
The single-threaded worker does not require SharedArrayBuffer or cross-origin
isolation. Native WebCodecs stays preferred; WASM software decoding may not
reach real time for high-resolution or high-frame-rate video.
