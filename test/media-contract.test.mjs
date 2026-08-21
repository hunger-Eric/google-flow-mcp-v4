import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyMedia, detectMediaType } from '../dist/browser.js';
import { TOOLS } from '../dist/tools.js';

test('audio responses are classified as audio assets', () => {
  assert.equal(
    classifyMedia(
      'https://storage.googleapis.com/producer-app-public/clips/example.m4a',
      'audio/mp4',
    ),
    'audio',
  );
});

test('jpeg bytes cannot satisfy a requested video download', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(detectMediaType(jpeg, 'video'), 'image');
});

test('ftyp audio is preserved as audio when the caller requests audio', () => {
  const m4a = Buffer.concat([
    Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]),
    Buffer.from('soun'),
  ]);
  assert.equal(detectMediaType(m4a, 'audio'), 'audio');
  assert.equal(detectMediaType(m4a, 'video'), 'audio');
});

test('MCP schema exposes typed waits, downloads, and browser close', () => {
  const byName = Object.fromEntries(TOOLS.map((tool) => [tool.name, tool]));
  assert.ok(byName.flow_close);
  assert.deepEqual(byName.flow_wait.inputSchema.properties.mediaType.enum, [
    'image',
    'video',
    'audio',
  ]);
  assert.deepEqual(byName.flow_download.inputSchema.properties.expectedMediaType.enum, [
    'image',
    'video',
    'audio',
  ]);
});
