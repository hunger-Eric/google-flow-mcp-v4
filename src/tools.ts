import { ElementHandle } from 'puppeteer-core';
import { browser, sleep, resolveOutputPath } from './browser.js';
import { captureSnapshot } from './snapshot.js';
import { paidGuard } from './guard.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
      },
    },
  },
  {
    name: 'flow_type',
    description:
      'Type text into an input field, textarea, or contenteditable on the current Flow page. ' +
      'Use ref from flow_snapshot to target precisely. Set submit:true to press Enter after typing.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'Text to type.' },
        ref: { type: 'string', description: 'Element ref ID from flow_snapshot.' },
        selector: { type: 'string', description: 'CSS selector of the input field.' },
        placeholder: { type: 'string', description: 'Placeholder text to find the input by.' },
        clearFirst: { type: 'boolean', description: 'Clear existing content before typing (default false).' },
        submit: { type: 'boolean', description: 'Press Enter after typing (default false).' },
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
      'Download a generated asset (image or video) from Google Flow to a local folder. ' +
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
        forMedia: { type: 'boolean', description: 'Wait until a new generated image or video is detected.' },
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
      const snap = await captureSnapshot(page, browser.getCapturedAssets());
      return ok(snap);
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
      }));
      const combined = `${elInfo.text} ${elInfo.aria} ${args.text || ''} ${args.ariaLabel || ''}`.toLowerCase();
      const isPaidModel = combined.includes('veo') || combined.includes('omni');
      const isVideoAction = (combined.includes('video') || combined.includes('animate')) &&
        (combined.includes('generate') || combined.includes('create'));

      if (isPaidModel || isVideoAction) {
        paidGuard.consume(`click on "${target}"`, 10);
      }

      // Mark generation start if this looks like a submit action
      const isSubmit = combined.includes('generate') || combined.includes('create') ||
        combined.includes('arrow_forward') || combined.includes('submit');
      if (isSubmit) browser.markGenerationStart();

      // Click: scroll into view, remove disabled attrs, click
      await el.evaluate((e: any) => {
        e.scrollIntoView?.({ block: 'center' });
        e.removeAttribute?.('disabled');
        e.removeAttribute?.('aria-disabled');
        e.click?.();
      });
      try { await el.click(); } catch {}
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
        await page.keyboard.down('Meta');
        await page.keyboard.press('a');
        await page.keyboard.up('Meta');
        await page.keyboard.press('Backspace');
        await sleep(100);
      }

      await page.keyboard.type(args.text as string, { delay: 15 });

      // Dispatch React-compatible events
      await el.evaluate((e: any) => {
        e.dispatchEvent(new Event('input', { bubbles: true }));
        e.dispatchEvent(new Event('change', { bubbles: true }));
      });

      if (args.submit) {
        browser.markGenerationStart();
        await sleep(200);
        await page.keyboard.press('Enter');
        await sleep(1000);
      }

      return ok({ typed: true, target, length: (args.text as string).length });
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

      // Resolve from media ref if no direct URL
      if (!assetUrl && args.mediaRef) {
        assetUrl = await page.evaluate((ref: string) => {
          const el = document.querySelector(`[data-flow-media-ref="${ref}"]`) as any;
          return el ? (el.src || el.currentSrc || null) : null;
        }, args.mediaRef as string);
      }

      // Fall back to latest captured asset from network
      if (!assetUrl) {
        const latest = await browser.getLatestGeneratedAsset();
        if (latest) assetUrl = latest.url;
      }

      if (!assetUrl) throw new Error('No asset URL found. Run flow_wait first, or provide assetUrl or mediaRef.');

      const outputRoot = (args.outputPath as string) ||
        process.env.LOCAL_STORAGE_ROOT ||
        path.join(process.cwd(), 'media');

      const localPath = resolveOutputPath(outputRoot, assetUrl);
      const buf = await browser.downloadAsset(assetUrl, localPath, page);
      fs.writeFileSync(localPath, buf);

      return ok({ downloaded: true, localPath, bytes: buf.length, assetUrl });
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
        while (Date.now() - start < timeout) {
          const asset = await browser.getLatestGeneratedAsset();
          if (asset) {
            return ok({
              done: true,
              elapsed: Date.now() - start,
              reason: `media detected from ${asset.source}`,
              assetUrl: asset.url,
            });
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
