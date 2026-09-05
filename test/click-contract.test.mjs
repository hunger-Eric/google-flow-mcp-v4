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
