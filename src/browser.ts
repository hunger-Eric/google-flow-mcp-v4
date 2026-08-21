import dotenv from 'dotenv';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ─── Config ───────────────────────────────────────────────────────────────────

function getDefaultChromePath(): string {
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
      'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\\\Chrome\\\\Application\\\\chrome.exe'),
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
    return 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe';
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  const linuxCandidates = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  for (const p of linuxCandidates) {
    if (fs.existsSync(p)) return p;
  }
  return '/usr/bin/google-chrome';
}

const CHROME_PATH = process.env.CHROME_EXECUTABLE_PATH || getDefaultChromePath();

const PROFILE_DIR = (() => {
  // Default to the old authenticated profile (already signed in)
  // Override with CHROME_USER_DATA_DIR env var if you want a different profile
  const raw = process.env.CHROME_USER_DATA_DIR ||
    path.join(os.homedir(), '.config', 'mcp-flow-google', 'chrome_profile');
  return raw.startsWith('~') ? raw.replace('~', os.homedir()) : raw;
})();

const HEADLESS = process.env.HEADLESS !== 'false';
const FLOW_BASE = 'https://labs.google/fx/tools/flow';

// ─── URL filtering ────────────────────────────────────────────────────────────

/** Returns true if a URL should be excluded from generated-asset tracking */
export function isNoise(url: string): boolean {
  if (!url || url.length < 20) return true;
  const noisy = [
    'review_thumbnails/', 'website/flow/', 'banners/', 'showcase/',
    'avatar', 'logo', 'icon', 'placeholder', 'pinhole', 'loading', 'spinner',
    'my_tools', '.svg', 'googleusercontent.com/a/', '=s96-c', '=s32-c', '=s64-c',
    'data:image/svg', 'google-analytics', '/gtm', 'voices/samples',
    'feedback-pa', 'apis.google.com',
  ];
  if (noisy.some((n) => url.includes(n))) return true;
  if (/\.(js|css|html|json|svg)(\?|$)/i.test(url)) return true;
  return false;
}

export type MediaType = 'image' | 'video' | 'audio' | 'unknown';

export function classifyMedia(url: string, mimeType = ''): MediaType {
  const normalizedMime = mimeType.toLowerCase();
  const normalizedUrl = url.toLowerCase();
  if (normalizedMime.startsWith('video/')) return 'video';
  if (normalizedMime.startsWith('audio/')) return 'audio';
  if (normalizedMime.startsWith('image/')) return 'image';
  if (/\.(mp4|mov|webm)(\?|$)/i.test(normalizedUrl)) return 'video';
  if (/\.(m4a|mp3|wav|aac|ogg|flac)(\?|$)/i.test(normalizedUrl)) return 'audio';
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(normalizedUrl)) return 'image';
  return 'unknown';
}

// ─── Captured asset record ────────────────────────────────────────────────────

export interface AssetRecord {
  url: string;
  capturedAt: number;
  source: 'network_rpc' | 'network_media' | 'dom_scan';
  jobId?: string;
  mediaType: MediaType;
  mimeType?: string;
}

// ─── Browser Singleton ────────────────────────────────────────────────────────

class BrowserSingleton {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private assets: AssetRecord[] = [];
  private baseline = new Set<string>();
  private genStartTime = 0;
  private activeJobId: string | undefined;

  // ── Launch ──────────────────────────────────────────────────────────────────

  private ensureProfileDir(): void {
    if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }

  private clearStaleLocks(): void {
    for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile', 'DevToolsActivePort']) {
      const p = path.join(PROFILE_DIR, lock);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch {}
      }
    }
  }

  async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    this.ensureProfileDir();
    this.clearStaleLocks();

    this.browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      userDataDir: PROFILE_DIR,
      headless: HEADLESS as any,
      defaultViewport: { width: 1440, height: 900 },
      // Remove --enable-automation so Google doesn't block login
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
        '--password-store=basic',
        '--use-mock-keychain',
      ],
    });

    this.browser.on('disconnected', () => {
      this.browser = null;
      this.page = null;
    });

    return this.browser;
  }

  async getPage(): Promise<Page> {
    // Reuse existing open page
    if (this.page && !this.page.isClosed()) {
      try {
        await this.page.title(); // ping — throws if dead
        return this.page;
      } catch {
        this.page = null;
      }
    }

    const browser = await this.getBrowser();
    const pages = await browser.pages();
    this.page = pages.length > 0 ? pages[0] : await browser.newPage();

    // Stealth: hide navigator.webdriver so Google doesn't block login
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // @ts-ignore
      delete navigator.__proto__.webdriver;
    });

    // Apply cookies from env if provided
    await this.applyCookies(this.page);

    // Start intercepting network for asset tracking
    this.attachNetworkListener(this.page);

    return this.page;
  }

  async close(): Promise<void> {
    const activeBrowser = this.browser;
    this.browser = null;
    this.page = null;
    this.assets = [];
    this.baseline.clear();
    this.genStartTime = 0;
    this.activeJobId = undefined;
    if (activeBrowser?.connected) await activeBrowser.close();
  }

  // ── Cookies ─────────────────────────────────────────────────────────────────

  private async applyCookies(page: Page): Promise<void> {
    const raw = process.env.GOOGLE_COOKIES?.trim();
    if (!raw) return;
    const pairs = raw.split(';').map((s) => s.trim()).filter(Boolean);
    const cookies: any[] = [];
    for (const pair of pairs) {
      const [name, ...rest] = pair.split('=');
      const cookieName = name?.trim();
      const cookieVal = rest.join('=').trim();
      if (!cookieName) continue;
      cookies.push(
        { name: cookieName, value: cookieVal, domain: '.google.com', path: '/' },
        { name: cookieName, value: cookieVal, domain: 'labs.google', path: '/' },
      );
    }
    if (cookies.length > 0) {
      try { await page.setCookie(...cookies); } catch {}
    }
  }

  // ── Network listener ─────────────────────────────────────────────────────────

  private attachNetworkListener(page: Page): void {
    page.on('response', async (res) => {
      const url = res.url();
      if (isNoise(url)) return;

      const isRpcEndpoint =
        url.includes('flowCreationAgent') ||
        url.includes('flowAppletAgent') ||
        url.includes('flowMedia') ||
        url.includes('flowWorkflows') ||
        url.includes('getMediaUrl') ||
        url.includes('trpc') ||
        url.includes('batchGenerate') ||
        url.includes('batchCreate');

      if (isRpcEndpoint) {
        try {
          const text = await res.text();
          // Extract job ID
          let jobId: string | undefined;
          try {
            const json = JSON.parse(text);
            jobId =
              json.jobId || json.taskId || json.id ||
              json.sessionInfo?.agentSessionId ||
              json.workflowId ||
              json.name?.split('/').pop();
          } catch {
            const m = text.match(/"(jobId|taskId|workflowId|agentSessionId)"\s*:\s*"([^"]+)"/);
            if (m) jobId = m[2];
          }
          if (jobId) this.activeJobId = jobId;

          // Extract media URLs from RPC body
          const urlMatches = text.match(/https:\/\/[^\s"'\\]+/g) ?? [];
          for (const u of urlMatches) {
            if (!isNoise(u)) this.recordAsset(u, 'network_rpc', jobId);
          }
        } catch {}
        return;
      }

      // Plain media responses
      const ct = res.headers()['content-type'] || '';
      if (
        ct.includes('image/') || ct.includes('video/') || ct.includes('audio/') ||
        url.includes('producer-app-public/clips/') ||
        url.includes('ai-sandbox-internal/flow/') ||
        url.includes('getMediaUrlRedirect') ||
        url.includes('googleusercontent.com/gg/') ||
        url.includes('fife')
      ) {
        this.recordAsset(url, 'network_media', undefined, ct);
      }
    });
  }

  // ── Asset tracking ────────────────────────────────────────────────────────────

  private recordAsset(
    url: string,
    source: AssetRecord['source'],
    jobId?: string,
    mimeType?: string,
  ): void {
    if (isNoise(url)) return;
    const mediaType = classifyMedia(url, mimeType);
    const existing = this.assets.find((a) => a.url === url);
    if (existing) {
      if (source === 'network_rpc') existing.source = 'network_rpc';
      if (jobId) existing.jobId = jobId;
      if (mediaType !== 'unknown') existing.mediaType = mediaType;
      if (mimeType) existing.mimeType = mimeType;
      return;
    }
    this.assets.push({
      url,
      capturedAt: Date.now(),
      source,
      jobId: jobId || this.activeJobId,
      mediaType,
      mimeType,
    });
  }

  markGenerationStart(): void {
    this.genStartTime = Date.now();
    this.activeJobId = undefined;
    this.baseline.clear();
    for (const a of this.assets) this.baseline.add(a.url);
  }

  async getLatestGeneratedAsset(expectedMediaType?: MediaType): Promise<AssetRecord | null> {
    const cutoff = this.genStartTime - 2000;
    const candidates = this.assets.filter(
      (a) =>
        a.capturedAt >= cutoff &&
        !this.baseline.has(a.url) &&
        !isNoise(a.url) &&
        (!expectedMediaType || a.mediaType === expectedMediaType)
    );

    // Prefer jobId match
    if (this.activeJobId) {
      const match = candidates.find(
        (a) => a.jobId === this.activeJobId || a.url.includes(this.activeJobId!)
      );
      if (match) return match;
    }

    // Prefer RPC source
    const rpcMatch = [...candidates].reverse().find((a) => a.source === 'network_rpc');
    if (rpcMatch) return rpcMatch;

    // Any candidate
    if (candidates.length > 0) return candidates[candidates.length - 1];

    // DOM scan fallback
    const page = await this.getPage().catch(() => null);
    if (!page) return null;

    try {
      const domAsset = await page.evaluate((input: { baselineArr: string[]; expected?: MediaType }) => {
        const { baselineArr, expected } = input;
        const baselineSet = new Set(baselineArr);
        if (!expected || expected === 'video') {
          for (const video of Array.from(document.querySelectorAll('video')) as HTMLVideoElement[]) {
            const src = video.currentSrc || video.src || '';
            if (src && !baselineSet.has(src)) return { url: src, mediaType: 'video' as const };
          }
        }
        if (!expected || expected === 'audio') {
          for (const audio of Array.from(document.querySelectorAll('audio')) as HTMLAudioElement[]) {
            const src = audio.currentSrc || audio.src || '';
            if (src && !baselineSet.has(src)) return { url: src, mediaType: 'audio' as const };
          }
        }
        if (expected && expected !== 'image') return null;
        const imgs = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
        for (const img of imgs) {
          const src = img.src || '';
          if (
            src && src.length > 30 &&
            !baselineSet.has(src) &&
            !src.includes('placeholder') && !src.includes('avatar') &&
            !src.includes('logo') && !src.includes('icon') &&
            !src.includes('.svg') && !src.startsWith('data:image/svg') &&
            !src.includes('review_thumbnails/') &&
            (img.naturalWidth > 100 || img.width > 100)
          ) return { url: src, mediaType: 'image' as const };
        }
        return null;
      }, { baselineArr: Array.from(this.baseline), expected: expectedMediaType });

      if (domAsset) {
        this.recordAsset(domAsset.url, 'dom_scan');
        const record = this.assets.find((a) => a.url === domAsset.url);
        if (record) record.mediaType = domAsset.mediaType;
        return record ?? null;
      }
    } catch {}

    return null;
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  async navigate(url: string): Promise<{ title: string; url: string }> {
    const page = await this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1500);
    return { title: await page.title(), url: page.url() };
  }

  buildFlowUrl(opts: { url?: string; projectId?: string; toolId?: string }): string {
    if (opts.url) return opts.url;
    if (opts.projectId && opts.toolId)
      return `${FLOW_BASE}/project/${opts.projectId}/tool/${opts.toolId}`;
    if (opts.projectId)
      return `${FLOW_BASE}/project/${opts.projectId}`;
    return FLOW_BASE;
  }

  // ── Download ─────────────────────────────────────────────────────────────────

  async downloadAsset(url: string, outputPath: string, page: Page): Promise<Buffer> {
    // Strategy 1: fetch with cookies
    try {
      const cookies = await page.cookies();
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const res = await fetch(url, {
        headers: {
          Cookie: cookieStr,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        },
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {}

    // Strategy 2: in-page fetch (bypasses CORS for authenticated content)
    try {
      const dataUrl = await page.evaluate(async (u: string) => {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }, url);
      const b64 = dataUrl.split(',')[1];
      if (b64) return Buffer.from(b64, 'base64');
    } catch {}

    throw new Error(`Could not download asset from: ${url.substring(0, 120)}`);
  }

  getPage_ = this.getPage.bind(this);
}

export const browser = new BrowserSingleton();

// ─── Utilities ────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function resolveOutputPath(
  outputPath: string,
  assetUrl: string,
  expectedMediaType?: MediaType,
): string {
  const expanded = outputPath.startsWith('~')
    ? outputPath.replace('~', os.homedir())
    : outputPath;
  const abs = path.resolve(expanded);

  // If it looks like a file path (has extension), ensure parent dir exists and return as-is
  if (/\.(png|jpg|jpeg|webp|mp4|mov|m4a|mp3|wav|aac|ogg|flac)$/i.test(abs)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    return abs;
  }

  // Otherwise treat as directory, auto-name the file
  fs.mkdirSync(abs, { recursive: true });
  let ext = 'png';
  if (expectedMediaType === 'video') ext = 'mp4';
  else if (expectedMediaType === 'audio') ext = 'm4a';
  else if (/\.webp/i.test(assetUrl)) ext = 'webp';
  else if (/\.mp4/i.test(assetUrl)) ext = 'mp4';
  else if (/\.(m4a|mp3|wav|aac|ogg|flac)/i.test(assetUrl)) {
    ext = assetUrl.match(/\.(m4a|mp3|wav|aac|ogg|flac)/i)?.[1].toLowerCase() || 'm4a';
  }
  else if (/\.(jpg|jpeg)/i.test(assetUrl)) ext = 'jpg';
  return path.join(abs, `flow_${Date.now()}.${ext}`);
}

export function detectMediaType(buffer: Buffer, expected?: MediaType): MediaType {
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF') {
    return buffer.toString('ascii', 8, 12) === 'WEBP' ? 'image' : 'audio';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 3) === 'ID3') return 'audio';
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') return 'audio';
  if (buffer.length >= 8 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const hasVideoHandler = buffer.includes(Buffer.from('vide'));
    const hasAudioHandler = buffer.includes(Buffer.from('soun'));
    if (hasVideoHandler && !hasAudioHandler) return 'video';
    if (hasAudioHandler && !hasVideoHandler) return 'audio';
    return expected === 'audio' ? 'audio' : 'video';
  }
  return 'unknown';
}
