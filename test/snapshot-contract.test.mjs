import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSnapshot } from '../dist/snapshot.js';

test('snapshot retries when navigation destroys the DOM execution context', async () => {
  let evaluateCalls = 0;
  const page = {
    url() { return 'https://flow.google.com/project/project-1'; },
    async title() { return 'Google Flow'; },
    async evaluate() {
      evaluateCalls += 1;
      if (evaluateCalls === 1) {
        throw new Error('Execution context was destroyed, most likely because of a navigation.');
      }
      return { interactables: [], media: [] };
    },
  };

  const result = await captureSnapshot(page, []);

  assert.equal(evaluateCalls, 2);
  assert.equal(result.url, 'https://flow.google.com/project/project-1');
  assert.equal(result.title, 'Google Flow');
  assert.deepEqual(result.summary, { inputs: 0, buttons: 0, media: 0, total: 0 });
});

test('snapshot does not hide non-navigation failures', async () => {
  const page = {
    url() { return 'https://flow.google.com/project/project-1'; },
    async title() { return 'Google Flow'; },
    async evaluate() { throw new Error('Target closed'); },
  };

  await assert.rejects(() => captureSnapshot(page, []), /Target closed/);
});

test('snapshot identifies an empty visible contenteditable composer', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousCss = globalThis.CSS;
  const attributes = new Map([['contenteditable', 'true']]);
  const composer = {
    id: '',
    tagName: 'DIV',
    innerText: '',
    textContent: '',
    getBoundingClientRect() { return { width: 560, height: 20 }; },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
    hasAttribute(name) { return attributes.has(name); },
  };
  globalThis.window = { getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; } };
  globalThis.CSS = { escape(value) { return value; } };
  globalThis.document = {
    querySelectorAll(selector) {
      return selector === 'img' || selector === 'video' ? [] : [composer];
    },
  };
  const page = {
    url() { return 'https://flow.google.com/project/project-1'; },
    async title() { return 'Google Flow'; },
    async evaluate(callback) { return callback(); },
  };

  try {
    const result = await captureSnapshot(page, []);
    assert.equal(result.interactables[0].contentEditable, true);
    assert.equal(result.summary.inputs, 1);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.CSS = previousCss;
  }
});

test('snapshot exposes the pressed state of an instrumental toggle', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousCss = globalThis.CSS;
  const attributes = new Map([['aria-label', 'Toggle instrumental mode'], ['aria-pressed', 'true']]);
  const toggle = {
    id: '', tagName: 'BUTTON', innerText: '', textContent: '',
    getBoundingClientRect() { return { width: 48, height: 32 }; },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
    hasAttribute(name) { return attributes.has(name); },
  };
  globalThis.window = { getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; } };
  globalThis.CSS = { escape(value) { return value; } };
  globalThis.document = { querySelectorAll(selector) { return selector === 'img' || selector === 'video' ? [] : [toggle]; } };
  const page = { url() { return 'https://www.flowmusic.app/session?t=true'; }, async title() { return 'Flow Music'; }, async evaluate(callback) { return callback(); } };
  try {
    const result = await captureSnapshot(page, []);
    assert.equal(result.interactables[0].pressed, true);
  } finally {
    globalThis.document = previousDocument; globalThis.window = previousWindow; globalThis.CSS = previousCss;
  }
});
