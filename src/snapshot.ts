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
  contentEditable?: boolean;
  value?: string;        // current value of inputs/textareas
  selector: string;      // best CSS selector for this element
  visible: boolean;
  inViewport?: boolean;
  disabled: boolean;
  pressed?: boolean;
  toggleState?: { value: boolean; source: 'aria-pressed' | 'aria-checked' | 'data-state' };
  instrumentalControl?: {
    element: { tag: string; role: string | null; type: string | null; ariaChecked: string | null; ariaPressed: string | null; dataState: string | null; inputChecked: boolean | null; hitTarget: 'self_or_descendant' | 'ancestor' | 'other' | 'none' };
  };
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

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function isTransientNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /execution context was destroyed|cannot find context/iu.test(message);
}

async function captureSnapshotOnce(page: Page, capturedAssets: string[]): Promise<PageSnapshot> {
  const url = page.url();
  const title = await page.title();

  const { interactables, media } = await page.evaluate(() => {
    // ── Visibility helper ────────────────────────────────────────────────────
    function visible(el: Element): boolean {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    }

    // ── Text helper ──────────────────────────────────────────────────────────
    function snippet(el: Element): string {
      return ((el as HTMLElement).innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    }

    // ── Best selector ────────────────────────────────────────────────────────
    function bestSelector(el: Element, ref: string): string {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const aria = el.getAttribute('aria-label');
      if (aria) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`;
      const name = el.getAttribute('name');
      if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      const ph = el.getAttribute('placeholder');
      if (ph) return `${el.tagName.toLowerCase()}[placeholder="${CSS.escape(ph)}"]`;
      return `[data-flow-ref="${ref}"]`;
    }

    // ── Collect interactables ────────────────────────────────────────────────
    const QUERY = [
      'button',
      'input',
      'textarea',
      'select',
      'a[href]',
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="textbox"]',
      '[role="option"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="combobox"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const interactables: any[] = [];
    let refN = 1;

    for (const el of Array.from(document.querySelectorAll(QUERY))) {
      const ref = `el_${refN++}`;
      el.setAttribute('data-flow-ref', ref);

      const tag = el.tagName.toUpperCase();
      const type = el.getAttribute('type') || (tag === 'TEXTAREA' ? 'textarea' : undefined);
      const role = el.getAttribute('role') || undefined;
      const text = snippet(el) || undefined;
      const placeholder = (el.getAttribute('placeholder') || undefined);
      const ariaLabel = (el.getAttribute('aria-label') || el.getAttribute('title') || undefined);
      const contentEditable = el.getAttribute('contenteditable') === 'true';
      const isDisabled =
        el.hasAttribute('disabled') ||
        el.getAttribute('aria-disabled') === 'true' ||
        (el as any).disabled === true;
      const pressedAttribute = el.getAttribute('aria-pressed');
      const pressed = pressedAttribute === 'true' ? true : pressedAttribute === 'false' ? false : undefined;
      const checkedAttribute = el.getAttribute('aria-checked');
      const dataStateAttribute = el.getAttribute('data-state');
      const toggleState = pressed !== undefined
        ? { value: pressed, source: 'aria-pressed' as const }
        : checkedAttribute === 'true' || checkedAttribute === 'false'
          ? { value: checkedAttribute === 'true', source: 'aria-checked' as const }
          : dataStateAttribute === 'on' || dataStateAttribute === 'checked' || dataStateAttribute === 'active'
            ? { value: true, source: 'data-state' as const }
            : dataStateAttribute === 'off' || dataStateAttribute === 'unchecked' || dataStateAttribute === 'inactive'
              ? { value: false, source: 'data-state' as const }
              : undefined;
      const matchesInstrumental = /(?:toggle instrumental mode|instrumental|纯音乐|伴奏)/iu.test(`${text ?? ''} ${ariaLabel ?? ''}`);
      const bounds = el.getBoundingClientRect();
      const inViewport = typeof window.innerWidth === 'number' && typeof window.innerHeight === 'number'
        ? bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0 && bounds.left < window.innerWidth && bounds.top < window.innerHeight
        : undefined;
      const hit = bounds.width > 0 && bounds.height > 0 && typeof document.elementFromPoint === 'function' ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) : null;
      const hitTarget = !hit ? 'none' as const : hit === el || el.contains(hit) ? 'self_or_descendant' as const : hit.contains(el) ? 'ancestor' as const : 'other' as const;
      const instrumentalControl = matchesInstrumental ? {
        element: {
          tag,
          role: role ?? null,
          type: type ?? null,
          ariaChecked: checkedAttribute,
          ariaPressed: pressedAttribute,
          dataState: dataStateAttribute,
          inputChecked: tag === 'INPUT' ? (el as HTMLInputElement).checked : null,
          hitTarget,
        },
      } : undefined;

      let value: string | undefined;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        value = (el as HTMLInputElement).value || undefined;
      } else if (el.getAttribute('contenteditable') === 'true') {
        value = snippet(el) || undefined;
      }

      interactables.push({
        ref,
        tag,
        role,
        type,
        text,
        placeholder,
        ariaLabel,
        contentEditable,
        value,
        selector: bestSelector(el, ref),
        visible: visible(el),
        inViewport,
        disabled: isDisabled,
        pressed,
        toggleState,
        instrumentalControl,
      });
    }

    // ── Collect media ────────────────────────────────────────────────────────
    const media: any[] = [];
    let mN = 1;

    const SKIP_IMG = ['data:image/svg', 'avatar', 'icon', 'logo', '.svg'];

    for (const img of Array.from(document.querySelectorAll('img')) as HTMLImageElement[]) {
      const src = img.src || '';
      if (!src || SKIP_IMG.some((s) => src.includes(s))) continue;
      const ref = `img_${mN++}`;
      img.setAttribute('data-flow-media-ref', ref);
      media.push({
        ref, kind: 'image', src,
        alt: img.alt || undefined,
        width: img.naturalWidth || img.width || undefined,
        height: img.naturalHeight || img.height || undefined,
      });
    }

    for (const vid of Array.from(document.querySelectorAll('video')) as HTMLVideoElement[]) {
      const src = vid.src || vid.currentSrc || '';
      if (!src) continue;
      const ref = `vid_${mN++}`;
      vid.setAttribute('data-flow-media-ref', ref);
      media.push({
        ref, kind: 'video', src,
        poster: vid.poster || undefined,
      });
    }

    return { interactables, media };
  });

  const finalUrl = page.url();
  if (finalUrl !== url) throw new Error('Execution context was destroyed because the page navigated during snapshot capture.');

  return {
    url,
    title,
    interactables,
    media,
    capturedAssets: [...new Set(capturedAssets)],
    summary: {
      inputs: interactables.filter((i) => ['INPUT', 'TEXTAREA'].includes(i.tag) || i.role === 'textbox' || i.contentEditable).length,
      buttons: interactables.filter((i) => i.tag === 'BUTTON' || i.role === 'button').length,
      media: media.length,
      total: interactables.length,
    },
  };
}

export async function captureSnapshot(page: Page, capturedAssets: string[]): Promise<PageSnapshot> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await captureSnapshotOnce(page, capturedAssets);
    } catch (error) {
      lastError = error;
      if (!isTransientNavigationError(error) || attempt === 7) throw error;
      await pause(300);
    }
  }
  throw lastError;
}
