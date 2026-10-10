import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uploadLocalAsset, isUploadAction } from '../dist/upload.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-upload-test-'));
process.on('exit', () => fs.rmSync(directory, { recursive: true, force: true }));
const handle = (element) => ({ asElement: () => element, async dispose() {} });

for (const extension of ['jpg', 'wav', 'mp4']) {
  test(`${extension}: native chooser waits for completed upload and selects material before success`, async () => {
    const file = path.join(directory, `material.${extension}`); fs.writeFileSync(file, 'test material');
    const events = []; let pickerOpen = false; let selected = false; let attached = false; let checks = 0;
    const page = {
      async $() { return null; },
      async evaluateHandle(_fn, value) {
        if (value === 'upload') return handle(pickerOpen ? { async click() { events.push('upload click'); }, async dispose() {} } : null);
        if (value === 'add') return handle({ async click() { pickerOpen = true; events.push('add material'); }, async dispose() {} });
        if (value === 'attach') return handle({ async click() { attached = true; events.push('add to prompt'); }, async dispose() {} });
        if (Array.isArray(value)) {
          assert.deepEqual(value, [path.basename(file), path.parse(file).name]);
          return handle({ async click() { selected = true; if (extension === 'jpg') attached = true; events.push('select material'); } });
        }
        return handle(null);
      },
      async waitForFileChooser() {
        events.push('listen chooser');
        return { async accept(files) { assert.deepEqual(files, [file]); events.push('accept file'); } };
      },
      async evaluate() {
        checks += 1;
        return { filenameVisible: true, pending: checks === 1, inPicker: !attached, error: '' };
      },
    };
    const receipt = await uploadLocalAsset(page, file);
    assert.equal(receipt.verified, true);
    assert.equal(receipt.verification.uploadCompleted, true);
    assert.equal(receipt.verification.selectedFromPicker, true);
    assert.ok(checks >= 3);
    assert.deepEqual(events, ['add material', 'listen chooser', 'upload click', 'accept file', 'select material',
      ...(extension === 'jpg' ? [] : ['add to prompt'])]);
  });
}

test('existing file input uploads without navigating and reports a platform format rejection', async () => {
  let uploads = 0;
  const input = { async uploadFile() { uploads++; } };
  const page = { async $() { return input; }, async evaluateHandle() { return handle(null); },
    async evaluate() { return { filenameVisible: false, pending: false, inPicker: false, error: 'Unsupported file format' }; } };
  await assert.rejects(() => uploadLocalAsset(page, path.join(directory, 'material.wav')), /rejected.*Unsupported/);
  assert.equal(uploads, 1);
});

test('a stale explicit target never uploads through a different input', async () => {
  const selectors = [];
  const page = { async $(selector) { selectors.push(selector); return null; } };
  await assert.rejects(() => uploadLocalAsset(page, 'material.mp4', { ref: 'missing' }), /not falling back/);
  assert.deepEqual(selectors, ['[data-flow-ref="missing"]']);
});

test('upload labels exclude library categories and generation buttons', () => {
  for (const label of ['upload 上传媒体内容', 'Upload media', '上传', 'Upload files']) assert.equal(isUploadAction(label), true);
  for (const label of ['drive_folder_upload 上传的内容', 'Uploaded content', '开始生成', 'Generate']) assert.equal(isUploadAction(label), false);
});

test('the rights notice is not accepted without authorization for the material', async () => {
  let clicked = false;
  const page = { async $() { return { async uploadFile() {} }; },
    async evaluateHandle() { return handle({ async click() { clicked = true; } }); } };
  await assert.rejects(() => uploadLocalAsset(page, 'material.wav'), /requires upload-rights acknowledgement/);
  assert.equal(clicked, false);
});
