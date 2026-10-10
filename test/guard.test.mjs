import assert from 'node:assert/strict';
import test from 'node:test';
import { paidGuard } from '../dist/guard.js';
import { handleTool, TOOLS } from '../dist/tools.js';

test('a production request authorizes generation without a default credit ceiling', async () => {
  paidGuard.revoke();
  assert.deepEqual(TOOLS.find(tool => tool.name === 'flow_confirm_paid_generation').inputSchema.required, ['confirm']);
  const result = await handleTool('flow_confirm_paid_generation', { confirm: true });
  assert.ok(result);
  assert.equal(paidGuard.getState().confirmed, true);
  assert.equal(paidGuard.getState().maxBudgetCredits, undefined);
  assert.doesNotThrow(() => paidGuard.consume('video', 75));
  assert.equal(paidGuard.isActive(), false);
  assert.throws(() => paidGuard.consume('duplicate video', 75), /blocked/);
});

test('an explicit credit cap remains optional and is enforced when supplied', () => {
  paidGuard.confirm({ maxBudgetCredits: 10 });
  assert.throws(() => paidGuard.consume('video', 15), /exceeds confirmed budget/);
  paidGuard.revoke();
  for (const cap of [0, -1, Infinity, NaN]) {
    assert.throws(() => paidGuard.confirm({ maxBudgetCredits: cap }), /finite/);
  }
});
