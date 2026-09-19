# Bundled Codec Sources

The AAC binary is an LGPL-2.1-or-later, decoder-only FFmpeg 7.1.5 build through
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
```

Replace the matching three files in `media/` (frontend JS, WASM loader JS and
WASM binary) with the outputs in `dist/`. The extension loads these separately,
so replacement does not require changes to the rest of the player. Running
`node build.cjs` builds the MIT application worker without modifying the codec.

Mediabunny 1.56.2 is MPL-2.0. Its complete original `src/`, license and package
manifest are in `mediabunny-1.56.2.tar.gz`. It is used unmodified. The application
adapters live separately in `src/stream-*.js`.
