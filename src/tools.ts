import { ElementHandle } from 'puppeteer-core';
import { browser, sleep, resolveOutputPath, detectMediaType, MediaType } from './browser.js';
import { captureSnapshot } from './snapshot.js';
import { paidGuard } from './guard.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

type SubmitControlInput = { text?: string; aria?: string; disabled?: boolean };
type SubmissionResponseInput = { method: string; url: string; status: number };

export function classifyGenerationSubmitControl(
  control: SubmitControlInput,
  pageText: string,
): { isSubmit: boolean; isPaid: boolean; enabled: boolean } {
  const label = `${control.text || ''} ${control.aria || ''}`.toLowerCase();
  const context = pageText.toLowerCase();
  const isSubmit = /(?:generate|create|submit|arrow_forward|开始生成|生成)/u.test(label);
  const isPaidGenerationContext = /(?:video|视频|veo|omni|flow\s*music|ask producer|instrumental|lyria|\b(?:4|6|8|10)\s*(?:秒|s|seconds?)\b)/u.test(`${label} ${context}`);
  return { isSubmit, isPaid: isSubmit && isPaidGenerationContext, enabled: control.disabled !== true };
}

export function classifyGenerationSubmissionResponse(
  response: SubmissionResponseInput,
): { acknowledged: boolean; status: number } {
  const endpoint = /(?:flowCreationAgent|flowAppletAgent|flowWorkflows|batchGenerate|batchCreate|generateVideo|createVideo)/iu.test(response.url);
  return {
    acknowledged: response.method.toUpperCase() === 'POST' && endpoint && response.status >= 200 && response.status < 400,
    status: response.status,
  };
}

export function classifyGenerationSubmitTransition(
  transition: { beforeDisabled: boolean; afterDisabled: boolean },
): { acknowledged: boolean; source: 'ui_submit_state' } {
  return {
    acknowledged: transition.beforeDisabled === false && transition.afterDisabled === true,
    source: 'ui_submit_state',
  };
}

export function classifyGenerationAudioTransition(
  transition: { before: string[]; after: string[] },
): { acknowledged: boolean; source: 'ui_new_audio' } {
  const before = new Set(transition.before.filter(Boolean));
  return { acknowledged: transition.after.some((url) => Boolean(url) && !before.has(url)), source: 'ui_new_audio' };
}

// ─── Tool definitions (MCP schema) ───────────────────────────────────────────

export const TOOLS = [
  {
    name: 'flow_open',
    description:
      'Open Google Flow in the browser. Navigates to labs.google/fx/tools/flow, or a specific project/tool URL. ' +
      'Always call this first before other tools if the browser is not yet on a Flow page.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to navigate to (overrides projectId/toolId).' },
        projectId: { type: 'string', description: 'Google Flow project ID.' },
        toolId: { type: 'string', description: 'Tool ID within a project.' },
      },
    },
  },
  {
    name: 'flow_snapshot',
    description:
      'Inspect the current Google Flow page. Returns a structured list of all interactable elements ' +
      '(with ref IDs like el_1, el_2), visible media (img_1, vid_1), and any captured asset URLs from the network. ' +
      'Use this to understand the current UI state before clicking or typing.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'flow_close',
    description: 'Close the browser launched by this MCP server and release the Chrome profile.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flow_click',
    description:
      'Click a UI element on the Google Flow page. Identify the target using a ref ID from flow_snapshot (preferred), ' +
      'a CSS selector, visible text, or aria-label. Returns success and the current page URL after the click.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref ID from flow_snapshot (e.g. "el_3"). Preferred.' },
        selector: { type: 'string', description: 'CSS selector of the target element.' },
        text: { type: 'string', description: 'Visible text of the target element (partial match).' },
        ariaLabel: { type: 'string', description: 'aria-label of the target element.' },
        requireGenerationAcknowledgement: { type: 'boolean', description: 'Require a successful Flow generation POST response after clicking a generation submit control.' },
        acknowledgementTimeoutMs: { type: 'number', description: 'Maximum time to wait for generation submission acknowledgement (default 30000ms).' },
      },
    },
  },
  {
    name: 'flow_type',
    description:
      'Type text into an input field, textarea, or contenteditable on the current Flow page. ' +
      'Use ref from flow_snapshot to target precisely. Submit generation prompts separately with flow_click.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'Text to type.' },
        ref: { type: 'string', description: 'Element ref ID from flow_snapshot.' },
        selector: { type: 'string', description: 'CSS selector of the input field.' },
        placeholder: { type: 'string', description: 'Placeholder text to find the input by.' },
        clearFirst: { type: 'boolean', description: 'Clear existing content before typing (default false).' },
        submit: { type: 'boolean', description: 'Deprecated. Generation submission must use the dedicated submit control with flow_click.' },
      },
    },
  },
  {
    name: 'flow_upload',
    description: 'Upload a local file into the current Google Flow page (e.g. a reference image or dossier).',
    inputSchema: {
      type: 'object',
      required: ['filePath'],
      properties: {
        filePath: { type: 'string', description: 'Absolute local path to the file to upload.' },
        ref: { type: 'string', description: 'File input element ref ID from flow_snapshot.' },
        selector: { type: 'string', description: 'CSS selector of the file input element.' },
      },
    },
  },
  {
    name: 'flow_download',
    description:
      'Download a generated image, video, or audio asset from Google Flow to a local folder. ' +
      'Call after flow_wait completes. Saves to LOCAL_STORAGE_ROOT or a custom outputPath.',
    inputSchema: {
      type: 'object',
      properties: {
        assetUrl: { type: 'string', description: 'Direct URL of the asset to download.' },
        mediaRef: { type: 'string', description: 'Media ref ID from flow_snapshot (e.g. img_1, vid_1).' },
        outputPath: {
          type: 'string',
          description: 'Local folder or file path. Defaults to LOCAL_STORAGE_ROOT or ./media.',
        },
        expectedMediaType: {
          type: 'string',
          enum: ['image', 'video', 'audio'],
          description: 'Reject the download if its binary content is a different media type.',
        },
      },
    },
  },
  {
    name: 'flow_wait',
    description:
      'Wait for the Google Flow page to reach a desired state. Use forMedia:true to wait for a generation to complete. ' +
      'Use forSelector or forText for specific UI conditions. Use timeoutMs to set max wait time (default 60000ms).',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', description: 'Max wait time in milliseconds (default 60000).' },
        forSelector: { type: 'string', description: 'Wait until this CSS selector appears.' },
        forText: { type: 'string', description: 'Wait until this text appears anywhere on the page.' },
        forMedia: { type: 'boolean', description: 'Wait until a new generated image, video, or audio asset is detected.' },
        mediaType: {
          type: 'string',
          enum: ['image', 'video', 'audio'],
          description: 'Only return a newly generated asset of this media type.',
        },
      },
    },
  },
  {
    name: 'flow_confirm_paid_generation',
    description:
      'Authorize a single paid generation action (e.g. Veo video). Must be called before clicking Generate on ' +
      'any paid Veo or Omni model. Requires explicit confirmation and a credit budget limit. ' +
      'Authorization is single-use and expires after 5 minutes.',
    inputSchema: {
      type: 'object',
      required: ['confirm', 'maxBudgetCredits'],
      properties: {
        confirm: { type: 'boolean', description: 'Must be true to authorize.' },
        maxBudgetCredits: { type: 'number', description: 'Max credits allowed for this generation.' },
        reason: { type: 'string', description: 'Optional note about what is being generated.' },
      },
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

type Args = Record<string, any>;
type ToolResult = { content: { type: 'text'; text: string }[] };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export async function handleTool(name: string, args: Args): Promise<ToolResult> {
  switch (name) {

    // ── flow_open ─────────────────────────────────────────────────────────────
    case 'flow_open': {
      const url = browser.buildFlowUrl(args);
      const result = await browser.navigate(url);
      return ok({ opened: true, ...result });
    }

    // ── flow_snapshot ─────────────────────────────────────────────────────────
    case 'flow_snapshot': {
      const page = await browser.getPage();
      const snap = await captureSnapshot(page, []);
      return ok(snap);
    }

    case 'flow_close': {
      await browser.close();
      return ok({ closed: true });
    }

    // ── flow_click ────────────────────────────────────────────────────────────
    case 'flow_click': {
      const page = await browser.getPage();
      let el: ElementHandle<Element> | null = null;
      let target = '';

      if (args.ref) {
        el = await page.$(`[data-flow-ref="${args.ref}"]`);
        if (el) target = `ref:${args.ref}`;
      }
      if (!el && args.selector) {
        el = await page.$(args.selector);
        if (el) target = `selector:${args.selector}`;
      }
      if (!el && args.ariaLabel) {
        el = await page.$(`[aria-label="${args.ariaLabel}"]`);
        if (el) target = `ariaLabel:${args.ariaLabel}`;
      }
      if (!el && args.text) {
        const candidates = await page.$$('button, a, [role="button"], [role="menuitem"], [role="option"], [role="tab"], span, div, p');
        for (const c of candidates) {
          const txt = await page.evaluate((e: any) => (e.innerText || e.textContent || '').trim(), c);
          if (txt.toLowerCase().includes((args.text as string).toLowerCase())) {
            el = c; target = `text:"${args.text}"`;
            break;
          }
        }
      }

      if (!el) throw new Error(`Click target not found: ${JSON.stringify(args)}`);

      // Check if this is a paid action
      const elInfo = await el.evaluate((e: any) => ({
        text: (e.innerText || e.textContent || '').toLowerCase(),
        aria: (e.getAttribute('aria-label') || '').toLowerCase(),
        disabled: e.hasAttribute('disabled') || e.getAttribute('aria-disabled') === 'true',
      }));
      const combined = `${elInfo.text} ${elInfo.aria} ${args.text || ''} ${args.ariaLabel || ''}`.toLowerCase();
      const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      const submitControl = classifyGenerationSubmitControl(elInfo, pageText);
      const isPaidModel = combined.includes('veo') || combined.includes('omni');
      const isVideoAction = (combined.includes('video') || combined.includes('animate')) &&
        (combined.includes('generate') || combined.includes('create'));
      const isSubmit = submitControl.isSubmit;
      const isMusicSubmission = isSubmit && /(?:flow\s*music|ask producer|instrumental|lyria)/u.test(pageText.toLowerCase());
      if (isSubmit && !submitControl.enabled) throw new Error(`Generation submit control is disabled: ${target}`);

      if (isPaidModel || isVideoAction || submitControl.isPaid) {
        paidGuard.consume(`click on "${target}"`, 10);
      }

      // Mark generation start if this looks like a submit action
      if (isSubmit) await browser.markGenerationStart();

      const baselineAudioUrls = isMusicSubmission
        ? await page.evaluate(() => Array.from(document.querySelectorAll('audio')).map((audio: any) => audio.currentSrc || audio.src || '').filter(Boolean)).catch(() => [] as string[])
        : [];

      const acknowledgementTimeoutMs = Number(args.acknowledgementTimeoutMs ?? 30_000);
      const generationAcknowledgement = isSubmit && args.requireGenerationAcknowledgement === true
        ? Promise.race([
            page.waitForResponse((response) => {
              const request = response.request();
              return request.method().toUpperCase() === 'POST' &&
                /(?:flowCreationAgent|flowAppletAgent|flowWorkflows|batchGenerate|batchCreate|generateVideo|createVideo)/iu.test(response.url());
            }, { timeout: acknowledgementTimeoutMs }).then((response) => ({ source: 'network' as const, response })),
            page.waitForFunction(
              (expected: { aria: string; text: string }) => Array.from(document.querySelectorAll('button, [role="button"]')).some((element) => {
                const htmlElement = element as HTMLElement;
                const label = `${htmlElement.innerText || htmlElement.textContent || ''} ${element.getAttribute('aria-label') || ''}`.toLowerCase();
                const sameControl = expected.aria
                  ? label.includes(expected.aria)
                  : expected.text
                    ? label.includes(expected.text)
                    : /(?:开始生成|generate|create|arrow_forward)/u.test(label);
                return sameControl && (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true');
              }),
              { timeout: acknowledgementTimeoutMs, polling: 100 },
              { aria: elInfo.aria, text: elInfo.text },
            ).then(() => ({ source: 'ui_submit_state' as const })),
            ...(isMusicSubmission ? [page.waitForFunction(
              (before: string[]) => Array.from(document.querySelectorAll('audio')).some((audio: any) => {
                const source = audio.currentSrc || audio.src || '';
                return source && !before.includes(source);
              }),
              { timeout: acknowledgementTimeoutMs, polling: 250 },
              baselineAudioUrls,
            ).then(() => ({ source: 'ui_new_audio' as const }))] : []),
          ])
        : null;

      // Dispatch exactly one trusted click. Never mutate disabled state to force
      // a paid submission.
      await el.evaluate((e: any) => {
        e.scrollIntoView?.({ block: 'center' });
      });
      await el.click();
      if (generationAcknowledgement) {
        const acknowledgement = await generationAcknowledgement;
        if (acknowledgement.source === 'ui_submit_state') {
          const transition = classifyGenerationSubmitTransition({ beforeDisabled: elInfo.disabled, afterDisabled: true });
          if (!transition.acknowledged) throw new Error('Flow did not acknowledge generation submission');
          return ok({ clicked: true, target, url: page.url(), submissionAcknowledged: true, acknowledgementSource: transition.source });
        }
        if (acknowledgement.source === 'ui_new_audio') {
          const afterAudioUrls = await page.evaluate(() => Array.from(document.querySelectorAll('audio')).map((audio: any) => audio.currentSrc || audio.src || '').filter(Boolean));
          const transition = classifyGenerationAudioTransition({ before: baselineAudioUrls, after: afterAudioUrls });
          if (!transition.acknowledged) throw new Error('Flow Music did not expose a new generated audio asset');
          return ok({ clicked: true, target, url: page.url(), submissionAcknowledged: true, acknowledgementSource: transition.source });
        }
        const response = acknowledgement.response;
        const classified = classifyGenerationSubmissionResponse({
          method: response.request().method(),
          url: response.url(),
          status: response.status(),
        });
        if (!classified.acknowledged) throw new Error(`Flow rejected generation submission with HTTP ${classified.status}`);
        return ok({ clicked: true, target, url: page.url(), submissionAcknowledged: true, acknowledgementSource: 'network', responseStatus: classified.status });
      }
      await sleep(800);

      return ok({ clicked: true, target, url: page.url() });
    }

    // ── flow_type ─────────────────────────────────────────────────────────────
    case 'flow_type': {
      if (!args.text) throw new Error('text is required for flow_type');
      const page = await browser.getPage();
      let el: ElementHandle<Element> | null = null;
      let target = '';

      if (args.ref) {
        el = await page.$(`[data-flow-ref="${args.ref}"]`);
        if (el) target = `ref:${args.ref}`;
      }
      if (!el && args.selector) {
        el = await page.$(args.selector);
        if (el) target = `selector:${args.selector}`;
      }
      if (!el && args.placeholder) {
        el = await page.$(`[placeholder*="${args.placeholder}" i]`);
        if (el) target = `placeholder:"${args.placeholder}"`;
      }
      // Auto-detect common input types
      if (!el) {
        for (const sel of [
          'textarea', '[contenteditable="true"]', '[role="textbox"]',
          'input[type="text"]', 'input:not([type])', '.ql-editor',
        ]) {
          el = await page.$(sel);
          if (el) { target = `auto:${sel}`; break; }
        }
      }

      if (!el) throw new Error(`Type target not found: ${JSON.stringify(args)}`);

      try { await el.click(); } catch {}
      await el.focus();
      await sleep(200);

      if (args.clearFirst) {
        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
        await page.keyboard.down(modifier);
        await page.keyboard.press('a');
        await page.keyboard.up(modifier);
        await page.keyboard.press('Backspace');
        await sleep(100);
      }

      await page.keyboard.type(args.text as string, { delay: 15 });

      // Dispatch React-compatible events
      await el.evaluate((e: any) => {
        e.dispatchEvent(new Event('input', { bubbles: true }));
        e.dispatchEvent(new Event('change', { bubbles: true }));
      });

      const observedText = await el.evaluate((e: any) =>
        typeof e.value === 'string' ? e.value : (e.textContent || ''),
      );
      if (observedText !== args.text) throw new Error('Flow prompt composer did not retain the exact typed text');

      if (args.submit) {
        throw new Error('flow_type submit:true is unsupported; use the dedicated generation submit control with flow_click');
      }

      return ok({ typed: true, verified: true, target, length: (args.text as string).length });
    }

    // ── flow_upload ───────────────────────────────────────────────────────────
    case 'flow_upload': {
      if (!args.filePath) throw new Error('filePath is required for flow_upload');
      const absPath = path.resolve((args.filePath as string).replace('~', os.homedir()));
      if (!fs.existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

      const page = await browser.getPage();
      let inputEl: ElementHandle<HTMLInputElement> | null = null;
      let target = '';

      if (args.ref) {
        inputEl = await page.$(`[data-flow-ref="${args.ref}"]`) as any;
        if (inputEl) target = `ref:${args.ref}`;
      }
      if (!inputEl && args.selector) {
        inputEl = await page.$(args.selector) as any;
        if (inputEl) target = `selector:${args.selector}`;
      }
      if (!inputEl) {
        inputEl = await page.$('input[type="file"]') as any;
        if (inputEl) target = 'auto:input[type=file]';
      }

      if (!inputEl) throw new Error('No file input element found on page');
      await inputEl.uploadFile(absPath);
      await sleep(1500);

      return ok({ uploaded: true, file: absPath, target });
    }

    // ── flow_download ─────────────────────────────────────────────────────────
    case 'flow_download': {
      const page = await browser.getPage();
      let assetUrl: string | undefined = args.assetUrl;
      let assetMediaType: MediaType | undefined = args.expectedMediaType as MediaType | undefined;

      // Resolve from media ref if no direct URL
      if (!assetUrl && args.mediaRef) {
        const resolved = await page.evaluate((ref: string) => {
          const el = document.querySelector(`[data-flow-media-ref="${ref}"]`) as any;
          if (!el) return null;
          return {
            url: el.src || el.currentSrc || null,
            mediaType: el.tagName === 'VIDEO' ? 'video' : el.tagName === 'AUDIO' ? 'audio' : 'image',
          };
        }, args.mediaRef as string);
        if (resolved) {
          assetUrl = resolved.url;
          assetMediaType = assetMediaType || (resolved.mediaType as MediaType);
        }
      }

      // Fall back to latest captured asset from network
      if (!assetUrl) {
        const latest = await browser.getLatestGeneratedAsset(assetMediaType);
        if (latest) {
          assetUrl = latest.url;
          assetMediaType = assetMediaType || latest.mediaType;
        }
      }

      if (!assetUrl) throw new Error('No asset URL found. Run flow_wait first, or provide assetUrl or mediaRef.');

      const outputRoot = (args.outputPath as string) ||
        process.env.LOCAL_STORAGE_ROOT ||
        path.join(process.cwd(), 'media');

      let localPath = resolveOutputPath(outputRoot, assetUrl, assetMediaType);
      const buf = await browser.downloadAsset(assetUrl, localPath, page);
      const detectedMediaType = detectMediaType(buf, assetMediaType);
      if (
        assetMediaType &&
        detectedMediaType !== 'unknown' &&
        detectedMediaType !== assetMediaType
      ) {
        throw new Error(
          `Generated asset type mismatch: expected ${assetMediaType}, detected ${detectedMediaType}. ` +
          'The file was not written.'
        );
      }
      fs.writeFileSync(localPath, buf);

      return ok({
        downloaded: true,
        localPath,
        bytes: buf.length,
        assetUrl,
        mediaType: detectedMediaType === 'unknown' ? assetMediaType || 'unknown' : detectedMediaType,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      });
    }

    // ── flow_wait ─────────────────────────────────────────────────────────────
    case 'flow_wait': {
      const page = await browser.getPage();
      const timeout = (args.timeoutMs as number) ?? 60000;
      const start = Date.now();

      if (args.forSelector) {
        await page.waitForSelector(args.forSelector as string, { timeout });
        return ok({ done: true, elapsed: Date.now() - start, reason: `selector "${args.forSelector}" appeared` });
      }

      if (args.forText) {
        const target = (args.forText as string).toLowerCase();
        while (Date.now() - start < timeout) {
          const body = await page.evaluate(() => document.body.innerText.toLowerCase());
          if (body.includes(target)) {
            return ok({ done: true, elapsed: Date.now() - start, reason: `text "${args.forText}" appeared` });
          }
          await sleep(1000);
        }
        throw new Error(`Timed out waiting for text: "${args.forText}"`);
      }

      if (args.forMedia) {
        const expectedMediaType = args.mediaType as MediaType | undefined;
        while (Date.now() - start < timeout) {
          const asset = await browser.getLatestGeneratedAsset(expectedMediaType);
          if (asset) {
            return ok({
              done: true,
              elapsed: Date.now() - start,
              reason: `media detected from ${asset.source}`,
              assetUrl: asset.url,
              mediaType: asset.mediaType,
              mimeType: asset.mimeType,
              jobId: asset.jobId,
            });
          }
          if (expectedMediaType === 'video') {
            await browser.openLatestGeneratedVideoResult();
          }
          await sleep(1500);
        }
        throw new Error(`Timed out (${timeout}ms) waiting for generated media. The generation may still be running.`);
      }

      // Default: just sleep
      const ms = Math.min(timeout, 5000);
      await sleep(ms);
      return ok({ done: true, elapsed: ms, reason: 'sleep completed' });
    }

    // ── flow_confirm_paid_generation ──────────────────────────────────────────
    case 'flow_confirm_paid_generation': {
      if (!args.confirm) {
        paidGuard.revoke();
        return ok({ confirmed: false, status: 'Authorization revoked' });
      }
      const state = paidGuard.confirm({
        maxBudgetCredits: args.maxBudgetCredits as number,
        reason: args.reason as string | undefined,
      });
      return ok({ confirmed: true, guardState: state });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
