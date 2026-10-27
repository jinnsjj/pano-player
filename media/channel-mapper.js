import { channelLabels, createRouting, routingPreset } from './channel-routing.js';

const $ = id => document.getElementById(id);
const names = { identity: 'Direct', foa: 'FOA Solo', hl: 'HL Solo', clear: 'Silent', custom: 'Custom' };

export class ChannelMapper {
  constructor(monitor, onChange) {
    this.monitor = monitor; this.onChange = onChange;
    $('mapper-open').addEventListener('click', () => this.show($('mapper-panel').hidden));
    $('mapper-close').addEventListener('click', () => this.show(false));
    $('mapper-panel').addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.show(false); }
    });
    $('mapper-enabled').addEventListener('change', () => this.apply({ ...this.routing, enabled: $('mapper-enabled').checked }));
    $('mapper-preset').addEventListener('change', () => this.apply(createRouting(this.routing.channels, $('mapper-preset').value)));
    $('mapper-reset').addEventListener('click', () => this.apply(createRouting(this.routing.channels)));
    $('mapper-clear').addEventListener('click', () => this.apply(createRouting(this.routing.channels, 'clear')));
    $('mapper-matrix').addEventListener('change', ({ target }) => {
      if (target.type !== 'checkbox') return;
      this.routing.matrix[Number(target.dataset.output)][Number(target.dataset.input)] = Number(target.checked);
      this.apply(this.routing);
    });
    $('mapper-matrix').addEventListener('keydown', event => {
      const { target, key } = event;
      if (target.type !== 'checkbox' || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
      event.preventDefault();
      const last = this.routing.channels - 1;
      const row = Math.max(0, Math.min(last, Number(target.dataset.output) + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0)));
      const column = key === 'Home' ? 0 : key === 'End' ? last : Math.max(0, Math.min(last,
        Number(target.dataset.input) + (key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0)));
      const next = $('mapper-matrix').querySelector(`[data-output="${row}"][data-input="${column}"]`);
      target.tabIndex = -1; next.tabIndex = 0; next.focus();
    });
  }
  show(open) {
    $('mapper-panel').hidden = !open;
    $('mapper-open').setAttribute('aria-expanded', String(open));
    if (open) { this.sync(); $('mapper-enabled').focus({ preventScroll: true }); }
    else $('mapper-open').focus({ preventScroll: true });
  }
  apply(routing) {
    if (this.monitor().setChannelRouting(routing)) this.onChange();
    this.sync();
  }
  sync() {
    const monitor = this.monitor();
    this.routing = monitor.getChannelRouting();
    const { channels, matrix, enabled } = this.routing;
    const available = channels > 0 && !monitor.video.error;
    $('mapper-open').disabled = !available;
    for (const id of ['mapper-enabled', 'mapper-preset', 'mapper-reset', 'mapper-clear']) $(id).disabled = !available;
    $('mapper-enabled').checked = enabled;
    $('mapper-foa').disabled = $('mapper-hl').disabled = channels !== 6;
    const preset = routingPreset(this.routing);
    $('mapper-preset').value = preset;
    $('mapper-summary').textContent = !available ? 'No audio' : enabled ? names[preset] : 'Bypassed';
    $('mapper-format').textContent = `${channels} in / ${channels} out`;
    const summed = matrix.some(row => row.reduce((sum, gain) => sum + gain, 0) > 1);
    $('mapper-warning').hidden = !enabled || !summed;
    const labels = channelLabels(channels);
    const key = labels.join(',');
    if (this.key !== key) {
      this.key = key;
      $('mapper-matrix').innerHTML = `<thead><tr><th scope="col">Output / Input</th>${labels.map(number =>
        `<th scope="col">${number}</th>`).join('')}</tr></thead><tbody>${labels.map((number, output) =>
        `<tr><th scope="row">${number}</th>${labels.map((_, input) => {
          const label = `Input ${input + 1} to output ${output + 1}`;
          return `<td><label title="${label}"><input type="checkbox" data-output="${output}" data-input="${input}" aria-label="${label}" tabindex="${output === 0 && input === 0 ? 0 : -1}"></label></td>`;
        }).join('')}</tr>`).join('')}</tbody>`;
    }
    for (const input of $('mapper-matrix').querySelectorAll('input')) {
      input.checked = Boolean(matrix[Number(input.dataset.output)][Number(input.dataset.input)]);
      input.disabled = !available || !enabled;
    }
  }
}
