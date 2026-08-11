import type { Page } from 'puppeteer-core';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InteractableElement {
  ref: string;           // e.g. "el_3" — pass to flow_click or flow_type
  tag: string;           // HTML tag name
  role?: string;
  type?: string;         // for inputs
  text?: string;         // visible text (truncated)
  placeholder?: string;
  ariaLabel?: string;
  value?: string;        // current value of inputs/textareas
  selector: string;      // best CSS selector for this element
  visible: boolean;
  disabled: boolean;
}

export interface MediaElement {
  ref: string;           // e.g. "img_1" or "vid_2" — pass to flow_download
  kind: 'image' | 'video';
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  poster?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  interactables: InteractableElement[];
  media: MediaElement[];
  capturedAssets: string[];   // network-intercepted asset URLs (for download)
  summary: {
    inputs: number;
    buttons: number;
    media: number;
    total: number;
  };
}

// ─── Snapshot capture ─────────────────────────────────────────────────────────

export async function captureSnapshot(page: Page, capturedAssets: string[]): Promise<PageSnapshot> {
  const url = page.url();
  const title = await page.title();

  // Use Function string to avoid esbuild tsx __name injection into browser context
  const evalFn = new Function(`
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    };

    const snippet = (el) => {
      return ((el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100));
    };

    const bestSelector = (el, ref) => {
      if (el.id) return '#' + CSS.escape(el.id);
      const aria = el.getAttribute('aria-label');
      if (aria) return el.tagName.toLowerCase() + '[aria-label="' + CSS.escape(aria) + '"]';
      const name = el.getAttribute('name');
      if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
      const ph = el.getAttribute('placeholder');
      if (ph) return el.tagName.toLowerCase() + '[placeholder="' + CSS.escape(ph) + '"]';
      return '[data-flow-ref="' + ref + '"]';
    };

    const QUERY = [
      'button', 'input', 'textarea', 'select', 'a[href]',
      '[contenteditable="true"]', '[role="button"]', '[role="textbox"]',
      '[role="option"]', '[role="tab"]', '[role="menuitem"]',
      '[role="combobox"]', '[tabindex]:not([tabindex="-1"])'
    ].join(', ');

    const interactables = [];
    let refN = 1;

    for (const el of Array.from(document.querySelectorAll(QUERY))) {
      const ref = 'el_' + (refN++);
      el.setAttribute('data-flow-ref', ref);

      const tag = el.tagName.toUpperCase();
      const type = el.getAttribute('type') || (tag === 'TEXTAREA' ? 'textarea' : undefined);
      const role = el.getAttribute('role') || undefined;
      const text = snippet(el) || undefined;
      const placeholder = (el.getAttribute('placeholder') || undefined);
      const ariaLabel = (el.getAttribute('aria-label') || el.getAttribute('title') || undefined);
      const isDisabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || el.disabled === true;

      let value;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        value = el.value || undefined;
      } else if (el.getAttribute('contenteditable') === 'true') {
        value = snippet(el) || undefined;
      }

      interactables.push({
        ref, tag, role, type, text, placeholder, ariaLabel, value,
        selector: bestSelector(el, ref),
        visible: visible(el),
        disabled: isDisabled,
      });
    }

    const media = [];
    let mN = 1;
    const SKIP_IMG = ['data:image/svg', 'avatar', 'icon', 'logo', '.svg'];

    for (const img of Array.from(document.querySelectorAll('img'))) {
      const src = img.src || '';
      if (!src || SKIP_IMG.some(s => src.includes(s))) continue;
      const ref = 'img_' + (mN++);
      img.setAttribute('data-flow-media-ref', ref);
      media.push({
        ref, kind: 'image', src,
        alt: img.alt || undefined,
        width: img.naturalWidth || img.width || undefined,
        height: img.naturalHeight || img.height || undefined,
      });
    }

    for (const vid of Array.from(document.querySelectorAll('video'))) {
      const src = vid.src || vid.currentSrc || '';
      if (!src) continue;
      const ref = 'vid_' + (mN++);
      vid.setAttribute('data-flow-media-ref', ref);
      media.push({
        ref, kind: 'video', src,
        poster: vid.poster || undefined,
      });
    }

    return { interactables, media };
  `);

  const { interactables, media } = await page.evaluate(evalFn as any);

  return {
    url,
    title,
    interactables,
    media,
    capturedAssets: [...new Set(capturedAssets)],
    summary: {
      inputs: interactables.filter((i: any) => ['INPUT', 'TEXTAREA'].includes(i.tag) || i.role === 'textbox').length,
      buttons: interactables.filter((i: any) => i.tag === 'BUTTON' || i.role === 'button').length,
      media: media.length,
      total: interactables.length,
    },
  };
}
