# Third-Party Notices

## PowerMap Analyzer

`python/foa_music_powermap.py` is an unchanged copy of the locally installed
`generate-foa-powermap/scripts/foa_music_powermap.py` as of 2026-09-10. Its source
declares `SPDX-License-Identifier: MIT`. That header is preserved. No additional
copyright notice was present in that source file.

The method and default configuration are informed by SPARTA PowerMap. The skill
uses a Hann STFT and inverse-angular-distance interpolation. It is a qualitative
localization view, not a calibrated acoustic measurement. No SPARTA/SAF binary
is bundled. The streaming adapter explicitly clears history during silence.

The JavaScript MUSIC implementation in `src/powermap/` was copied from
`foa-recon-demo/web_player/js`, including its worker/service, capture worklet and colour
renderer. The Python source is retained only as a repository reference and is
excluded from the VSIX. Python, NumPy, SciPy and OpenCV are not required.

## Streaming Codecs

The player bundles a decoder-only LGPL FFmpeg 7.1.5 AAC WebAssembly build through
libav.js. No host FFmpeg installation is required. Its license is in
`media/LICENSE-ffmpeg.txt`; corresponding source archives and rebuild instructions
are distributed in `codec-sources/`.

Mediabunny 1.56.2 (MPL-2.0) supplies incremental MP4, WebM and WAV demuxing and
WebCodecs video integration. Its source archive and license are included.
https://github.com/Vanilagy/mediabunny

`opus-decoder` 0.7.12 and `@wasm-audio-decoders/common` 9.0.7 (MIT) bundle the
libopus multistream decoder (BSD). Their notices are in
`media/LICENSE-opus-decoder.txt` and `media/LICENSE-libopus.txt`.
https://github.com/eshaz/wasm-audio-decoders

Its bundled WASM decompression uses Mark Adler's puff (zlib-style license) and
simple-yenc (MIT). Their notices are in `media/LICENSE-puff.txt` and
`media/LICENSE-simple-yenc.txt`.

## Omnitone

`media/omnitone.min.js` and `media/LICENSE-omnitone.txt` are copied from the
original `foa-recon-demo/web_player/vendor` distribution of Google Omnitone (Apache-2.0),
including its embedded HRIR filters. One CSP compatibility change replaces
the empty `new Function` rejection handler with `function(){}`; no DSP code or
filter data is changed. https://github.com/GoogleChrome/omnitone

## Three.js

The bundled `media/three.module.js` and `media/three.core.min.js` are reused from
the original foa-recon-demo web player. Three.js is MIT licensed; see `media/LICENSE-three.txt`.

## Lucide

`media/lucide.min.js` is a tree-shaken build of Lucide 1.45.0 containing only the
player controls. Its ISC license and the MIT notice for Feather-derived icons
are included in `media/LICENSE-lucide.txt`.
