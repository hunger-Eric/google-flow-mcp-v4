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

test('expectedPlaybackControl accepts exact Play/Pause and rejects a ref that changed to Send before click', async () => {
  const [{ handleTool }, { browser }] = await Promise.all([import('../dist/tools.js'), import('../dist/browser.js')]);
  const originalGetPage = browser.getPage;
  const originalDocument = globalThis.document;
  let clicks = 0;
  const makeElement = (aria, title = '') => ({
    async evaluate(callback) { return callback({ innerText: '', textContent: '', getAttribute(name) { return name === 'aria-label' ? aria : name === 'title' ? title : null; }, hasAttribute() { return false; }, scrollIntoView() {} }); },
    async click() { clicks += 1; },
  });
  const play = makeElement('', 'Play');
  const mixed = { async evaluate(callback) { return callback({ innerText: 'Send message', textContent: 'Send message', getAttribute(name) { return name === 'aria-label' ? 'Play' : null; }, hasAttribute() { return false; }, scrollIntoView() {} }); }, async click() { clicks += 1; } };
  const page = { async $(selector) { return selector === '[data-flow-ref="el_play"]' ? play : selector === '[data-flow-ref="el_changed"]' ? makeElement('Send message') : selector === '[data-flow-ref="el_mixed"]' ? mixed : null; }, async evaluate(callback) { return callback(); }, url() { return 'https://flowmusic.app/session'; } };
  globalThis.document = { body: { innerText: 'Flow Music' } };
  browser.getPage = async () => page;
  try {
    await handleTool('flow_click', { ref: 'el_play', expectedPlaybackControl: true });
    assert.equal(clicks, 1);
    await assert.rejects(handleTool('flow_click', { ref: 'el_changed', expectedPlaybackControl: true }), /Expected playback control changed/u);
    assert.equal(clicks, 1);
    await assert.rejects(handleTool('flow_click', { ref: 'el_mixed', expectedPlaybackControl: true }), /generation submit control/u);
    assert.equal(clicks, 1);
  } finally {
    browser.getPage = originalGetPage;
    globalThis.document = originalDocument;
  }
});

test('named playback verifies the exact audio and rejects transport, changed submit, wrong audio, and wrong state', async () => {
  const [{ handleTool }, { browser }] = await Promise.all([import('../dist/tools.js'), import('../dist/browser.js')]);
  const originalGetPage = browser.getPage;
  const originalDocument = globalThis.document;
  const audioUrl = 'https://cdn.example.test/clips/current.m4a?signature=one';
  const assetHash = (await import('node:crypto')).createHash('sha256').update(audioUrl).digest('hex');
  const makeButton = (label, onClick = () => {}, title = '') => ({
    async evaluate(callback) { return callback({ innerText: '', textContent: '', getAttribute(name) { return name === 'aria-label' ? label : name === 'title' ? title : null; }, hasAttribute() { return false; }, scrollIntoView() {} }); },
    async click() { onClick(); },
  });
  const audio = { currentSrc: audioUrl, src: audioUrl, paused: true };
  globalThis.document = { body: { innerText: 'Flow Music' }, querySelectorAll(selector) { return selector === 'audio' ? [audio] : []; } };
  let button = makeButton('', () => { audio.paused = false; }, 'Play Documentary Underscore');
  const page = { async $(selector) { return selector === '[data-flow-ref="el_play"]' ? button : null; }, async evaluate(callback, input) { return callback(input); }, url() { return 'https://flowmusic.app/session'; } };
  browser.getPage = async () => page;
  const args = { ref: 'el_play', expectedPlaybackControl: true, expectedPlaybackLabel: 'Play Documentary Underscore', expectedPlaybackAssetUrlSha256: assetHash };
  try {
    const success = JSON.parse((await handleTool('flow_click', args)).content[0].text);
    assert.deepEqual(success.playbackEvidence, { assetUrlSha256: assetHash, paused: false, matchedAudioCount: 1 });

    audio.paused = true;
    button = makeButton('Play previous track');
    await assert.rejects(handleTool('flow_click', args), /Expected playback control changed/u);

    button = makeButton('Play Documentary Underscore');
    await assert.rejects(handleTool('flow_click', { ...args, expectedPlaybackLabel: 'Pause Documentary Underscore' }), /Expected playback control changed/u);

    let evaluates = 0;
    button = {
      async evaluate(callback) {
        evaluates += 1;
        const label = evaluates === 1 ? 'Play Documentary Underscore' : 'Send message';
        return callback({ innerText: label === 'Send message' ? label : '', textContent: label === 'Send message' ? label : '', getAttribute(name) { return name === 'aria-label' ? label : null; }, hasAttribute() { return false; }, scrollIntoView() {} });
      },
      async click() { throw new Error('submit must not click'); },
    };
    await assert.rejects(handleTool('flow_click', args), /generation submit control|Expected playback control changed/u);

    button = makeButton('Play Documentary Underscore');
    audio.currentSrc = 'https://cdn.example.test/clips/wrong.m4a';
    audio.src = audio.currentSrc;
    await assert.rejects(handleTool('flow_click', args), /playback audio was not found/u);

    audio.currentSrc = audioUrl;
    audio.src = audioUrl;
    audio.paused = true;
    button = makeButton('Play Documentary Underscore');
    await assert.rejects(handleTool('flow_click', args), /playback state was not observed/u);
  } finally {
    browser.getPage = originalGetPage;
    globalThis.document = originalDocument;
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

function createMusicSubmissionPage({ central = '  Central   prompt  ', sound = 'Wrong side prompt', instrumental = true, sendElement, submitRef = 'el_send', sessionUrl = 'https://flowmusic.app/session/9a368e4d-1a8a-4a9e-884a-7d235dcf34b8' }) {
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
    url() { return sessionUrl; },
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

test('only a verified non-empty expected prompt enables fresh Producer rewrite binding', async () => {
  const [{ handleTool }, { browser }, { paidGuard }] = await Promise.all([import('../dist/tools.js'), import('../dist/browser.js'), import('../dist/guard.js')]);
  const originalGetPage = browser.getPage;
  const originalMark = browser.markMusicGenerationStart;
  const originalDocument = globalThis.document;
  const originalStyle = globalThis.getComputedStyle;
  const marked = [];
  const dom = { innerText: '', textContent: '', getAttribute(name) { return name === 'aria-label' ? 'Send message' : null; }, hasAttribute() { return false; }, scrollIntoView() {} };
  const send = { async evaluate(callback) { return callback(dom); }, async click() {} };
  const page = createMusicSubmissionPage({ sendElement: send, sessionUrl: 'https://flowmusic.app/session' });
  browser.getPage = async () => page;
  browser.markMusicGenerationStart = async (context) => { marked.push(context); };
  globalThis.document = page.document;
  globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  try {
    await handleTool('flow_confirm_paid_generation', { confirm: true, maxBudgetCredits: 10 });
    await handleTool('flow_click', { ref: 'el_send', expectedMusicPrompt: 'Central prompt' });
    assert.equal(marked.at(-1).promptSource, 'producer_chat_fresh_session');
    await handleTool('flow_confirm_paid_generation', { confirm: true, maxBudgetCredits: 10 });
    await handleTool('flow_click', { ref: 'el_send' });
    assert.equal(marked.at(-1).promptSource, undefined);
  } finally {
    paidGuard.revoke();
    browser.getPage = originalGetPage;
    browser.markMusicGenerationStart = originalMark;
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalStyle;
  }
});

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
