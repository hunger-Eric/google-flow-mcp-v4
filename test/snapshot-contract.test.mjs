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
