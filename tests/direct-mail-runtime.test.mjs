import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../report-validation-v058.js', import.meta.url), 'utf8');
function harness({ blocked = false } = {}) {
  const nodes = new Map();
  const clicks = [], timers = [], windowListeners = new Map(), documentListeners = [];
  let cleared = 0, reloads = 0;
  const node = (id = '') => ({ id, value: '', textContent: '', innerText: '', dataset: {}, style: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, querySelector() { return null; }, replaceChildren() { this.textContent = ''; this.innerText = ''; },
    append(child) { if (child.id) nodes.set(child.id, child); },
    addEventListener(type, handler) { this[type] = handler; }, remove() {},
    click() { if (this.href) { clicks.push(this.href); if (blocked) throw new Error('External protocol blocked'); } },
  });
  for (const id of ['caseText', 'reportEditor', 'analyzeCase', 'workflowActions', 'sessionMessage']) nodes.set(id, node(id));
  nodes.get('caseText').value = 'SYNTHETIC TRANSCRIPT';
  nodes.get('reportEditor').innerText = 'SYNTHETIC REPORT';
  const window = {
    location: { pathname: '/', search: '', replace() { reloads++; }, reload() { reloads++; } },
    addEventListener(type, handler) { windowListeners.set(type, [...(windowListeners.get(type) || []), handler]); },
    dispatchEvent(event) { for (const handler of windowListeners.get(event.type) || []) handler(event); if (event.type === 'clinical-session-cleared') cleared++; },
  };
  const document = {
    body: node(), getElementById: id => nodes.get(id) || null,
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === 'textarea' ? [nodes.get('caseText')] : []; },
    createElement() { return node(); },
    addEventListener(type, handler) { if (type === 'click') documentListeners.push(handler); },
  };
  vm.runInNewContext(script, { window, document, CustomEvent: class { constructor(type) { this.type = type; } }, setTimeout(fn) { timers.push(fn); } });
  return { window, nodes, clicks, timers, cleared: () => cleared, reloads: () => reloads,
    retry() { for (const handler of documentListeners) handler({ preventDefault() {}, stopImmediatePropagation() {}, target: { closest: selector => selector === '#analyzeCase[data-direct-mail-ready="true"]' ? nodes.get('analyzeCase') : null } }); },
  };
}
test('direct route prepares the agreed recipient, clears transcript and keeps a usable retry without reloading', () => {
  const h = harness();
  assert.equal(h.cleared(), 0, 'initial validation reset must not erase the interview');
  assert.equal(h.window.sendClinicalReportDirect('SYNTHETIC REPORT'), true);
  assert.equal(h.nodes.get('caseText').value, '');
  assert.equal(h.nodes.get('reportEditor').innerText, '');
  assert.equal(h.cleared(), 1);
  assert.equal(h.timers.length, 0, 'must not schedule the destructive 900ms reload');
  const mail = new URL(h.clicks[0]);
  assert.equal(mail.pathname, 'joseluis.matesanz@salud-juntaex.es');
  assert.equal(mail.searchParams.get('body'), 'Informe clínico validado\n\nSYNTHETIC REPORT');
  h.retry();
  assert.equal(h.clicks.length, 2);
  assert.equal(h.clicks[0], h.clicks[1]);
  assert.equal(h.reloads(), 0);
});
test('a blocked automatic opening preserves the completed report and offers a new interview', () => {
  const h = harness({ blocked: true });
  assert.equal(h.window.sendClinicalReportDirect('SYNTHETIC REPORT'), true);
  assert.match(h.nodes.get('sessionMessage').textContent, /reintentarlo/);
  assert.equal(h.nodes.get('analyzeCase').dataset.directMailReady, 'true');
  assert.equal(h.nodes.get('caseText').value, '');
  h.nodes.get('newInterviewAfterMail').click();
  assert.equal(h.reloads(), 1);
});
test('an empty result does not erase the interview or attempt mail', () => {
  const h = harness();
  assert.equal(h.window.sendClinicalReportDirect(''), false);
  assert.equal(h.cleared(), 0);
  assert.equal(h.clicks.length, 0);
});
