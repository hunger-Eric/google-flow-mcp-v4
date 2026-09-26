import assert from 'node:assert/strict';
import test from 'node:test';

import * as browserContract from '../dist/browser.js';
import { TOOLS } from '../dist/tools.js';

const { classifyMedia, detectMediaType } = browserContract;

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

test('video polling selects the newest generated-video thumbnail that was not present at submission', () => {
  const select = browserContract.selectNewGeneratedVideoThumbnail;
  const actual = typeof select === 'function'
    ? select(
        [
          { src: 'https://example.test/old.jpg', alt: '生成的视频缩略图' },
          { src: 'https://example.test/newest.jpg', alt: 'Generated video thumbnail' },
          { src: 'https://example.test/newer.jpg', alt: '生成的视频缩略图' },
        ],
        new Set(['https://example.test/old.jpg']),
        new Set(['https://example.test/newer.jpg']),
      )
    : null;

  assert.deepEqual(actual, {
    src: 'https://example.test/newest.jpg',
    alt: 'Generated video thumbnail',
  });
});


test('music recovery selects the recorded result instead of earlier session audio', async () => {
  const { createHash } = await import('node:crypto');
  const instance = new browserContract.browser.constructor();
  const oldUrl = 'https://example.test/old.m4a', resultUrl = 'https://example.test/result.m4a';
  instance.getPage = async () => ({ evaluate: async () => [{ url: oldUrl, type: 'audio' }, { url: resultUrl, type: 'audio' }] });
  const asset = await instance.getObservedAssetByUrlSha256(createHash('sha256').update(resultUrl).digest('hex'), 'audio');
  assert.equal(asset.url, resultUrl);
  assert.equal(await instance.getObservedAssetByUrlSha256('a'.repeat(64), 'audio'), null);
});

test('late unrelated audio does not inherit or satisfy the current provider job', async () => {
  const instance = new browserContract.browser.constructor();
  instance.activeJobId = 'current-job';
  instance.genStartTime = Date.now();
  instance.recordAsset('https://example.test/old.m4a', 'network_media', undefined, 'audio/mp4');
  assert.equal(instance.assets[0].jobId, undefined);
  assert.equal(await instance.getLatestGeneratedAsset('audio'), null);
  instance.recordAsset('https://example.test/current.m4a', 'network_rpc', 'current-job', 'audio/mp4');
  assert.equal(await instance.getLatestGeneratedAsset('audio'), null);
});

test('audio first observed after submission is not a new result without provider identity', async () => {
  const instance = new browserContract.browser.constructor();
  instance.genStartTime = Date.now();
  instance.recordAsset('https://example.test/historical.m4a', 'network_rpc', undefined, 'audio/mp4');
  instance.getPage = async () => { throw new Error('Unbound music must not scan the global player'); };
  assert.equal(await instance.getLatestGeneratedAsset('audio'), null);
});
