import type { ElementHandle, Page } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { projectScope, storedAsset, rememberAsset, type StoredAsset } from './asset-cache.js';

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

export async function uploadNewAsset(page: Page, file: string, options: UploadOptions = {}) {
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

async function attachStoredAsset(page: Page, asset: StoredAsset): Promise<string> {
  const labels = [asset.filename, path.parse(asset.filename).name];
  const inspect = () => page.evaluate((names) => {
    const visible = (el: Element) => { const b=el.getBoundingClientRect(); const s=getComputedStyle(el); return b.width>0 && b.height>0 && s.visibility!=='hidden' && s.display!=='none'; };
    const matches = (el: Element) => [el.textContent, (el as HTMLElement).innerText?.replace(/\s+/g,''), el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('alt')]
      .some(text => names.some(name => text?.trim()===name || text?.trim()===name+'图片' || text?.trim()===name+'视频' || text?.trim()===name+'音频'));
    const options=[...document.querySelectorAll('[role="option"]')].filter(visible);
    const choices=options.filter(matches);
    const materials=[...document.querySelectorAll('.base-prompt-box flow-ingredient-chip img,.base-prompt-box flow-ingredient-chip video,.base-prompt-box flow-ingredient-chip audio')].filter(visible)
      .filter(el=>el.closest('button')?.getAttribute('aria-busy')!=='true')
      .map(el=>{try{const u=new URL((el as HTMLImageElement).src);return u.origin+u.pathname;}catch{return '';}}).filter(Boolean);
    return {choices:choices.length, picker:options.length>0, materials};
  }, labels);
  let state=await inspect();
  if (asset.mediaId && state.materials.includes(asset.mediaId) && !state.picker) return asset.mediaId;
  const before=new Set(state.materials);
  if (!state.picker) {
    let add=await control(page,'add');
    const readyDeadline=Date.now()+10_000;
    while(!add && Date.now()<readyDeadline){
      await new Promise(resolve=>setTimeout(resolve,200));
      add=await control(page,'add');
    }
    if (!add) throw new Error('Flow has no supported material picker for asset reuse');
    await add.click(); await add.dispose();
  }
  const deadline=Date.now()+10_000;
  do {
    state=await inspect();
    if (state.choices>1) throw new Error('Stored Flow asset is ambiguous in the media picker');
    if (state.choices===1) break;
    await new Promise(resolve=>setTimeout(resolve,200));
  } while(Date.now()<deadline);
  if (!state.choices) throw new Error('Stored Flow asset is not currently visible in this project; not uploading a duplicate');
  const handle=await page.evaluateHandle((names)=> {
    const choices=[...document.querySelectorAll('[role="option"]')].filter(el=> {
      const b=el.getBoundingClientRect();
      const texts=[el.textContent,(el as HTMLElement).innerText?.replace(/\s+/g,''),el.getAttribute('title'),el.getAttribute('aria-label'),el.getAttribute('alt')];
      const style=getComputedStyle(el);
      return b.width>0 && b.height>0 && style.visibility!=='hidden' && style.display!=='none' && texts.some(text=>names.some(name=>text?.trim()===name || text?.trim()===name+'图片' || text?.trim()===name+'视频' || text?.trim()===name+'音频'));
    });
    if(choices.length!==1) throw new Error('Stored Flow asset changed before selection');
    return choices[0];
  },labels);
  const choice=handle.asElement() as ElementHandle<Element> | null;
  if (!choice) throw new Error('Stored Flow asset is not selectable');
  if (await choice.evaluate(el=>el.getAttribute('aria-selected')!=='true')) await choice.click();
  await handle.dispose();
  const attach=await control(page,'attach');
  if(attach){await attach.click();await attach.dispose();}
  const attachedDeadline=Date.now()+10_000;
  do {
    state=await inspect();
    const added=state.materials.filter(id=>!before.has(id));
    if(!state.picker && added.length===1) return added[0];
    if(!state.picker && asset.mediaId && state.materials.includes(asset.mediaId)) return asset.mediaId;
    await new Promise(resolve=>setTimeout(resolve,200));
  }while(Date.now()<attachedDeadline);
  throw new Error('Stored Flow asset was selected but not attached to the prompt');
}

/** Same bytes in one browser profile and Flow project are attached, not uploaded again. */
export async function uploadLocalAsset(page: Page, file: string, options: UploadOptions = {}) {
  // Explicit file-input operations retain their original contract.
  const project=options.ref || options.selector ? null : projectScope(typeof page.url==='function' ? page.url() : '');
  if(!project) return uploadNewAsset(page,file,options);
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const known=storedAsset(project,sha256);
  if(known) {
    const mediaId=await attachStoredAsset(page,known);
    rememberAsset(project,{...known,mediaId});
    return {uploaded:true, uploadedNow:false, reused:true, verified:true, file, sha256, projectId:project,
      target:'project-material-library', assetName:known.filename,mediaId,
      verification:{filenameVisible:true,uploadCompleted:true,selectedFromPicker:true}};
  }
  // Content-addressed names prevent a changed same-name file matching an old card.
  const parsed=path.parse(file);
  const filename=`${parsed.name.slice(0,80)}-${sha256.slice(0,16)}${parsed.ext}`;
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'flow-material-'));
  const staged=path.join(temporary,filename);
  const promptIds=async (): Promise<string[]> => {
    const values=await page.evaluate(()=>[...document.querySelectorAll('.base-prompt-box flow-ingredient-chip img,.base-prompt-box flow-ingredient-chip video,.base-prompt-box flow-ingredient-chip audio')]
      .map(el=>{try{const u=new URL((el as HTMLImageElement).src);return u.origin+u.pathname;}catch{return '';}}).filter(Boolean));
    return Array.isArray(values) ? values : [];
  };
  try {
    const before=new Set(await promptIds());
    fs.copyFileSync(file,staged);
    const result=await uploadNewAsset(page,staged,options);
    const added=(await promptIds()).filter(id=>!before.has(id));
    const mediaId=added.length===1 ? added[0] : undefined;
    rememberAsset(project,{filename,sha256,mediaId});
    return {...result,file,projectId:project,assetName:filename,mediaId,uploadedNow:true,reused:false};
  } finally {if(fs.existsSync(staged))fs.unlinkSync(staged);fs.rmdirSync(temporary);}
}
