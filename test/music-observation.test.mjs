import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { MusicObservation, safeMusicSessionUrl, sha256Text } from '../dist/music-observation.js';

test('Music observation is opt-in, strips session query data, and writes only to the supplied validation directory', () => {
  const disabled = new MusicObservation('');
  assert.equal(disabled.enabled, false);
  assert.equal(safeMusicSessionUrl('https://flowmusic.app/session/8e004709-cbdf-4615-a911-564e5d91c046?secret=no#fragment'), 'https://flowmusic.app/session/8e004709-cbdf-4615-a911-564e5d91c046');
  assert.equal(safeMusicSessionUrl('https://example.test/session/8e004709-cbdf-4615-a911-564e5d91c046'), null);
  assert.equal(safeMusicSessionUrl('http://flowmusic.app/session/8e004709-cbdf-4615-a911-564e5d91c046'), null);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-music-observation-'));
  try {
    const observer = new MusicObservation(root);
    assert.equal(observer.enabled, true);
    observer.record('submitted', { actualSessionUrl: safeMusicSessionUrl('https://flowmusic.app/session'), inputSha256: sha256Text('prompt'), instrumental: true });
    const files = fs.readdirSync(root);
    assert.equal(files.length, 1);
    const row = JSON.parse(fs.readFileSync(path.join(root, files[0]), 'utf8'));
    assert.equal(row.event, 'submitted');
    assert.equal(row.inputSha256, sha256Text('prompt'));
    assert.equal(row.actualSessionUrl, 'https://flowmusic.app/session');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('late session UUID writes same-session raw prompt-mismatch and parse-failure rows without accepting them', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-music-observation-'));
  const previous = process.env.FLOW_MUSIC_VALIDATION_DIR;
  process.env.FLOW_MUSIC_VALIDATION_DIR = root;
  try {
    const { browser } = await import(`../dist/browser.js?observation=${Date.now()}`);
    let listener;
    let url = 'https://flowmusic.app/session';
    const page = { on(_event, callback) { listener = callback; }, url() { return url; } };
    browser.attachNetworkListener(page);
    const session = '8e004709-cbdf-4615-a911-564e5d91c046';
    await browser.markMusicGenerationStart({ soundPrompt: 'submitted prompt', instrumental: true, startedAt: 0 }, { target: 'ref:send', controlText: '', controlAria: 'Send message', sessionUrl: url });
    const payload = { clips: {
      '9ef02a54-a4c5-4f2b-a842-7757fcad326b': { id: '9ef02a54-a4c5-4f2b-a842-7757fcad326b', op_id: '782b0ca8-025c-5075-aee0-bedd79fea0be', op_type: 'audio__create_song', operation: { op_type: 'audio__create_song', conversation_id: session, sound_prompt: 'producer rewrite' }, duration: { status: 'completed', value: 'bad-duration' }, lyrics: { status: 'completed', value: { text: '[Instrumental]' } }, audio_url: 'https://cdn.example.test/one.m4a', created_at: '2026-10-08T01:00:00.000Z' },
      '2b8cdd02-1ca1-48d0-9a13-93fb6a8f8d84': { id: '2b8cdd02-1ca1-48d0-9a13-93fb6a8f8d84', op_id: '97a05c6b-65c3-5264-80df-8f2392a5a2dd', op_type: 'audio__create_song', operation: { op_type: 'audio__create_song', conversation_id: session, sound_prompt: 'other rewrite' }, duration: { status: 'completed', value: '30.5' }, lyrics: { status: 'completed', value: { text: '[Instrumental]' } }, audio_url: 'https://cdn.example.test/two.m4a', created_at: '2026-10-08T01:00:00.000Z' },
    } };
    await listener({ url() { return 'https://flowmusic.app/__api/clips'; }, status() { return 200; }, request() { return { method() { return 'POST'; } }; }, async text() { return JSON.stringify(payload); } });
    url = `https://flowmusic.app/session/${session}`;
    await assert.rejects(browser.waitForCurrentMusicResult(1), /Timed out/u);
    const rows = fs.readFileSync(path.join(root, fs.readdirSync(root)[0]), 'utf8');
    assert.doesNotMatch(rows, /producer rewrite|other rewrite|cdn\.example/u);
    assert.match(rows, /soundPromptSha256/u);
    assert.match(rows, /audioUrlSha256/u);
    await browser.close();
  } finally {
    if (previous === undefined) delete process.env.FLOW_MUSIC_VALIDATION_DIR;
    else process.env.FLOW_MUSIC_VALIDATION_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Music observation bounds and write failures remain local, and generic API bodies are opt-in only', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-music-observation-'));
  try {
    const observer = new MusicObservation(root);
    for (let index = 0; index < 1002; index += 1) observer.record('binding', { index });
    const file = path.join(root, fs.readdirSync(root)[0]);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(Buffer.byteLength(text) <= 1024 * 1024 + 128);
    assert.match(text, /"event":"truncated"/u);
    fs.rmSync(root, { recursive: true, force: true });
    assert.doesNotThrow(() => observer.record('after_delete', {}));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const browserSource = await readFile(new URL('../src/browser.ts', import.meta.url), 'utf8');
  assert.match(browserSource, /if \(isMusicApi && this\.musicObservation\.enabled\)/u);
});
