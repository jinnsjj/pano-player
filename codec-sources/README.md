# Bundled Codec Sources

The AAC and HEVC binaries are LGPL-2.1-or-later, decoder-only FFmpeg 7.1.5 builds through
libav.js commit `c05a676d16c1068cce6115594858c50a7ecad4b8`. No GPL or nonfree
FFmpeg components are enabled. The original source archives, including libav.js
patches and the emfiberthreads dependency, are included beside this file.

To rebuild on a machine with Emscripten 3.1.74, Node.js, make, curl and tar:

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
manifest are in `mediabunny-1.56.2.tar.gz`. It is used unmodified. The application
adapters live separately in `src/stream-*.js`.

The HEVC adapter is `src/hevc-decoder.js`. It uses libav.js's built-in
`decoder-hevc` configuration without changing the archived sources. HEVC Main
and Main 10 are decoded to planar YUV without transcoding or reducing bit depth.
The single-threaded worker does not require SharedArrayBuffer or cross-origin
isolation. Native WebCodecs stays preferred; WASM software decoding may not
reach real time for high-resolution or high-frame-rate video.
