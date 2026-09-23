import { CustomAudioDecoder, AudioSample, registerDecoder } from 'mediabunny';
import { OpusDecoder } from 'opus-decoder';

let webmOpus = false;
let firstSequence = -1;
export function setWebmOpusTiming(value, sequence = -1) { webmOpus = value; firstSequence = sequence; }

async function openAacDecoder(config) {
  const description = config.description;
  if (!description?.byteLength) throw new Error('Missing audio codec header.');
  const bytes = description instanceof ArrayBuffer ? new Uint8Array(description) :
    new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
  const libav = await globalThis.LibAV.LibAV({ noworker: true, ...globalThis.foaLibavOptions });
  let decoder;
  try {
    decoder = await libav.ff_init_decoder('aac', {
      codecpar: { extradata: bytes, sample_rate: config.sampleRate, channels: config.numberOfChannels },
      time_base: [1, config.sampleRate],
    });
    // AAC PCE can override the channel count advertised by the MP4 sample entry.
    const channels = await libav.AVCodecContext_channels(decoder[1]);
    if (!Number.isInteger(channels) || channels <= 0) throw new Error('Invalid AAC channel count.');
    return { libav, decoder, channels };
  } catch (error) {
    try { if (decoder) await libav.ff_free_decoder(...decoder.slice(1)); }
    finally { libav.terminate(); }
    throw error;
  }
}

export async function getAacChannelCount(config) {
  const { libav, decoder, channels } = await openAacDecoder(config);
  try { return channels; }
  finally {
    try { await libav.ff_free_decoder(...decoder.slice(1)); }
    finally { libav.terminate(); }
  }
}

export class FoaAudioDecoder extends CustomAudioDecoder {
  static supports(codec, config) {
    return Number.isInteger(config.numberOfChannels) && config.numberOfChannels > 0 && ['aac', 'opus'].includes(codec);
  }
  async init() {
    this.numberOfChannels = this.config.numberOfChannels;
    const description = this.config.description;
    if (!description?.byteLength) throw new Error('Missing audio codec header.');
    const bytes = description instanceof ArrayBuffer ? new Uint8Array(description) :
      new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
    if (this.codec === 'aac') {
      const initialized = await openAacDecoder(this.config);
      this.libav = initialized.libav; this.decoder = initialized.decoder;
      this.numberOfChannels = initialized.channels;
    } else {
      const channels = this.config.numberOfChannels;
      if (bytes.length < 19 || String.fromCharCode(...bytes.subarray(0, 8)) !== 'OpusHead' || bytes[9] !== channels) {
        throw new Error('Invalid Opus header or channel count.');
      }
      const family = bytes[18];
      if (![0, 1, 2, 255].includes(family)) throw new Error('Unsupported Opus channel mapping family.');
      if ((family === 0 && channels > 2) || (family !== 0 && (bytes.length < 21 + channels ||
          !bytes[19] || bytes[20] > bytes[19] || bytes[19] + bytes[20] > 255 ||
          [...bytes.subarray(21, 21 + channels)].some(index => index !== 255 && index >= bytes[19] + bytes[20])))) {
        throw new Error('Invalid Opus channel mapping.');
      }
      this.decoder = new OpusDecoder({ channels, sampleRate: 48000, preSkip: 0,
        streamCount: family === 0 ? 1 : bytes[19], coupledStreamCount: family === 0 ? channels - 1 : bytes[20],
        channelMappingTable: family === 0 ? Array.from({ length: channels }, (_, i) => i) : [...bytes.subarray(21, 21 + channels)] });
      this.gain = 10 ** (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(16, true) / (256 * 20));
      // Mediabunny 1.56 does not subtract WebM CodecDelay; OpusHead carries the encoder preskip.
      this.delay = webmOpus ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(10, true) / 48000 : 0;
      await this.decoder.ready;
    }
  }
  async decode(packet) {
    let channels; let rate = this.config.sampleRate;
    if (this.codec === 'aac') {
      const pts = Math.round(packet.timestamp * rate);
      const [, context, pkt, frame] = this.decoder;
      const frames = await this.libav.ff_decode_multi(context, pkt, frame, [{ data: packet.data,
        pts: pts >>> 0, ptshi: Math.floor(pts / 4294967296), time_base_num: 1, time_base_den: rate }]);
      for (const decoded of frames) {
        const time = ((decoded.ptshi || 0) * 4294967296 + (decoded.pts >>> 0)) / rate;
        this.output(decoded.data, decoded.sample_rate, time);
      }
      return;
    } else {
      const decoded = this.decoder.decodeFrame(packet.data);
      if (decoded.errors.length) throw new Error(decoded.errors.map(error => error.message).join('; '));
      channels = decoded.channelData; rate = decoded.sampleRate;
      if (this.firstPacket === undefined) {
        this.firstPacket = packet.timestamp;
        this.skipRemaining = webmOpus && packet.sequenceNumber === firstSequence ? Math.round(this.delay * rate) : 0;
      }
      const skip = Math.min(this.skipRemaining, decoded.samplesDecoded);
      this.skipRemaining -= skip;
      channels = channels.map(channel => channel.subarray(skip));
      this.packetSkip = skip / rate;
      if (this.gain !== 1) for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i] *= this.gain;
    }
    if (channels[0].length) this.output(channels, rate, packet.timestamp - this.delay + this.packetSkip);
  }
  output(channels, rate, timestamp) {
    if (channels.length !== this.numberOfChannels || channels.some(channel => !(channel instanceof Float32Array)
        || channel.length !== channels[0].length)) throw new Error(
      `Audio decoder did not preserve the source PCM channels (expected ${this.numberOfChannels}, received ${channels.length}).`);
    const data = new Float32Array(channels[0].length * channels.length);
    channels.forEach((channel, i) => data.set(channel, i * channel.length));
    this.onSample(new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels.length,
      sampleRate: rate, timestamp }));
  }
  async flush() {
    if (!this.libav) return;
    const [, context, pkt, frame] = this.decoder;
    const frames = await this.libav.ff_decode_multi(context, pkt, frame, [], true);
    for (const decoded of frames) this.output(decoded.data, decoded.sample_rate,
      ((decoded.ptshi || 0) * 4294967296 + (decoded.pts >>> 0)) / this.config.sampleRate);
  }
  async close() {
    if (this.libav && this.decoder) await this.libav.ff_free_decoder(...this.decoder.slice(1));
    this.decoder?.free?.(); this.libav?.terminate(); this.decoder = undefined;
  }
}
registerDecoder(FoaAudioDecoder);
