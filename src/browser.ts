import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { extractCompletedFlowMusicClips, FlowMusicResult, MusicSubmissionContext, ObservedFlowMusicClip, isEligibleFlowMusicClip, selectCurrentFlowMusicResultFromClips } from './music-result.js';
import { MusicObservation, safeMusicSessionUrl, sha256Text } from './music-observation.js';

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

type MusicSubmissionMetadata = { target: string; controlText: string; controlAria: string; sessionUrl: string };
type MusicDiagnosticRow = { clipId: string | null; opId: string | null; opType: string | null; operationType: string | null; conversationId: string | null; createdAt: string | null; audioUrl: string | null; soundPrompt: string | null; durationStatus: string | null; durationValue: string | null; lyricsCompleted: boolean; instrumental: boolean };

/** Frozen tuple for read-only recovery of a naturally observed Music result. */
export interface ObservedMusicResultExpectation {
  clipId: string;
  operationId: string;
  conversationId: string;
  createdAt: string;
  duration: string;
  instrumental: true;
  startedAt: number;
  soundPromptSha256: string;
  generatedSoundPromptSha256: string;
  audioUrlSha256: string;
}

function diagnosticString(value: unknown, max = 8192): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

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

export type GeneratedVideoThumbnail = { src: string; alt?: string };

export function selectNewGeneratedVideoThumbnail(
  thumbnails: GeneratedVideoThumbnail[],
  baseline: ReadonlySet<string>,
  opened: ReadonlySet<string>,
): GeneratedVideoThumbnail | null {
  return [...thumbnails].reverse().find((thumbnail) =>
    Boolean(thumbnail.src) &&
    /(?:生成的视频缩略图|generated video thumbnail)/iu.test(thumbnail.alt ?? '') &&
    !baseline.has(thumbnail.src) &&
    !opened.has(thumbnail.src)
  ) ?? null;
}

export async function readStablePageIdentity(
  page: Pick<Page, 'title' | 'url'>,
  pause: (milliseconds: number) => Promise<void> = sleep,
  attempts = 8,
): Promise<{ title: string; url: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return { title: await page.title(), url: page.url() };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/execution context was destroyed|cannot find context/iu.test(message) || attempt + 1 >= attempts) throw error;
      await pause(300);
    }
  }
  throw lastError;
}

// ─── Browser Singleton ────────────────────────────────────────────────────────

class BrowserSingleton {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private assets: AssetRecord[] = [];
  private baseline = new Set<string>();
  private openedVideoThumbnails = new Set<string>();
  private genStartTime = 0;
  private activeJobId: string | undefined;
  private musicSubmission: MusicSubmissionContext | undefined;
  private musicResult: FlowMusicResult | undefined;
  private musicResultConflict: string | undefined;
  private pendingMusicClips = new Map<string, ObservedFlowMusicClip>();
  private observedMusicClips = new Map<string, ObservedFlowMusicClip>();
  private observedMusicClipOverflow = false;
  private observedMusicOperationIds = new Set<string>();
  private musicSubmissionPage: Pick<Page, 'url'> | undefined;
  private musicGenerationId = 0;
  private readonly musicObservation = new MusicObservation();
  private lastMusicObservationReason: string | undefined;
  private pendingMusicDiagnosticRows = new Map<string, MusicDiagnosticRow>();
  private observedDiagnosticRows = new Set<string>();

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
    this.openedVideoThumbnails.clear();
    this.genStartTime = 0;
    this.activeJobId = undefined;
    this.musicSubmission = undefined;
    this.musicResult = undefined;
    this.musicResultConflict = undefined;
    this.pendingMusicClips.clear();
    this.observedMusicClips.clear();
    this.observedMusicClipOverflow = false;
    this.observedMusicOperationIds.clear();
    this.musicSubmissionPage = undefined;
    this.musicGenerationId += 1;
    this.pendingMusicDiagnosticRows.clear();
    this.observedDiagnosticRows.clear();
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
      const observedGenerationId = this.musicGenerationId;
      const url = res.url();
      if (isNoise(url)) return;

      // Flow Music does not use the Flow video RPC endpoints. Its completed
      // song is returned in this provider record, so bind it before generic
      // media tracking can see an unrelated audio player.
      const responseUrl = new URL(url);
      const isMusicApi = /^(?:www\.)?flowmusic\.app$/iu.test(responseUrl.hostname) && responseUrl.pathname.startsWith('/__api/');
      const musicStatus = /^\/__api\/audio-create-song-status\/([0-9a-f-]{36})\/?$/iu.exec(responseUrl.pathname);
      if (isMusicApi && musicStatus && res.request().method().toUpperCase() === 'GET' && res.status() >= 200 && res.status() < 300) {
        if (observedGenerationId !== this.musicGenerationId) return;
        if (this.musicSubmission) {
          this.observedMusicOperationIds.add(musicStatus[1]);
          this.musicSubmissionPage = page;
          this.musicObservation.record('audio_song_status_observed', {
            generationId: observedGenerationId,
            actualSessionUrl: safeMusicSessionUrl(page.url()),
            endpointPathname: responseUrl.pathname,
            method: 'GET',
            status: res.status(),
            operationId: musicStatus[1],
          });
          this.reconcilePendingMusicResult();
        }
        // This official status acknowledgement needs no body inspection.
        return;
      }
      if (isMusicApi && responseUrl.pathname === '/__api/clips' && res.request().method().toUpperCase() === 'POST' && res.status() >= 200 && res.status() < 300) {
        try {
          const payload = JSON.parse(await res.text());
          if (observedGenerationId !== this.musicGenerationId) return;
          const clips = extractCompletedFlowMusicClips(payload);
          if (this.musicObservation.enabled) this.observeMusicClips(payload, clips, responseUrl.pathname, res.request().method(), res.status(), page);
          for (const clip of clips) {
            this.recordAsset(clip.audioUrl, 'network_rpc', clip.operationId, 'audio/mp4');
          }
          this.retainObservedMusicClips(clips);
          if (!this.musicSubmission) return;
          // A new Music composition may return its completed clips before the
          // page URL changes from /session to /session/<UUID>. Retain only
          // parsed completed candidates and reconcile them in the existing
          // wait loop once the page exposes its session identity.
          const candidates = clips.filter((clip) => this.isPendingMusicCandidate(clip, this.musicSubmission!));
          this.retainPendingMusicClips(candidates);
          this.musicSubmissionPage = page;
          this.reconcilePendingMusicResult();
        } catch {}
        return;
      }
      if (isMusicApi && this.musicObservation.enabled) {
        let topLevelKeys: string[] = [];
        try {
          const payload = JSON.parse(await res.text());
          if (observedGenerationId !== this.musicGenerationId) return;
          if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) topLevelKeys = Object.keys(payload as Record<string, unknown>).slice(0, 32);
        } catch {}
        this.musicObservation.record('api_observed', {
          generationId: observedGenerationId,
          actualSessionUrl: safeMusicSessionUrl(page.url()),
          endpointPathname: responseUrl.pathname,
          method: res.request().method().toUpperCase(),
          status: res.status(),
          topLevelKeys,
        });
      }

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
      jobId,
      mediaType,
      mimeType,
    });
  }

  async markGenerationStart(): Promise<void> {
    this.genStartTime = Date.now();
    this.activeJobId = undefined;
    this.musicSubmission = undefined;
    this.musicResult = undefined;
    this.musicResultConflict = undefined;
    this.pendingMusicClips.clear();
    this.observedMusicClips.clear();
    this.observedMusicClipOverflow = false;
    this.observedMusicOperationIds.clear();
    this.musicSubmissionPage = undefined;
    this.musicGenerationId += 1;
    this.pendingMusicDiagnosticRows.clear();
    this.observedDiagnosticRows.clear();
    this.baseline.clear();
    this.openedVideoThumbnails.clear();
    for (const a of this.assets) this.baseline.add(a.url);

    // A fresh MCP process has not necessarily observed the network responses
    // that created media already present in an existing Flow project. Snapshot
    // those DOM URLs before submitting so flow_wait cannot mistake a historical
    // asset for the result of the new generation.
    const page = this.page;
    if (!page || page.isClosed()) return;
    try {
      const domUrls = await page.evaluate(() =>
        Array.from(document.querySelectorAll('video, audio, img'))
          .map((el: any) => el.currentSrc || el.src || '')
          .filter(Boolean),
      );
      for (const url of domUrls) {
        if (!isNoise(url)) this.baseline.add(url);
      }
    } catch {}
  }

  async markMusicGenerationStart(context: MusicSubmissionContext, metadata?: MusicSubmissionMetadata): Promise<void> {
    await this.markGenerationStart();
    this.musicSubmission = context;
    this.lastMusicObservationReason = undefined;
    this.pendingMusicDiagnosticRows.clear();
    this.observedDiagnosticRows.clear();
    this.musicObservation.record('submitted', {
      generationId: this.musicGenerationId,
      actualSessionUrl: metadata ? safeMusicSessionUrl(metadata.sessionUrl) : null,
      clickTarget: metadata?.target ?? null,
      clickText: metadata?.controlText ?? null,
      clickAria: metadata?.controlAria ?? null,
      inputSha256: sha256Text(context.soundPrompt),
      instrumental: context.instrumental,
    });
  }

  getCurrentMusicResult(): FlowMusicResult | null {
    return this.musicResultConflict ? null : this.musicResult ?? null;
  }

  async waitForCurrentMusicResult(timeoutMs: number): Promise<FlowMusicResult> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      this.reconcilePendingMusicResult();
      if (this.musicResultConflict) {
        this.musicObservation.record('final', { generationId: this.musicGenerationId, finalState: 'conflict', bindingReason: this.musicResultConflict, actualSessionUrl: this.currentMusicSessionUrl() });
        throw new Error(this.musicResultConflict);
      }
      if (this.musicResult) {
        this.musicObservation.record('final', { generationId: this.musicGenerationId, finalState: 'completed', actualSessionUrl: this.currentMusicSessionUrl() });
        return this.musicResult;
      }
      await sleep(250);
    }
    this.musicObservation.record('final', { generationId: this.musicGenerationId, finalState: 'timeout', actualSessionUrl: this.currentMusicSessionUrl() });
    throw new Error(`Timed out (${timeoutMs}ms) waiting for the current Flow Music provider result`);
  }

  private reconcilePendingMusicResult(): void {
    if (!this.musicSubmission || !this.musicSubmissionPage) {
      this.observeMusicReason('no_current_candidates');
      return;
    }
    // Do not infer identity from a clip. A URL session UUID is the only late
    // binding permitted for a submission that started at /session.
    const pageSession = /^https:\/\/(?:www\.)?flowmusic\.app\/session\/([0-9a-f-]{36})(?:[/?#]|$)/iu.exec(this.musicSubmissionPage.url())?.[1];
    const responseContext = this.musicSubmission.conversationId
      ? this.musicSubmission
      : pageSession
        ? { ...this.musicSubmission, conversationId: pageSession }
        : null;
    if (!responseContext) {
      this.observeMusicReason('waiting_for_page_session_uuid');
      return;
    }
    if (responseContext.conversationId) this.observeDiagnosticRows(responseContext.conversationId);
    if (this.pendingMusicClips.size === 0) {
      this.observeMusicReason('no_current_candidates');
      return;
    }
    const boundContext = responseContext.promptSource === 'producer_chat_fresh_session'
      ? { ...responseContext, observedOperationIds: this.observedMusicOperationIds }
      : responseContext;
    const pending = [...this.pendingMusicClips.values()];
    if (this.musicResult) {
      for (const clip of pending) {
        const candidate = selectCurrentFlowMusicResultFromClips([clip], boundContext);
        if (candidate && (candidate.clipId !== this.musicResult.clipId || candidate.operationId !== this.musicResult.operationId || candidate.audioUrl !== this.musicResult.audioUrl || candidate.generatedSoundPromptSha256 !== this.musicResult.generatedSoundPromptSha256)) {
          this.musicResultConflict = 'Flow Music returned a different completed clip for the same submission';
          return;
        }
      }
      return;
    }
    const result = selectCurrentFlowMusicResultFromClips(pending, boundContext);
    if (!result) {
      this.observeMusicReason('no_exact_prompt_time_candidate_or_ambiguous');
      return;
    }
    this.musicResult = result;
    this.musicSubmission = { ...this.musicSubmission, conversationId: result.conversationId };
    this.observeMusicReason('accepted');
  }

  private retainPendingMusicClips(clips: ObservedFlowMusicClip[]): void {
    const maxPendingMusicClips = 16;
    for (const clip of clips) {
      const key = `${clip.clipId}:${clip.operationId}:${clip.audioUrl}`;
      this.pendingMusicClips.set(key, clip);
      if (this.pendingMusicClips.size > maxPendingMusicClips) {
        this.pendingMusicClips.clear();
        this.musicResultConflict = `Flow Music returned more than ${maxPendingMusicClips} completed candidates for one submission`;
        this.observeMusicReason('candidate_cap_exceeded');
        return;
      }
    }
  }

  private isPendingMusicCandidate(clip: ObservedFlowMusicClip, context: MusicSubmissionContext): boolean {
    if (Date.parse(clip.createdAt) < context.startedAt) return false;
    // Before the fresh Producer page reveals its UUID, retain same-attempt
    // completed rows for later URL binding. The result selector still requires
    // both that URL UUID and a natural status acknowledgement.
    if (context.promptSource === 'producer_chat_fresh_session') {
      return context.conversationId === undefined || clip.conversationId === context.conversationId;
    }
    return isEligibleFlowMusicClip(clip, context);
  }

  private retainObservedMusicClips(clips: ObservedFlowMusicClip[]): void {
    const maxObservedMusicClips = 128;
    for (const clip of clips) {
      const key = `${clip.clipId}:${clip.operationId}:${clip.audioUrl}`;
      if (!this.observedMusicClips.has(key) && this.observedMusicClips.size >= maxObservedMusicClips) {
        this.observedMusicClipOverflow = true;
        return;
      }
      this.observedMusicClips.set(key, clip);
    }
  }

  /**
   * Recover only an explicitly frozen tuple observed from the official clips
   * response. This performs no DOM scan, no endpoint request, and no latest
   * media selection.
   */
  getObservedMusicResult(
    expected: ObservedMusicResultExpectation,
    page: Pick<Page, 'url'>,
  ): FlowMusicResult | null {
    const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
    const isHash = (value: string) => /^[a-f0-9]{64}$/u.test(value);
    if (!isUuid(expected.clipId) || !isUuid(expected.operationId) || !isUuid(expected.conversationId) ||
      !Number.isFinite(expected.startedAt) || !Number.isFinite(Date.parse(expected.createdAt)) || !expected.duration ||
      expected.instrumental !== true || !isHash(expected.soundPromptSha256) || !isHash(expected.generatedSoundPromptSha256) || !isHash(expected.audioUrlSha256)) return null;
    const pageSession = /^https:\/\/(?:www\.)?flowmusic\.app\/session\/([0-9a-f-]{36})(?:[/?#]|$)/iu.exec(page.url())?.[1];
    if (pageSession !== expected.conversationId || this.observedMusicClipOverflow) return null;
    const candidates = [...this.observedMusicClips.values()].filter((clip) =>
      clip.conversationId === expected.conversationId && Date.parse(clip.createdAt) >= expected.startedAt,
    );
    const unique = new Map(candidates.map((clip) => [`${clip.clipId}:${clip.operationId}:${clip.audioUrl}`, clip]));
    if (unique.size !== 1) return null;
    const clip = [...unique.values()][0];
    if (clip.clipId !== expected.clipId || clip.operationId !== expected.operationId || clip.createdAt !== expected.createdAt ||
      clip.duration !== expected.duration || clip.instrumental !== true || sha256Text(clip.soundPrompt) !== expected.generatedSoundPromptSha256 ||
      sha256Text(clip.audioUrl) !== expected.audioUrlSha256) return null;
    return {
      clipId: clip.clipId,
      operationId: clip.operationId,
      conversationId: clip.conversationId,
      soundPromptSha256: expected.soundPromptSha256,
      generatedSoundPromptSha256: expected.generatedSoundPromptSha256,
      bindingKind: 'observed_exact_recovery',
      audioUrl: clip.audioUrl,
      createdAt: clip.createdAt,
      duration: clip.duration,
      instrumental: true,
    };
  }

  private currentMusicSessionUrl(): string | null {
    return this.musicSubmissionPage ? safeMusicSessionUrl(this.musicSubmissionPage.url()) : null;
  }

  private observeMusicReason(reason: string): void {
    if (this.lastMusicObservationReason === reason) return;
    this.lastMusicObservationReason = reason;
    this.musicObservation.record('binding', { generationId: this.musicGenerationId, bindingReason: reason, actualSessionUrl: this.currentMusicSessionUrl(), pendingCandidateCount: this.pendingMusicClips.size });
  }

  private observeMusicClips(payload: unknown, clips: ObservedFlowMusicClip[], endpointPathname: string, method: string, status: number, page: Pick<Page, 'url'>): void {
    const topLevelKeys = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? Object.keys(payload as Record<string, unknown>).slice(0, 32) : [];
    const rawClips = payload !== null && typeof payload === 'object' && !Array.isArray(payload) && (payload as Record<string, unknown>).clips !== null && typeof (payload as Record<string, unknown>).clips === 'object'
      ? Object.values((payload as Record<string, unknown>).clips as Record<string, unknown>).slice(0, 64)
      : [];
    const clipRows = rawClips.map((raw) => {
      const clip = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const operation = clip.operation !== null && typeof clip.operation === 'object' ? clip.operation as Record<string, unknown> : {};
      const duration = clip.duration !== null && typeof clip.duration === 'object' ? clip.duration as Record<string, unknown> : {};
      const lyrics = clip.lyrics !== null && typeof clip.lyrics === 'object' ? clip.lyrics as Record<string, unknown> : {};
      const lyricValue = lyrics.value !== null && typeof lyrics.value === 'object' ? lyrics.value as Record<string, unknown> : {};
      const soundPrompt = diagnosticString(operation.sound_prompt);
      const audioUrl = diagnosticString(clip.audio_url);
      const lyricText = diagnosticString(lyricValue.text);
      const row = { clipId: diagnosticString(clip.id, 128), opId: diagnosticString(clip.op_id, 128), opType: diagnosticString(clip.op_type, 128), operationType: diagnosticString(operation.op_type, 128), conversationId: diagnosticString(operation.conversation_id, 128), createdAt: diagnosticString(clip.created_at, 128), durationType: typeof duration.value, durationStatus: diagnosticString(duration.status, 128), lyricsStatus: diagnosticString(lyrics.status, 128), lyricsCompleted: lyrics.status === 'completed', instrumental: lyricText === '[Instrumental]', lyricsMarkerSha256: lyricText ? sha256Text(lyricText) : null, soundPromptSha256: soundPrompt ? sha256Text(soundPrompt) : null, audioUrlSha256: audioUrl ? sha256Text(audioUrl) : null, clipKeys: Object.keys(clip).slice(0, 64), operationKeys: Object.keys(operation).slice(0, 64) };
      if (this.musicSubmission && row.createdAt && Number.isFinite(Date.parse(row.createdAt)) && Date.parse(row.createdAt) >= this.musicSubmission.startedAt) {
        const diagnosticRow = { clipId: row.clipId, opId: row.opId, opType: row.opType, operationType: row.operationType, conversationId: row.conversationId, createdAt: row.createdAt, audioUrl, soundPrompt, durationStatus: row.durationStatus, durationValue: diagnosticString(duration.value, 128), lyricsCompleted: row.lyricsCompleted, instrumental: row.instrumental };
        const key = `${diagnosticRow.clipId}:${diagnosticRow.opId}:${diagnosticRow.audioUrl ?? ''}`;
        if (this.pendingMusicDiagnosticRows.has(key) || this.pendingMusicDiagnosticRows.size < 64) this.pendingMusicDiagnosticRows.set(key, diagnosticRow);
      }
      return row;
    });
    const pageSession = /^https:\/\/(?:www\.)?flowmusic\.app\/session\/([0-9a-f-]{36})(?:[/?#]|$)/iu.exec(page.url())?.[1];
    const knownSession = this.musicSubmission?.conversationId ?? pageSession;
    const currentCandidates = knownSession ? clips.filter((clip) => this.musicSubmission && clip.conversationId === knownSession && clip.soundPrompt === this.musicSubmission.soundPrompt && Date.parse(clip.createdAt) >= this.musicSubmission.startedAt) : [];
    this.musicObservation.record('clips_observed', {
      generationId: this.musicGenerationId, actualSessionUrl: safeMusicSessionUrl(page.url()), endpointPathname, method: method.toUpperCase(), status, topLevelKeys, clipRows, parsedCompletedCount: clips.length, currentCandidateCount: currentCandidates.length,
      currentCandidates: currentCandidates.slice(0, 16).map((clip) => ({ clipId: clip.clipId, opId: clip.operationId, conversationId: clip.conversationId, createdAt: clip.createdAt, soundPromptSha256: sha256Text(clip.soundPrompt), soundPromptLength: clip.soundPrompt.length, audioUrlSha256: sha256Text(clip.audioUrl), audioUrlValid: /^https:\/\/[^\s]+\.m4a(?:[?#]|$)/iu.test(clip.audioUrl) })),
    });
  }

  private observeDiagnosticRows(sessionId: string): void {
    if (!this.musicObservation.enabled) return;
    const rows = [...this.pendingMusicDiagnosticRows.values()].filter((row) => row.conversationId === sessionId);
    const fresh = rows.filter((row) => {
      const key = `${sessionId}:${row.clipId}:${row.opId}:${row.audioUrl ?? ''}:${row.durationStatus ?? ''}:${row.durationValue ?? ''}:${row.lyricsCompleted}:${row.instrumental}`;
      if (this.observedDiagnosticRows.has(key)) return false;
      this.observedDiagnosticRows.add(key);
      return true;
    });
    if (fresh.length) {
      this.musicObservation.record('diagnostic_current_session_candidates', { generationId: this.musicGenerationId, actualSessionUrl: this.currentMusicSessionUrl(), rows: fresh.map((row) => ({ clipId: row.clipId, opId: row.opId, opType: row.opType, operationType: row.operationType, conversationId: row.conversationId, createdAt: row.createdAt, soundPromptSha256: row.soundPrompt ? sha256Text(row.soundPrompt) : null, soundPromptLength: row.soundPrompt?.length ?? 0, audioUrlSha256: row.audioUrl ? sha256Text(row.audioUrl) : null, audioUrlValid: Boolean(row.audioUrl && /^https:\/\/[^\s]+\.m4a(?:[?#]|$)/iu.test(row.audioUrl)), durationStatus: row.durationStatus, durationValue: row.durationValue, lyricsCompleted: row.lyricsCompleted, instrumental: row.instrumental })) });
    }
  }

  async getObservedAssetByUrlSha256(expectedSha256: string, expectedMediaType?: MediaType): Promise<AssetRecord | null> {
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Invalid expected asset URL SHA-256');
    const matches = (url: string) => createHash('sha256').update(url).digest('hex') === expectedSha256;
    const captured = this.assets.find((asset) => matches(asset.url) && (!expectedMediaType || asset.mediaType === expectedMediaType));
    if (captured) return captured;
    const page = await this.getPage();
    const sources = await page.evaluate(() => Array.from(document.querySelectorAll('audio, video, img')).map((element: any) => ({ url: element.currentSrc || element.src || '', type: element.tagName === 'AUDIO' ? 'audio' : element.tagName === 'VIDEO' ? 'video' : 'image' })));
    const source = sources.find((row) => matches(row.url) && (!expectedMediaType || row.type === expectedMediaType));
    if (!source) return null;
    this.recordAsset(source.url, 'dom_scan');
    const asset = this.assets.find((row) => row.url === source.url);
    if (asset) asset.mediaType = source.type as MediaType;
    return asset ?? null;
  }

  async getLatestGeneratedAsset(expectedMediaType?: MediaType): Promise<AssetRecord | null> {
    if (expectedMediaType === 'audio') {
      if (!this.musicResult || this.musicResultConflict) return null;
      return this.assets.find((asset) => asset.url === this.musicResult!.audioUrl && asset.jobId === this.musicResult!.operationId) ?? null;
    }
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

  async openLatestGeneratedVideoResult(): Promise<boolean> {
    const page = await this.getPage().catch(() => null);
    if (!page) return false;
    const handles = await page.$$('img');
    const thumbnails = await Promise.all(handles.map((handle) => handle.evaluate((element) => {
      const image = element as HTMLImageElement;
      return { src: image.src || '', alt: image.alt || '' };
    })));
    const selected = selectNewGeneratedVideoThumbnail(thumbnails, this.baseline, this.openedVideoThumbnails);
    if (!selected) return false;
    const selectedIndex = thumbnails.findIndex((thumbnail) => thumbnail.src === selected.src && thumbnail.alt === selected.alt);
    if (selectedIndex < 0) return false;
    await handles[selectedIndex].click();
    this.openedVideoThumbnails.add(selected.src);
    return true;
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  async navigate(url: string): Promise<{ title: string; url: string }> {
    const page = await this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(1500);
    return readStablePageIdentity(page);
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

    // Strategy 3: stream through Chrome's own network stack. Googlevideo links
    // can be bound to the browser's egress IP, while a normal navigation keeps
    // the media connection open and makes response.buffer() wait indefinitely.
    let client: Awaited<ReturnType<ReturnType<Page['target']>['createCDPSession']>> | undefined;
    let stream: string | undefined;
    try {
      client = await page.target().createCDPSession();
      const loaded = await client.send('Network.loadNetworkResource', {
        frameId: (page.mainFrame() as unknown as { _id: string })._id,
        url,
        options: { disableCache: true, includeCredentials: true },
      });
      stream = loaded.resource.stream;
      if (loaded.resource.success && stream) {
        const chunks: Buffer[] = [];
        while (true) {
          const chunk = await client.send('IO.read', { handle: stream, size: 1024 * 1024 });
          if (chunk.data) chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'));
          if (chunk.eof) break;
        }
        const buffer = Buffer.concat(chunks);
        if (buffer.length) return buffer;
      }
    } catch {}
    finally {
      if (client && stream) await client.send('IO.close', { handle: stream }).catch(() => undefined);
      await client?.detach().catch(() => undefined);
    }

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
