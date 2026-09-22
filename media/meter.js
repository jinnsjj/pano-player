import { FloatingOverlay } from './floating-overlay.js';
const $ = id => document.getElementById(id);
const scale = value => Number.isFinite(value) ? Math.pow(Math.max(0, Math.min(1, (value + 72) / 72)), 1.8) * 100 : 0;
const format = value => value == null ? '--' : Number.isFinite(value) ? value.toFixed(1) : '-inf';

export class MeterOverlay extends FloatingOverlay {
  constructor(monitor, onChange) {
    super('meter', onChange);
    this.monitor = monitor; this.lastFrame = -Infinity;
    for (const tick of this.panel.querySelectorAll('[data-db]')) tick.style.bottom = scale(Number(tick.dataset.db)) + '%';
    $('meter-reset').addEventListener('click', () => monitor.resetMeter());
    const button = $('meter-help-button'), help = $('meter-help');
    this.hideHelp = () => help.hidePopover();
    help.addEventListener('toggle', () => {
      if (!help.matches(':popover-open')) return;
      if (this.panel.hidden) { this.hideHelp(); return; }
      const anchor = button.getBoundingClientRect(), bounds = help.getBoundingClientRect();
      const top = anchor.bottom + bounds.height + 12 <= window.innerHeight ? anchor.bottom + 4 : anchor.top - bounds.height - 4;
      help.style.left = Math.max(8, Math.min(window.innerWidth - bounds.width - 8, anchor.right - bounds.width)) + 'px';
      help.style.top = Math.max(8, Math.min(window.innerHeight - bounds.height - 8, top)) + 'px';
    });
    this.panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && help.matches(':popover-open')) {
        this.hideHelp(); event.preventDefault(); event.stopPropagation();
      }
    }, true);
    $('meter-titlebar').addEventListener('pointerdown', event => {
      if (!button.contains(event.target)) this.hideHelp();
    });
    window.addEventListener('resize', this.hideHelp);
  }
  setEnabled(enabled) {
    super.setEnabled(enabled);
    if (this.panel.hidden) this.hideHelp();
    this.monitor.setMeterEnabled(this.enabled && this.available);
  }
  render(now) {
    if (this.panel.hidden || now - this.lastFrame < 50) return;
    this.lastFrame = now;
    const { data, active, status } = this.monitor.getMeterState();
    $('meter-status').textContent = status === 'unavailable' ? 'Meters unavailable' : !data ? 'Initializing' :
      `${active ? 'Measuring' : 'Paused'} · ${data.duration.toFixed(1)} s`;
    const draw = (id, value, maximum, unit, clips) => {
      const track = $(id);
      track.style.setProperty('--level', scale(value) + '%');
      track.style.setProperty('--peak', scale(maximum) + '%');
      track.dataset.clipping = String(clips > 0);
      track.setAttribute('aria-valuenow', String(Number.isFinite(value) ? Math.max(-72, Math.min(0, value)) : -72));
      const description = `${format(value)} ${unit}${maximum != null ? ', maximum ' + format(maximum) + ' ' + unit : ''}${clips !== undefined ? ', ' + clips + ' clipped samples' : ''}`;
      track.setAttribute('aria-valuetext', description);
      track.title = $(id + '-value').title = description;
      $(id + '-hold').hidden = !Number.isFinite(maximum) || maximum < -72;
      $(id + '-value').textContent = format(value);
      $(id + '-max').textContent = maximum == null ? '' : format(maximum);
      if (clips !== undefined) $(id + '-clips').textContent = clips > 999 ? '>999' : String(clips);
    };
    for (let ch = 0; ch < 2; ch++) {
      const level = data?.channels[ch];
      draw('meter-peak-' + ch, active ? level?.peak : -Infinity, level?.heldPeak, 'dBFS', level?.clips || 0);
      draw('meter-true-' + ch, active ? level?.truePeak : -Infinity, level?.heldTruePeak, 'dBTP', level?.trueClips || 0);
    }
    draw('meter-rms-m', data?.rmsMomentary, data?.maxRmsMomentary, 'dBFS');
    draw('meter-rms-i', data?.rmsIntegrated, null, 'dBFS');
    draw('meter-lufs-m', data?.lufsMomentary, data?.maxLufsMomentary, 'LUFS');
    draw('meter-lufs-s', data?.lufsShort, data?.maxLufsShort, 'LUFS');
    draw('meter-lufs-i', data?.lufsIntegrated, null, 'LUFS');
    const range = $('meter-lra');
    range.style.setProperty('--low', scale(data?.lraLow) + '%');
    range.style.setProperty('--high', scale(data?.lraHigh) + '%');
    range.setAttribute('aria-valuenow', String(data?.lra ?? 0));
    const description = `${format(data?.lra)} LU, ${format(data?.lraLow)} to ${format(data?.lraHigh)} LUFS`;
    range.setAttribute('aria-valuetext', description);
    range.title = $('meter-lra-value').title = description;
    $('meter-lra-value').textContent = format(data?.lra);
    $('meter-lra-max').textContent = format(data?.lraHigh);
  }
}
