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

test('flow_type never falls back to another composer when an explicit ref is stale', async () => {
  const [{ handleTool }, { browser }] = await Promise.all([
    import('../dist/tools.js'),
    import('../dist/browser.js'),
  ]);
  const originalGetPage = browser.getPage;
  const chatDom = { value: '', dispatchEvent() {} };
  const chatElement = {
    async click() {},
    async focus() {},
    async evaluate(callback) { return callback(chatDom); },
  };
  const page = {
    async $(selector) {
      if (selector === '[data-flow-ref="el_music_prompt"]') return null;
      if (selector === 'textarea') return chatElement;
      return null;
    },
    keyboard: {
      async down() {},
      async press() {},
      async up() {},
      async type(text) { chatDom.value = text; },
    },
  };
  browser.getPage = async () => page;
  try {
    await assert.rejects(
      handleTool('flow_type', { ref: 'el_music_prompt', text: 'Frozen music prompt', clearFirst: true }),
      /Explicit flow_type ref not found: el_music_prompt/u,
    );
    assert.equal(chatDom.value, '');
  } finally {
    browser.getPage = originalGetPage;
  }
});

function musicControl({ value = '', aria = '', placeholder = '', text = '', checked = false } = {}) {
  return {
    value,
    innerText: text,
    textContent: text,
    checked,
    getAttribute(name) {
      return name === 'aria-label' ? aria : name === 'placeholder' ? placeholder : name === 'data-state' ? null : null;
    },
    closest() { return null; },
    getBoundingClientRect() { return { width: 300, height: 40 }; },
  };
}

function createMusicSubmissionPage({ central = '  Central   prompt  ', sound = 'Wrong side prompt', instrumental = true, sendElement, submitRef = 'el_send' }) {
  const centralControl = musicControl({ value: central, aria: 'Chat message', placeholder: 'Ask Producer' });
  const soundControl = musicControl({ value: sound, aria: 'Sound description' });
  const switchControl = musicControl({ text: 'Instrumental', aria: 'Toggle instrumental mode', checked: instrumental });
  return {
    async $(selector) {
      return selector === `[data-flow-ref="${submitRef}"]` ? sendElement : null;
    },
    async $$(selector) {
      return selector === 'button, a, [role="button"], [role="menuitem"], [role="option"], [role="tab"], span, div, p' ? [sendElement] : [];
    },
    async evaluate(callback, input) { return callback(input); },
    url() { return 'https://flowmusic.app/session/9a368e4d-1a8a-4a9e-884a-7d235dcf34b8'; },
    document: {
      body: { innerText: 'Flow Music Ask Producer Instrumental' },
      querySelectorAll(selector) {
        if (selector === 'textarea, input, [contenteditable="true"]') return [centralControl, soundControl];
        if (selector === '[role="switch"], input[type="checkbox"]') return [switchControl];
        return [];
      },
    },
  };
}

test('Music Send message submits only the central composer and stops before guard/click on invalid state', async () => {
  const [{ handleTool }, { browser }, { paidGuard }] = await Promise.all([
    import('../dist/tools.js'),
    import('../dist/browser.js'),
    import('../dist/guard.js'),
  ]);
  const originalGetPage = browser.getPage;
  const originalMarkMusicGenerationStart = browser.markMusicGenerationStart;
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const marked = [];
  let clicks = 0;
  const sendDom = {
    innerText: '', textContent: '',
    getAttribute(name) { return name === 'aria-label' ? 'Send message' : null; },
    hasAttribute() { return false; },
    scrollIntoView() {},
  };
  const sendElement = {
    async evaluate(callback) { return callback(sendDom); },
    async click() { clicks += 1; },
  };
  const installPage = (options) => {
    const page = createMusicSubmissionPage({ ...options, sendElement });
    globalThis.document = page.document;
    browser.getPage = async () => page;
  };
  globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  browser.markMusicGenerationStart = async (context) => { marked.push(context); };
  try {
    installPage({});
    paidGuard.revoke();
    await assert.rejects(handleTool('flow_click', { ref: 'el_send', expectedMusicPrompt: 'Central prompt' }), /Paid generation blocked/u);
    assert.equal(clicks, 0);

    await handleTool('flow_confirm_paid_generation', { confirm: true, maxBudgetCredits: 10 });
    const result = await handleTool('flow_click', { ref: 'el_send', expectedMusicPrompt: 'Central prompt' });
    assert.equal(result.content[0].text.includes('clicked'), true);
    assert.equal(clicks, 1);
    assert.deepEqual(marked, [{ conversationId: '9a368e4d-1a8a-4a9e-884a-7d235dcf34b8', soundPrompt: 'Central prompt', instrumental: true, startedAt: marked[0].startedAt }]);

    await assert.rejects(handleTool('flow_click', { ref: 'el_send', expectedMusicPrompt: 'Central prompt' }), /Paid generation blocked/u);
    assert.equal(clicks, 1);

    const generateDom = {
      innerText: 'Generate', textContent: 'Generate',
      getAttribute(name) { return name === 'aria-label' ? 'Generate' : null; },
      hasAttribute() { return false; },
      scrollIntoView() {},
    };
    const generateElement = {
      async evaluate(callback) { return callback(generateDom); },
      async click() { clicks += 1; },
    };
    const legacyPage = createMusicSubmissionPage({ sound: '  Legacy   sound  ', sendElement: generateElement, submitRef: 'el_generate' });
    globalThis.document = legacyPage.document;
    browser.getPage = async () => legacyPage;
    await handleTool('flow_confirm_paid_generation', { confirm: true, maxBudgetCredits: 10 });
    await handleTool('flow_click', { ref: 'el_generate' });
    assert.equal(clicks, 2);
    assert.equal(marked.at(-1).soundPrompt, 'Legacy sound');
    await handleTool('flow_confirm_paid_generation', { confirm: true, maxBudgetCredits: 10 });
    await assert.rejects(handleTool('flow_click', { ref: 'el_generate', expectedMusicPrompt: 'Central prompt' }), /requires the central Flow Music Send message/u);
    assert.equal(paidGuard.getState().confirmed, true, 'legacy Generate with expectedMusicPrompt must fail before guard');
    paidGuard.revoke();
    assert.equal(clicks, 2);

    for (const [options, expected] of [
      [{ central: '' }, /central Chat message\/Ask Producer input/u],
      [{ central: 'One', sound: 'Wrong side prompt' }, /does not match expectedMusicPrompt/u],
      [{ instrumental: false }, /Instrumental mode enabled/u],
    ]) {
      installPage(options);
      await handleTool('flow_confirm_paid_generation', { confirm: true, maxBudgetCredits: 10 });
      await assert.rejects(handleTool('flow_click', { ref: 'el_send', expectedMusicPrompt: 'Central prompt' }), expected);
      assert.equal(paidGuard.getState().confirmed, true, 'invalid Music form must not consume authorization');
      paidGuard.revoke();
      assert.equal(clicks, 2);
    }

    const duplicatePage = createMusicSubmissionPage({ sendElement });
    const originalQuerySelectorAll = duplicatePage.document.querySelectorAll;
    duplicatePage.document.querySelectorAll = (selector) => selector === 'textarea, input, [contenteditable="true"]'
      ? [
        musicControl({ value: 'One', aria: 'Chat message' }),
        musicControl({ value: 'Two', aria: 'Ask Producer' }),
        musicControl({ value: 'Wrong', aria: 'Sound description' }),
      ]
      : originalQuerySelectorAll(selector);
    globalThis.document = duplicatePage.document;
    browser.getPage = async () => duplicatePage;
    await handleTool('flow_confirm_paid_generation', { confirm: true, maxBudgetCredits: 10 });
    await assert.rejects(handleTool('flow_click', { ref: 'el_send', expectedMusicPrompt: 'One' }), /exactly one visible/u);
    assert.equal(paidGuard.getState().confirmed, true);
    paidGuard.revoke();
    assert.equal(clicks, 2);

    installPage({});
    await assert.rejects(handleTool('flow_click', { ref: 'stale_send', selector: '[data-flow-ref="el_send"]' }), /Explicit flow_click ref not found: stale_send/u);
    assert.equal(clicks, 2);
  } finally {
    paidGuard.revoke();
    browser.getPage = originalGetPage;
    browser.markMusicGenerationStart = originalMarkMusicGenerationStart;
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});
