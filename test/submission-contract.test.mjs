import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyGenerationSubmitControl,
  classifyGenerationAudioTransition,
  classifyGenerationSubmitTransition,
  classifyGenerationSubmissionResponse,
} from '../dist/tools.js';

test('recognizes the enabled Chinese Flow video submit control as a paid submission', () => {
  assert.deepEqual(
    classifyGenerationSubmitControl(
      { text: 'arrow_forward', aria: '开始生成', disabled: false },
      '视频 · 720p · 10 秒 crop_16_9 x1',
    ),
    { isSubmit: true, isPaid: true, enabled: true },
  );
  assert.deepEqual(
    classifyGenerationSubmitControl(
      { text: 'arrow_forward', aria: '开始生成', disabled: true },
      '视频 · 720p · 10 秒 crop_16_9 x1',
    ),
    { isSubmit: true, isPaid: true, enabled: false },
  );
});

test('recognizes the Flow Music Generate control as a paid submission', () => {
  assert.deepEqual(
    classifyGenerationSubmitControl(
      { text: 'Generate', aria: 'Generate', disabled: false },
      'Flow Music Ask Producer Instrumental Lyria',
    ),
    { isSubmit: true, isPaid: true, enabled: true },
  );
});

test('accepts only a successful POST to a Flow generation endpoint as submission acknowledgement', () => {
  assert.deepEqual(
    classifyGenerationSubmissionResponse({
      method: 'POST',
      url: 'https://flow.google.com/api/flowCreationAgent:batchCreate',
      status: 200,
    }),
    { acknowledged: true, status: 200 },
  );
  assert.deepEqual(
    classifyGenerationSubmissionResponse({
      method: 'GET',
      url: 'https://flow.google.com/api/flowCreationAgent:batchCreate',
      status: 200,
    }),
    { acknowledged: false, status: 200 },
  );
});

test('accepts the Flow submit control changing from enabled to disabled as UI acknowledgement', () => {
  assert.deepEqual(
    classifyGenerationSubmitTransition({ beforeDisabled: false, afterDisabled: true }),
    { acknowledged: true, source: 'ui_submit_state' },
  );
  assert.deepEqual(
    classifyGenerationSubmitTransition({ beforeDisabled: false, afterDisabled: false }),
    { acknowledged: false, source: 'ui_submit_state' },
  );
});

test('accepts only a newly added Flow Music audio URL as submission acknowledgement', () => {
  assert.deepEqual(
    classifyGenerationAudioTransition({ before: ['https://audio/old.m4a'], after: ['https://audio/old.m4a', 'https://audio/new.m4a'] }),
    { acknowledged: true, source: 'ui_new_audio' },
  );
  assert.deepEqual(
    classifyGenerationAudioTransition({ before: ['https://audio/old.m4a'], after: ['https://audio/old.m4a'] }),
    { acknowledged: false, source: 'ui_new_audio' },
  );
});
