import { CustomVideoDecoder, VideoSample, registerDecoder } from 'mediabunny';
import { loadLibav } from './libav-loader.js';

let useWasm = false;
let options;
let generation = 0;
const timeBase = 1000000;
const word = 4294967296;
// AVPixelFormat values in the bundled FFmpeg 7.1.5; preserve Main 10 without downconversion.
const pixelFormats = new Map([[0, 'I420'], [4, 'I422'], [5, 'I444'],
  [12, 'I420'], [13, 'I422'], [14, 'I444'], [62, 'I420P10'], [64, 'I422P10'], [68, 'I444P10']]);

export function cancelHevcDecoding() { generation++; }

export async function prepareVideoDecoder(codec, config, url, load = loadLibav) {
  useWasm = false;
  if (codec !== 'hevc') return 'WebCodecs';
  const native = await globalThis.VideoDecoder?.isConfigSupported(config).catch(() => null);
  if (native?.supported) return 'WebCodecs';
  options = await load(url);
  useWasm = true;
  return 'FFmpeg/WASM';
}

export class HevcVideoDecoder extends CustomVideoDecoder {
  static supports(codec) { return codec === 'hevc' && useWasm; }
  async init() {
    this.generation = generation;
    const { wrapper, ...settings } = options;
    this.libav = await wrapper.LibAV({ noworker: true, ...settings });
    this.durations = new Map();
    const description = this.config.description;
    const extradata = description && (description instanceof ArrayBuffer ? new Uint8Array(description) :
      new Uint8Array(description.buffer, description.byteOffset, description.byteLength));
    try {
      this.decoder = await this.libav.ff_init_decoder('hevc', {
        codecpar: { extradata, width: this.config.codedWidth, height: this.config.codedHeight },
        time_base: [1, timeBase],
      });
    } catch (error) { await this.close(); throw error; }
  }
  async decode(packet) {
    if (this.generation !== generation) return;
    // Let seek/cancel and audio requests run between software-decoded pictures.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (this.generation !== generation) return;
    const pts = Math.round(packet.timestamp * timeBase);
    this.durations.set(pts, packet.duration);
    const [, context, pkt, frame] = this.decoder;
    const frames = await this.libav.ff_decode_multi(context, pkt, frame, [{ data: packet.data,
      pts: pts >>> 0, ptshi: Math.floor(pts / word), flags: packet.type === 'key' ? 1 : 0,
      time_base_num: 1, time_base_den: timeBase }], { copyoutFrame: 'video' });
    if (this.generation === generation) this.output(frames);
  }
  output(frames) {
    for (const frame of frames) {
      const format = pixelFormats.get(frame.format);
      if (!format) throw new Error(`Unsupported HEVC pixel format (${frame.format}).`);
      const pts = (frame.ptshi || 0) * word + (frame.pts >>> 0);
      const timestamp = pts * (frame.time_base_num || 1) / (frame.time_base_den || timeBase);
      const duration = this.durations.get(Math.round(timestamp * timeBase)) ?? 0;
      this.durations.delete(Math.round(timestamp * timeBase));
      const crop = frame.crop ?? {};
      const sample = new VideoSample(frame.data, { format, codedWidth: frame.width, codedHeight: frame.height,
        layout: frame.layout, timestamp, duration,
        visibleRect: { left: crop.left || 0, top: crop.top || 0,
          width: frame.width - (crop.left || 0) - (crop.right || 0),
          height: frame.height - (crop.top || 0) - (crop.bottom || 0) },
        colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709',
          fullRange: [12, 13, 14].includes(frame.format), ...this.config.colorSpace },
      });
      try { this.onSample(sample); } catch (error) { sample.close(); throw error; }
    }
  }
  async flush() {
    if (this.generation !== generation) return;
    const [, context, pkt, frame] = this.decoder;
    const frames = await this.libav.ff_decode_multi(context, pkt, frame, [], { fin: true, copyoutFrame: 'video' });
    if (this.generation === generation) this.output(frames);
    await this.libav.avcodec_flush_buffers(context);
    this.durations.clear();
  }
  async close() {
    try { if (this.decoder) await this.libav.ff_free_decoder(...this.decoder.slice(1)); }
    finally { this.libav?.terminate(); this.decoder = this.libav = undefined; this.durations?.clear(); }
  }
}
registerDecoder(HevcVideoDecoder);
