import assert from 'node:assert/strict';
import test from 'node:test';
import { readStablePageIdentity } from '../dist/browser.js';

test('navigation identity retries a transient destroyed execution context', async () => {
  let titleCalls = 0;
  const page = {
    async title() {
      titleCalls += 1;
      if (titleCalls === 1) throw new Error('Execution context was destroyed, most likely because of a navigation.');
      return 'Google Flow';
    },
    url() { return 'https://labs.google/fx/zh/tools/flow/project/project-1'; },
  };
  const pauses = [];
  const result = await readStablePageIdentity(page, async (milliseconds) => { pauses.push(milliseconds); });
  assert.deepEqual(result, { title: 'Google Flow', url: 'https://labs.google/fx/zh/tools/flow/project/project-1' });
  assert.equal(titleCalls, 2);
  assert.deepEqual(pauses, [300]);
});

test('navigation identity does not hide non-navigation failures', async () => {
  const page = { async title() { throw new Error('Target closed'); }, url() { return 'about:blank'; } };
  await assert.rejects(() => readStablePageIdentity(page, async () => {}), /Target closed/);
});
