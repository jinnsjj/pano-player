const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

const moduleValue = { exports: {} };
vm.runInNewContext(buildSync({ entryPoints: [require.resolve('../media/overlay-controls.js')],
  bundle: true, format: 'cjs', write: false }).outputFiles[0].text,
{ module: moduleValue, exports: moduleValue.exports, AbortController });
const { attachOverlayDisclosure } = moduleValue.exports;

class Element extends EventTarget {
  attributes = new Map();
  setAttribute(key, value) { this.attributes.set(key, value); }
  focus() { this.focused = true; }
  click() { this.dispatchEvent(new Event('click')); }
  escape() {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'key', { value: 'Escape' }); this.dispatchEvent(event);
    return event.defaultPrevented;
  }
}

test('overlay disclosures start closed, expand inline independently and do not use outside-click dismissal', () => {
  const button = new Element(), panel = new Element(), otherButton = new Element(), otherPanel = new Element();
  const dispose = attachOverlayDisclosure(button, panel), disposeOther = attachOverlayDisclosure(otherButton, otherPanel);
  assert.equal(panel.hidden, true); assert.equal(button.attributes.get('aria-expanded'), 'false');
  button.click(); assert.equal(panel.hidden, false); assert.equal(button.attributes.get('aria-expanded'), 'true');
  otherButton.click(); assert.equal(otherPanel.hidden, false); assert.equal(panel.hidden, false);
  panel.click(); assert.equal(panel.hidden, false, 'Changing settings does not collapse their container');
  button.click(); assert.equal(panel.hidden, true); assert.equal(otherPanel.hidden, false);
  dispose(); disposeOther();
});

test('Escape closes only its own disclosure, restores focus, and disposal releases listeners', () => {
  const button = new Element(), panel = new Element();
  const dispose = attachOverlayDisclosure(button, panel);
  assert.equal(panel.escape(), false);
  button.click(); assert.equal(panel.escape(), true);
  assert.equal(panel.hidden, true); assert.equal(button.focused, true);
  button.click(); dispose(); button.click();
  assert.equal(panel.hidden, true); assert.equal(button.attributes.get('aria-expanded'), 'false');
});
