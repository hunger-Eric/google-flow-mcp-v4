import assert from 'node:assert/strict';
import test from 'node:test';

import { browser } from '../dist/browser.js';

const sessionId = '8e004709-cbdf-4615-a911-564e5d91c046';
const clipId = '9ef02a54-a4c5-4f2b-a842-7757fcad326b';
const operationId = '782b0ca8-025c-5075-aee0-bedd79fea0be';
const prompt = 'restrained documentary underscore';

function completedPayload(audioUrl = 'https://cdn.example.test/clips/song.m4a', overrides = {}) {
  const payloadClipId = overrides.clipId ?? clipId;
  const payloadOperationId = overrides.operationId ?? operationId;
  return {
    clips: {
      [payloadClipId]: {
        id: payloadClipId,
        op_id: payloadOperationId,
        op_type: 'audio__create_song',
        operation: { op_type: 'audio__create_song', conversation_id: sessionId, sound_prompt: prompt, ...overrides.operation },
        duration: { status: 'completed', value: '30.5' },
        lyrics: { status: 'completed', value: { text: '[Instrumental]' } },
        audio_url: audioUrl,
        created_at: overrides.createdAt ?? '2026-10-08T01:00:00.000Z',
      },
    },
  };
}

function combinePayloads(...payloads) {
  return { clips: Object.assign({}, ...payloads.map((payload) => payload.clips)) };
}

function fakeResponse({ url, method = 'POST', status = 200, body = '', contentType = '' }) {
  return {
    url() { return url; },
    status() { return status; },
    request() { return { method() { return method; } }; },
    headers() { return { 'content-type': contentType }; },
    async text() { return body; },
  };
}

function deferredResponse(url) {
  let resolve;
  const body = new Promise((done) => { resolve = done; });
  return {
    response: fakeResponse({ url, body }),
    resolve,
  };
}

function fakeMusicPage(initialUrl) {
  let currentUrl = initialUrl;
  let responseListener;
  return {
    on(event, listener) {
      assert.equal(event, 'response');
      responseListener = listener;
    },
    url() { return currentUrl; },
    setUrl(url) { currentUrl = url; },
    async emit(response) { await responseListener(response); },
  };
}

test('Music result cache survives playback signals, preserves signed URL conflict, and retries only validated late-session candidates', async () => {
  await browser.close();
  const page = fakeMusicPage(`https://flowmusic.app/session/${sessionId}`);
  browser.attachNetworkListener(page);
  await browser.markMusicGenerationStart({ conversationId: sessionId, soundPrompt: prompt, instrumental: true, startedAt: 0 });

  const clipsResponse = fakeResponse({
    url: 'https://flowmusic.app/__api/clips',
    body: JSON.stringify(completedPayload()),
  });
  await page.emit(clipsResponse);
  const captured = browser.getCurrentMusicResult();
  assert.equal(captured?.audioUrl, 'https://cdn.example.test/clips/song.m4a');

  // A player fetch and a same-clip provider reread both preserve the captured result.
  await page.emit(fakeResponse({
    url: 'https://cdn.example.test/clips/song.m4a?playback=1', method: 'GET', contentType: 'audio/mp4',
  }));
  assert.deepEqual(browser.getCurrentMusicResult(), captured);
  await page.emit(clipsResponse);
  assert.deepEqual(browser.getCurrentMusicResult(), captured);

  // The existing identity is clipId + operationId + audioUrl, so URL rotation is a conflict.
  await page.emit(fakeResponse({
    url: 'https://flowmusic.app/__api/clips',
    body: JSON.stringify(completedPayload('https://cdn.example.test/clips/song.m4a?signature=rotated')),
  }));
  assert.equal(browser.getCurrentMusicResult(), null);

  await browser.close();
  const newSessionPage = fakeMusicPage('https://flowmusic.app/session');
  browser.attachNetworkListener(newSessionPage);
  await browser.markMusicGenerationStart({ soundPrompt: prompt, instrumental: true, startedAt: 0 });
  await newSessionPage.emit(clipsResponse);
  assert.equal(browser.getCurrentMusicResult(), null, 'clips observed before the session UUID cannot bind');
  newSessionPage.setUrl(`https://flowmusic.app/session/${sessionId}`);
  await newSessionPage.emit(fakeResponse({
    url: 'https://cdn.example.test/clips/song.m4a?playback=1', method: 'GET', contentType: 'audio/mp4',
  }));
  assert.equal(browser.getCurrentMusicResult(), null, 'a later playback fetch does not re-run clips selection');
  assert.equal((await browser.waitForCurrentMusicResult(1000)).operationId, operationId, 'the existing wait loop retries parsed candidates after the URL changes');

  for (const [name, payload, startedAt] of [
    ['wrong session', completedPayload(undefined, { operation: { conversation_id: '6c188b76-8d1b-4008-a3ff-90f29ca0524e' } }), 0],
    ['wrong prompt', completedPayload(undefined, { operation: { sound_prompt: 'different prompt' } }), 0],
    ['pre-submit', completedPayload(undefined, { createdAt: '2026-10-08T01:00:00.000Z' }), Date.parse('2026-10-08T01:00:01.000Z')],
  ]) {
    await browser.close();
    const candidatePage = fakeMusicPage('https://flowmusic.app/session');
    browser.attachNetworkListener(candidatePage);
    await browser.markMusicGenerationStart({ soundPrompt: prompt, instrumental: true, startedAt });
    await candidatePage.emit(fakeResponse({ url: 'https://flowmusic.app/__api/clips', body: JSON.stringify(payload) }));
    candidatePage.setUrl(`https://flowmusic.app/session/${sessionId}`);
    await assert.rejects(browser.waitForCurrentMusicResult(1), /Timed out/u, `${name} must not bind after a late UUID`);
  }

  await browser.close();
  const splitPage = fakeMusicPage('https://flowmusic.app/session');
  browser.attachNetworkListener(splitPage);
  await browser.markMusicGenerationStart({ soundPrompt: prompt, instrumental: true, startedAt: 0 });
  await splitPage.emit(fakeResponse({ url: 'https://flowmusic.app/__api/clips', body: JSON.stringify(completedPayload()) }));
  await splitPage.emit(fakeResponse({
    url: 'https://flowmusic.app/__api/clips',
    body: JSON.stringify(completedPayload('https://cdn.example.test/clips/second.m4a', {
      clipId: '2b8cdd02-1ca1-48d0-9a13-93fb6a8f8d84',
      operationId: '97a05c6b-65c3-5264-80df-8f2392a5a2dd',
    })),
  }));
  splitPage.setUrl(`https://flowmusic.app/session/${sessionId}`);
  await assert.rejects(browser.waitForCurrentMusicResult(1), /Timed out/u, 'two exact candidates split across responses remain ambiguous');

  await browser.close();
  const historicalPage = fakeMusicPage('https://flowmusic.app/session');
  browser.attachNetworkListener(historicalPage);
  await browser.markMusicGenerationStart({ soundPrompt: prompt, instrumental: true, startedAt: 0 });
  const historical = Array.from({ length: 17 }, (_, index) => completedPayload(undefined, {
    clipId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    operationId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    operation: { sound_prompt: `historical prompt ${index + 1}` },
  }));
  await historicalPage.emit(fakeResponse({
    url: 'https://flowmusic.app/__api/clips',
    body: JSON.stringify(combinePayloads(...historical, completedPayload())),
  }));
  historicalPage.setUrl(`https://flowmusic.app/session/${sessionId}`);
  assert.equal((await browser.waitForCurrentMusicResult(1000)).clipId, clipId, 'unrelated historical clips do not consume the current-submission candidate cap');

  await browser.close();
  const oldPage = fakeMusicPage('https://flowmusic.app/session');
  browser.attachNetworkListener(oldPage);
  await browser.markMusicGenerationStart({ soundPrompt: prompt, instrumental: true, startedAt: 0 });
  const delayed = deferredResponse('https://flowmusic.app/__api/clips');
  const oldResponse = oldPage.emit(delayed.response);
  await browser.markMusicGenerationStart({ conversationId: sessionId, soundPrompt: prompt, instrumental: true, startedAt: 0 });
  delayed.resolve(JSON.stringify(completedPayload()));
  await oldResponse;
  await assert.rejects(browser.waitForCurrentMusicResult(1), /Timed out/u, 'a response parsed after the next generation starts is discarded');

  await browser.close();
  const resetPage = fakeMusicPage(`https://flowmusic.app/session/${sessionId}`);
  browser.attachNetworkListener(resetPage);
  await browser.markMusicGenerationStart({ conversationId: sessionId, soundPrompt: prompt, instrumental: true, startedAt: 0 });
  await assert.rejects(browser.waitForCurrentMusicResult(1), /Timed out/u, 'a new generation cannot reuse a prior pending candidate');
  await browser.close();
});
