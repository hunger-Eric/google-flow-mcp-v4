import type { ElementHandle, Page } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type UploadOptions = { ref?: string; selector?: string; confirmUploadRights?: boolean };

// Match upload actions, never the "Uploaded content" library category or Generate.
export function isUploadAction(text: string): boolean {
  return /^(?:upload\s+)?(?:上传(?:媒体内容|文件|素材)?|upload(?: media(?: content)?| files?| assets?)?)$/iu.test(text.trim());
}

async function control(page: Page, kind: 'upload' | 'add' | 'attach'): Promise<ElementHandle<Element> | null> {
  const handle = await page.evaluateHandle((wanted) => {
    const visible = (el: Element) => {
      const b = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && !(el as HTMLButtonElement).disabled;
    };
    return [...document.querySelectorAll('button,[role="button"],[role="menuitem"]')].find(el => {
      if (!visible(el)) return false;
      const aria = el.getAttribute('aria-label') || '';
      const text = (el as HTMLElement).innerText?.trim() || el.textContent?.trim() || '';
      return wanted === 'attach' ? /^(?:添加到提示|add to prompt)$/iu.test(text)
        : wanted === 'add'
        ? /^(?:在提示框中添加素材|add (?:media|assets|ingredients) to (?:the )?prompt)$/iu.test(aria)
        : /^(?:upload\s+)?(?:上传(?:媒体内容|文件|素材)?|upload(?: media(?: content)?| files?| assets?)?)$/iu.test(text)
          || /^(?:上传(?:媒体内容|文件|素材)?|upload(?: media(?: content)?| files?| assets?)?)$/iu.test(aria);
    }) || null;
  }, kind);
  const element = handle.asElement();
  if (!element) await handle.dispose();
  return element as ElementHandle<Element> | null;
}

export async function uploadLocalAsset(page: Page, file: string, options: UploadOptions = {}) {
  const filename = path.basename(file);
  // Video/audio cards may display the stem while image cards retain the extension.
  const names = [filename, path.parse(filename).name];
  let input: ElementHandle<Element> | null = null;
  let target = '';
  if (options.ref || options.selector) {
    input = await page.$(options.ref ? `[data-flow-ref="${options.ref}"]` : options.selector!);
    if (!input) throw new Error('Explicit upload target is unavailable; not falling back to another control');
    if (!await input.evaluate(el => el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file')) {
      throw new Error('Explicit upload target must be a file input');
    }
    target = options.ref ? `ref:${options.ref}` : `selector:${options.selector}`;
  } else {
    input = await page.$('input[type="file"]');
    if (input) target = 'auto:input[type=file]';
  }
  if (input) {
    await (input as ElementHandle<HTMLInputElement>).uploadFile(file);
  } else {
    let upload = await control(page, 'upload');
    if (!upload) {
      const add = await control(page, 'add');
      if (!add) throw new Error('Flow has no supported add-material or upload action');
      await add.click(); await add.dispose();
      // The media picker loads asynchronously; do not confuse its library tabs with Upload.
      const deadline = Date.now() + 10_000;
      do {
        upload = await control(page, 'upload');
        if (!upload) await new Promise(resolve => setTimeout(resolve, 200));
      } while (!upload && Date.now() < deadline);
    }
    if (!upload) throw new Error('Flow media picker did not expose an upload action');
    const [chooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 15_000 }),
      upload.click(),
    ]);
    await upload.dispose();
    await chooser.accept([file]);
    target = 'native-file-chooser';
  }
  // File selection alone is not an upload receipt. Require the selected file
  // to appear on the Flow page; provider format/error messages stay explicit.
  const deadline = Date.now() + 90_000;
  let selectedFromPicker = false;
  let rightsAcknowledged = false;
  do {
    const rightsHandle = rightsAcknowledged ? null : await page.evaluateHandle(() => {
      if (!document.body.innerText.includes('必要权利') && !/necessary rights/iu.test(document.body.innerText)) return null;
      return [...document.querySelectorAll('button')].find(el => {
        const b = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return b.width > 0 && b.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && !el.disabled && /^(?:我同意|I agree)$/iu.test((el.innerText || '').trim());
      }) || null;
    });
    const rights = rightsHandle?.asElement();
    if (rights) {
      if (!options.confirmUploadRights) {
        await rightsHandle!.dispose();
        throw new Error('Flow requires upload-rights acknowledgement; pass confirmUploadRights only for authorized materials');
      }
      await (rights as ElementHandle<Element>).click();
      await rightsHandle!.dispose();
      rightsAcknowledged = true;
      continue;
    }
    await rightsHandle?.dispose();
    const evidence = await page.evaluate((labels) => {
      const matches = (text: string | null | undefined) => labels.some(name => text?.includes(name));
      const visible = (el: Element) => {
        const b = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return b.width > 0 && b.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      const alerts = [...document.querySelectorAll('[role="alert"]')].filter(visible)
        .map(el => el.textContent || '').filter(t => /上传失败|不支持|失败|unsupported|failed|too large/iu.test(t));
      const pending = [...document.querySelectorAll('button,[role="option"]')].filter(visible)
        .some(el => matches(el.textContent) && /正在上传|上传中|正在处理|uploading|processing/iu.test(el.textContent || ''));
      const inPicker = [...document.querySelectorAll('[role="option"]')].filter(visible)
        .some(el => matches(el.textContent));
      const filenameVisible = [...document.querySelectorAll('button,[role="option"],[title],[aria-label],img[alt]')].some(el => visible(el) &&
          [(el as HTMLElement).innerText, el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('alt')].some(matches));
      return { filenameVisible, pending, inPicker, error: alerts.join('; ') };
    }, names);
    if (evidence.error) throw new Error(`Flow rejected the uploaded material: ${evidence.error}`);
    if (evidence.filenameVisible && !evidence.pending && evidence.inPicker && !selectedFromPicker) {
      const handle = await page.evaluateHandle((labels) => {
        const candidates = [...document.querySelectorAll('[role="option"]')].filter(el => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && labels.some(name => (el.textContent || '').includes(name));
        });
        if (candidates.length !== 1) throw new Error('Uploaded filename is ambiguous in the media picker');
        return candidates[0];
      }, names);
      const choice = handle.asElement();
      if (!choice) throw new Error('Uploaded material is not selectable in the media picker');
      await (choice as ElementHandle<Element>).click(); await handle.dispose();
      selectedFromPicker = true;
      continue;
    }
    if (selectedFromPicker && evidence.inPicker && !evidence.pending) {
      const add = await control(page, 'attach');
      if (add) { await add.click(); await add.dispose(); }
    }
    if (evidence.filenameVisible && !evidence.pending && !evidence.inPicker) {
      return { uploaded: true, verified: true, file, target,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
        verification: { filenameVisible: true, uploadCompleted: true, selectedFromPicker } };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error('File selected but Flow did not visibly confirm the uploaded material; do not submit generation');
}
