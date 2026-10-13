import type {Page} from 'puppeteer-core';

export type EditScope = {startSeconds: number; endSeconds?: number};
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

export function videoEditorUrl(projectId: string, assetId: string): string {
  if (!uuid.test(projectId) || !uuid.test(assetId)) throw new Error('projectId and assetId must be Flow UUIDs');
  return `https://flow.google.com/project/${projectId}/edit/${assetId}`;
}

export function editInstruction(instruction: string, scope?: EditScope): string {
  if (typeof instruction !== 'string' || !instruction.trim()) throw new Error('An edit instruction is required');
  if (!scope) return instruction.trim();
  if (!Number.isFinite(scope.startSeconds) || scope.startSeconds < 0 ||
      (scope.endSeconds !== undefined && (!Number.isFinite(scope.endSeconds) || scope.endSeconds <= scope.startSeconds))) {
    throw new Error('Scope requires nonnegative startSeconds and endSeconds greater than startSeconds');
  }
  return `${instruction.trim()}\nRequested temporal scope: ${scope.endSeconds === undefined
    ? `the frame at ${scope.startSeconds} seconds`
    : `${scope.startSeconds}–${scope.endSeconds} seconds`}. Preserve the rest of the video.`;
}

/** Public editor UI only; never interprets a scene trim as a model edit mask. */
export async function inspectVideoEditor(page: Page) {
  const url = new URL(page.url());
  const identity = /^\/project\/([0-9a-f-]{36})\/edit\/([0-9a-f-]{36})\/?$/iu.exec(url.pathname);
  if (url.hostname !== 'flow.google.com' || !identity) throw new Error('Open an existing Flow asset editor first');
  const state = await page.evaluate(() => {
    const visible = (el: Element) => {const r=el.getBoundingClientRect();return r.width>0 && r.height>0 && getComputedStyle(el).visibility !== 'hidden';};
    const prompts = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')].filter(visible);
    const submits = [...document.querySelectorAll('button.generate-icon-button')].filter(visible);
    const clips = [...document.querySelectorAll('.timeline-contents .clip')];
    return {
      promptCount: prompts.length,
      prompt: (prompts[0] as HTMLElement | undefined)?.innerText ?? '',
      submitCount: submits.length,
      submitEnabled: submits.length===1 && !(submits[0] as HTMLButtonElement).disabled,
      title: (document.querySelector('input.editable-text-input') as HTMLInputElement | null)?.value ?? '',
      timeline: {clipCount: clips.length, selectedClipCount: clips.filter(e=>e.classList.contains('selected')).length,
        trimHandles: document.querySelectorAll('.timeline-contents .trim-handle').length,
        playbackReady: [...document.querySelectorAll('video')].some(v=>Number.isFinite(v.duration)&&v.duration>0),
        playerTimes: [...document.querySelectorAll('[class*="time"]')].filter(e=>e.children.length===0 && /^\d\d:\d\d:\d\d$/.test(e.textContent?.trim()??'')).map(e=>e.textContent?.trim()),
      },
    };
  });
  return {editorUrl: url.origin+url.pathname, projectId: identity[1], assetId: identity[2], ...state,
    capabilities: {conversationalEdit: state.promptCount===1 && state.submitCount===1 && state.timeline.clipCount>0,
      sceneTrimming: state.timeline.trimHandles>0, enforcedTemporalEdit: false, singleFrameOnlyEdit: false,
      temporalScopeMode: 'prompt_request_only',
      note: 'Scene trim handles do not establish an edit mask. Exact frame/range model edits have not been verified on this editor.'}};
}

export async function prepareVideoEdit(page: Page, expectedUrl: string, instruction: string, scope?: EditScope) {
  const text = editInstruction(instruction, scope);
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', {visible:true, timeout:15000});
  const state = await inspectVideoEditor(page);
  if (state.editorUrl !== expectedUrl || !state.capabilities.conversationalEdit) throw new Error('Requested video editor is unavailable');
  if (state.prompt.trim() && state.prompt.trim() !== text) throw new Error('Editor has an existing unsent draft; not replacing it');
  if (!state.prompt.trim()) {
    const prompt = await page.$('.ProseMirror[contenteditable="true"]');
    await prompt!.click();
    await page.keyboard.sendCharacter(text);
  }
  const prepared = await inspectVideoEditor(page);
  if (prepared.editorUrl !== expectedUrl || prepared.prompt !== text) throw new Error('Edit draft readback did not match the selected asset/instruction');
  return {...prepared, prepared:true, submitted:false, requestedScope:scope ?? null,
    submitSelector:'button.generate-icon-button'};
}
