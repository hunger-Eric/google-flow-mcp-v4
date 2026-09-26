import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const toolsUrl = new URL('../src/tools.ts', import.meta.url);

test('flow_click dispatches exactly one click to the target element', async () => {
  const source = await readFile(toolsUrl, 'utf8');
  const branch = source
    .slice(source.indexOf("case 'flow_click':"), source.indexOf("case 'flow_type':"))
    .replace(/\/\/.*$/gm, '');
  assert.equal((branch.match(/\.click\(/g) ?? []).length, 1);
  assert.doesNotMatch(branch, /\.click\?\.\(/);
});

test('flow_click uses focused Space exactly once for an Instrumental switch without depending on pointer hit testing', async () => {
  const [{ handleTool }, { browser }] = await Promise.all([
    import('../dist/tools.js'),
    import('../dist/browser.js'),
  ]);
  const originalGetPage = browser.getPage;
  const originalDocument = globalThis.document;
  const calls = [];
  const ancestor = { contains() { return true; } };
  const domElement = {
      innerText: '', textContent: '',
      getAttribute(name) { return name === 'role' ? 'switch' : name === 'aria-label' ? 'Toggle instrumental mode' : null; },
      hasAttribute() { return false; },
      scrollIntoView() {},
      getBoundingClientRect() { return { left: 10, top: 10, width: 20, height: 20 }; },
  };
  const element = {
    async evaluate(callback) { return callback(domElement); },
    async focus() { calls.push('focus'); globalThis.document.activeElement = domElement; },
    async press(key) { calls.push(`press:${key}`); },
    async click() { calls.push('click'); },
  };
  const page = {
    async $(selector) { return selector === '[data-flow-ref="el_instrumental"]' ? element : null; },
    async evaluate(callback) { return callback(); },
    url() { return 'https://www.flowmusic.app/session'; },
  };
  globalThis.document = { body: { innerText: 'Flow Music Ask Producer' }, elementFromPoint() { return ancestor; } };
  browser.getPage = async () => page;
  try {
    const result = await handleTool('flow_click', { ref: 'el_instrumental' });
    assert.equal(result.content[0].text.includes('keyboard_space'), true);
    assert.deepEqual(calls, ['focus', 'press:Space']);
  } finally {
    browser.getPage = originalGetPage;
    globalThis.document = originalDocument;
  }
});

test('Music form discovery accepts the Chinese sound-description label and both official host forms', async () => {
  const source = await readFile(toolsUrl, 'utf8');
  assert.match(source, /sound description\|声音描述/u);
  assert.match(source, /\^\(\?:www\\\.\)\?flowmusic\\\.app\$/u);
});
