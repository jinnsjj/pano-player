// Prepare a silent replacement while the current video and audio keep running.
export class AudioSwitcher {
  constructor(video, api, callbacks) {
    this.video = video; this.api = api; this.callbacks = callbacks;
  }
  cancel() { this.pending?.abort(); this.pending = undefined; }
  async select(source, index) {
    this.cancel();
    const abort = this.pending = new AbortController();
    const { signal } = abort;
    const previous = this.callbacks.monitor();
    const element = document.createElement('canvas');
    Object.assign(element.dataset, this.video.dataset, { source: source.url || '' });
    const session = new window.StreamPlayer(element, { ...this.api, file: source.file, audioOnly: true,
      audioTrackIndex: index, time: this.video.ended ? 0 : this.video.currentTime, deferEnvelope: true });
    const next = new window.FoaMonitor(session, () => {}, () => {}, { context: previous.context, preloading: true });
    void session.metadata?.then(() => {
      if (!signal.aborted) this.callbacks.tracks?.(source, session.audioTracks);
    }, () => {});
    next.setMuted(true);
    let committed = false;
    const cleanup = () => { if (!committed) next.dispose({ preserveContext: !!previous.context }); };
    signal.addEventListener('abort', cleanup, { once: true });
    const timeout = setTimeout(() => abort.abort(), 20000);
    try {
      await this.wait(next.prepare(), signal);
      if (session.error) throw session.error;
      if (!session.channels && source.id !== 'primary') throw new Error('This file has no supported audio track.');
      // Decode ahead, then trim in the PCM ring rather than seeking at commit.
      while (true) {
        signal.throwIfAborted();
        if (session.error) throw session.error;
        const time = this.video.ended ? 0 : this.video.currentTime;
        if (time >= session.duration) throw new Error('This audio ends before the current playback position.');
        const margin = Math.min(.06, (session.duration - time) / 2);
        if (!this.video.seeking && (!session.channels ||
          (session.time <= time && session.endFrame / session.sampleRate > time + (session.eof ? 0 : margin)))) break;
        if (!session.seeking && (time < session.time || time > session.endFrame / session.sampleRate)) {
          await this.wait(session.seek(time), signal);
        }
        await this.wait(new Promise(resolve => setTimeout(resolve, 15)), signal);
      }
      signal.throwIfAborted();
      const playing = !this.video.paused;
      const settings = this.callbacks.settings();
      next.setOrder(settings.order); next.setNormalization(settings.normalization);
      next.setMode(settings.listening); next.setPowermap(settings.mapAlgorithm, settings.mapSources);
      next.setEnabled(settings.enabled); next.setVolume(settings.volume);
      next.setChannelRouting(previous.getChannelRouting());
      if (previous.orientation) next.setOrientation(previous.orientation);
      next.setMeterEnabled(previous.meterEnabled);
      // The decoder header has already established FOA/FOA+HL channel semantics.
      next.channelCount = session.channels; next.ready = true;
      next.preloading = false;
      const time = this.video.ended ? 0 : this.video.currentTime;
      if (session.channels) session.alignAudio(time);
      else session.time = time;
      if (this.video.ended) {
        session.time = Math.min(this.video.currentTime, session.duration); session.ended = true;
      }
      session.paused = !playing;
      previous.setMuted(true, .01);
      previous.onMap = previous.onError = () => {};
      committed = true;
      next.onError = this.callbacks.onError;
      next.onMap = this.callbacks.onMap;
      this.callbacks.commit(next, source);
      this.video.useAudioSession(session);
      next.setMuted(settings.muted, .01);
      // Let the short gain ramp finish before releasing the old route.
      setTimeout(() => previous.dispose({ preserveVideo: previous.video === this.video,
        preserveContext: previous.context === next.context }), 15);
      if (playing) await session.play();
      return true;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cleanup);
      cleanup();
      if (this.pending === abort) this.pending = undefined;
    }
  }
  wait(promise, signal) {
    return new Promise((resolve, reject) => {
      const cancel = () => reject(new DOMException('Audio switch cancelled or timed out.', 'AbortError'));
      if (signal.aborted) { cancel(); return; }
      signal.addEventListener('abort', cancel, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
    });
  }
}
