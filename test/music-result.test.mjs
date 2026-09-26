import assert from 'node:assert/strict';
import test from 'node:test';

import { extractCompletedFlowMusicClips, selectCurrentFlowMusicResult, sha256Text } from '../dist/music-result.js';

const context = {
  conversationId: '8e004709-cbdf-4615-a911-564e5d91c046',
  soundPrompt: 'restrained documentary underscore',
  startedAt: Date.parse('2026-09-26T08:57:51.363Z'),
  instrumental: true,
};

function payload(overrides = {}) {
  return {
    clips: {
      '9ef02a54-a4c5-4f2b-a842-7757fcad326b': {
        id: '9ef02a54-a4c5-4f2b-a842-7757fcad326b',
        op_id: '782b0ca8-025c-5075-aee0-bedd79fea0be',
        op_type: 'audio__create_song',
        created_at: '2026-09-26T08:58:10.377425Z',
        audio_url: 'https://cdn.example.test/clips/current.m4a',
        duration: { status: 'completed', value: '176.39466666666667' },
        lyrics: { status: 'completed', value: { text: '[Instrumental]' } },
        operation: {
          op_type: 'audio__create_song',
          conversation_id: context.conversationId,
          sound_prompt: context.soundPrompt,
        },
        ...overrides,
      },
    },
  };
}

test('binds one completed Flow Music clip to its exact session, prompt and instrumental declaration', () => {
  const result = selectCurrentFlowMusicResult(payload(), context);
  assert.deepEqual(result, {
    clipId: '9ef02a54-a4c5-4f2b-a842-7757fcad326b',
    operationId: '782b0ca8-025c-5075-aee0-bedd79fea0be',
    conversationId: context.conversationId,
    soundPromptSha256: sha256Text(context.soundPrompt),
    audioUrl: 'https://cdn.example.test/clips/current.m4a',
    createdAt: '2026-09-26T08:58:10.377425Z',
    duration: '176.39466666666667',
    instrumental: true,
  });
});

test('requires the browser to bind a new Music session UUID before selecting the provider result', () => {
  assert.equal(selectCurrentFlowMusicResult(payload(), { ...context, conversationId: undefined }), null);
  const result = selectCurrentFlowMusicResult(payload(), context);
  assert.equal(result?.conversationId, context.conversationId);
  assert.equal(selectCurrentFlowMusicResult(payload({ duration: { status: 'completed', value: 'not-a-duration' } }), context), null);
});

test('records only structurally completed instrumental Music clips for exact-hash recovery', () => {
  assert.deepEqual(extractCompletedFlowMusicClips(payload()), [{
    clipId: '9ef02a54-a4c5-4f2b-a842-7757fcad326b', operationId: '782b0ca8-025c-5075-aee0-bedd79fea0be',
    conversationId: context.conversationId, soundPrompt: context.soundPrompt,
    audioUrl: 'https://cdn.example.test/clips/current.m4a', createdAt: '2026-09-26T08:58:10.377425Z',
    duration: '176.39466666666667', instrumental: true,
  }]);
  assert.deepEqual(extractCompletedFlowMusicClips(payload({ lyrics: { status: 'completed', value: { text: 'voice' } } })), []);
});

test('rejects another session, another prompt, a pre-submit clip, non-instrumental lyrics, and a non-song response', () => {
  assert.equal(selectCurrentFlowMusicResult(payload({ operation: { op_type: 'audio__create_song', conversation_id: '6c188b76-8d1b-4008-a3ff-90f29ca0524e', sound_prompt: context.soundPrompt } }), context), null);
  assert.equal(selectCurrentFlowMusicResult(payload({ operation: { op_type: 'audio__create_song', conversation_id: context.conversationId, sound_prompt: 'another prompt' } }), context), null);
  assert.equal(selectCurrentFlowMusicResult(payload({ created_at: '2026-09-26T08:57:50.000Z' }), context), null);
  assert.equal(selectCurrentFlowMusicResult(payload({ lyrics: { status: 'completed', value: { text: 'A vocal line' } } }), context), null);
  assert.equal(selectCurrentFlowMusicResult(payload({ op_type: 'video__create_clip' }), context), null);
});

test('rejects malformed identity and ambiguous distinct completed songs', () => {
  assert.equal(selectCurrentFlowMusicResult(payload({ id: 'not-a-clip-id' }), context), null);
  const duplicate = payload();
  duplicate.clips['2b8cdd02-1ca1-48d0-9a13-93fb6a8f8d84'] = {
    ...duplicate.clips['9ef02a54-a4c5-4f2b-a842-7757fcad326b'],
    id: '2b8cdd02-1ca1-48d0-9a13-93fb6a8f8d84',
    op_id: 'e32db39f-d29f-5d06-98a5-56d18c6eb7ea',
    audio_url: 'https://cdn.example.test/clips/second.m4a',
  };
  assert.equal(selectCurrentFlowMusicResult(duplicate, context), null);
});
