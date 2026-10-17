import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

/**
 * These tests execute the shipped inline script and interact through its event
 * handlers. The small DOM double covers state/race regressions without a browser
 * dependency. Real-browser checks are still required for layout, focus, and print.
 */
function createPage(t) {
  const nodes = [];
  const byId = new Map();
  const timers = new Set();
  let document;

  class Element {
    constructor(attrs = {}) {
      this.attrs = { ...attrs };
      this.id = attrs.id;
      this.value = '';
      this.textContent = '';
      this.hidden = 'hidden' in attrs;
      this.disabled = 'disabled' in attrs;
      this.checked = false;
      this.isConnected = true;
      this.children = [];
      this.events = new Map();
      this.dataset = Object.fromEntries(Object.entries(attrs)
        .filter(([name]) => name.startsWith('data-'))
        .map(([name, value]) => [name.slice(5), value]));
      const classes = new Set((attrs.class || '').split(/\s+/));
      this.classList = {
        contains: name => classes.has(name),
        toggle(name, force = !classes.has(name)) {
          if (force) classes.add(name); else classes.delete(name);
          return force;
        },
      };
    }
    addEventListener(name, handler) {
      const listeners = this.events.get(name) || [];
      listeners.push(handler);
      this.events.set(name, listeners);
    }
    async emit(name, event = {}) {
      const listeners = this.events.get(name) || [];
      assert.ok(listeners.length, `Expected a ${name} handler for ${this.id}`);
      await Promise.all(listeners.map(handler => handler({ target: this, ...event })));
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    removeAttribute(name) { delete this.attrs[name]; }
    focus() { document.activeElement = this; }
    closest() { return null; }
    scrollIntoView() {}
    select() {}
    showModal() {}
    close() {}
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    click() {}
    remove() {}
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100 }; }
  }

  // Only the DOM features used by the application state handlers are modeled.
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g)) {
    const attrs = {};
    for (const attr of match[2].matchAll(/([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g)) {
      attrs[attr[1]] = attr[2] ?? attr[3] ?? '';
    }
    const node = new Element(attrs);
    node.tagName = match[1];
    nodes.push(node);
    if (node.id) byId.set(node.id, node);
  }
  function queryAll(selector) {
    if (selector === 'dialog') return nodes.filter(node => node.tagName === 'dialog');
    if (selector.startsWith('.')) return nodes.filter(node => node.classList.contains(selector.slice(1)));
    const match = /^\[([^=\]]+)(?:="([^"]+)")?\]$/.exec(selector);
    assert.ok(match, `Unsupported selector in state-test DOM: ${selector}`);
    return nodes.filter(node => match[2] === undefined ? match[1] in node.attrs : node.attrs[match[1]] === match[2]);
  }
  document = {
    body: nodes.find(node => node.tagName === 'body'),
    activeElement: byId.get('demo-btn'),
    getElementById: id => byId.get(id),
    querySelectorAll: queryAll,
    querySelector: selector => queryAll(selector)[0],
    createElement: () => new Element(),
    addEventListener() {},
  };
  byId.get('ai-status').lastElementChild = new Element();

  const pending = [];
  let responseBody = null;
  const response = body => ({ ok: true, json: async () => structuredClone(body) });
  const context = vm.createContext({
    document,
    window: { addEventListener() {}, print() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async (path, options) => {
      if (path === '/api/config') return response({ aiEnabled: false });
      if (responseBody !== null) return response(responseBody);
      // Deliberately ignore AbortSignal so a response can arrive after cancel.
      return new Promise(resolve => pending.push({ path, options, resolve: body => resolve(response(body)) }));
    },
    AbortController, URL, Blob, TypeError, Error, Date, JSON,
    setTimeout(callback, delay) {
      const timer = setTimeout(callback, delay);
      timer.unref(); timers.add(timer); return timer;
    },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
  });
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(script, 'The application must contain its executable inline script');
  vm.runInContext(script, context, { filename: 'index.html:inline-script' });

  return {
    element(id) {
      const node = byId.get(id);
      assert.ok(node, `Expected application element ${id}`);
      return node;
    },
    respondWith(body) { responseBody = body; },
    deferResponses() { responseBody = null; },
    nextRequest() {
      const request = pending.shift();
      assert.ok(request, 'Expected an in-flight request');
      return request;
    },
    get busy() { return document.body.classList.contains('busy'); },
    get inert() { return document.querySelector('.shell').inert; },
  };
}

function demoResult(overrides = {}) {
  return {
    reportText: 'FICTIONAL REPORT\nGene: LYST\nClinVar accession: VCV000065533',
    report: {
      gene: 'LYST', accession: '65533', variant: 'c.1540C>T',
      classification: 'Uncertain significance', reportDate: '2020-06-15',
      lab: 'Fictional laboratory', isFictional: true, evidenceQuotes: [],
    },
    current: {
      accession: 'VCV000065533.11', classification: 'Pathogenic',
      sourceUrl: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/65533/',
    },
    comparison: { questions: ['Request review'], needsReview: true },
    letter: 'Generated follow-up draft',
    mode: 'snapshot', retrievedAt: '2026-10-17',
    ...overrides,
  };
}

async function openDemo(page) {
  page.respondWith(demoResult());
  await page.element('demo-btn').emit('click');
  assert.equal(page.element('step-2').hidden, false);
}

test('editing a report clears old extracted fields, confirmation, and derived results', async t => {
  const page = createPage(t);
  await openDemo(page);
  assert.equal(page.element('accession').value, '65533');
  await page.element('tab-1').emit('click');
  page.element('report-text').value = 'A different report excerpt';
  await page.element('report-text').emit('input');

  for (const field of ['gene', 'reportDate', 'variant', 'classification', 'accession', 'lab']) {
    assert.equal(page.element(field).value, '', `${field} must not survive a new report`);
  }
  assert.equal(page.element('confirm-fields').checked, false);
  assert.equal(page.element('compare-btn').disabled, true);
  assert.equal(page.element('tab-2').disabled, true);
  assert.equal(page.element('tab-3').disabled, true);
  assert.equal(page.element('letter-text').value, '');
});

test('a cancelled request cannot apply a late response or lock the interface', async t => {
  const page = createPage(t);
  page.element('report-text').value = 'Keep my current report';
  await page.element('report-text').emit('input');
  page.deferResponses();
  const opening = page.element('demo-btn').emit('click');
  const request = page.nextRequest();
  assert.equal(page.busy, true);
  assert.equal(page.inert, true);
  await page.element('cancel-request').emit('click');
  assert.equal(page.busy, false);
  assert.equal(page.inert, false);
  assert.equal(request.options.signal.aborted, true);

  request.resolve(demoResult());
  await opening;
  assert.equal(page.element('report-text').value, 'Keep my current report');
  assert.equal(page.element('accession').value, '');
  assert.equal(page.element('tab-2').disabled, true);
  assert.equal(page.element('step-1').hidden, false);
  assert.equal(page.busy, false);
});

test('refreshing evidence preserves letter edits until the user chooses the updated draft', async t => {
  const page = createPage(t);
  await openDemo(page);
  page.element('letter-text').value = 'My personally edited request';
  page.respondWith(demoResult({ mode: 'live', letter: 'Draft from refreshed evidence' }));
  await page.element('refresh-btn').emit('click');

  assert.match(page.element('source-status-text').textContent, /Live ClinVar/);
  assert.equal(page.element('letter-text').value, 'My personally edited request');
  assert.equal(page.element('draft-notice').hidden, false);
  await page.element('use-updated-draft').emit('click');
  assert.equal(page.element('letter-text').value, 'Draft from refreshed evidence');
  assert.equal(page.element('draft-notice').hidden, true);
});

test('a pending report upload cannot restore discarded data after reset', async t => {
  const page = createPage(t);
  await openDemo(page);
  let finishRead;
  page.element('file-input').files = [{
    name: 'report.txt', size: 40,
    text: () => new Promise(resolve => { finishRead = resolve; }),
  }];
  const upload = page.element('file-input').emit('change');
  assert.equal(typeof finishRead, 'function');
  await page.element('reset-btn').emit('click');
  finishRead('Gene: BRCA1\nClinVar accession: 123');
  await upload;

  assert.equal(page.element('report-text').value, '');
  assert.equal(page.element('gene').value, '');
  assert.equal(page.element('accession').value, '');
  assert.equal(page.element('letter-text').value, '');
  assert.equal(page.element('tab-2').disabled, true);
  assert.equal(page.element('tab-3').disabled, true);
  assert.equal(page.element('step-1').hidden, false);
});
