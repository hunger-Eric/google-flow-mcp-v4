import 'dotenv/config';
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// One-time Google login — opens Chrome in headful mode, signed-in session persists.
// Run: npm run login

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

// Reuse the existing authenticated profile from the old MCP (already signed in)
const PROFILE_DIR = (() => {
  const raw = process.env.CHROME_USER_DATA_DIR ||
    path.join(os.homedir(), '.config', 'mcp-flow-google', 'chrome_profile');
  return raw.startsWith('~') ? raw.replace('~', os.homedir()) : raw;
})();

// Clear any stale lock files before launching
fs.mkdirSync(PROFILE_DIR, { recursive: true });
for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
  const p = path.join(PROFILE_DIR, lock);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

console.log('🌐 Opening Chrome (stealth mode — Google login allowed)...');
console.log('📁 Profile:', PROFILE_DIR);
console.log('');
console.log('→ Sign into your Google account if prompted.');
console.log('→ Navigate to labs.google/fx/tools/flow to confirm access.');
console.log('→ Press Ctrl+C when done — your session is saved.');
console.log('');

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  userDataDir: PROFILE_DIR,
  headless: false,
  defaultViewport: null,
  // Critical: removes --enable-automation so Google doesn't reject login
  ignoreDefaultArgs: ['--enable-automation'],
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--start-maximized',
    '--password-store=basic',
    '--use-mock-keychain',
  ],
});

const pages = await browser.pages();
const page = pages[0] ?? await browser.newPage();

// Hide navigator.webdriver — the main signal Google uses to detect automation
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  // @ts-ignore
  delete navigator.__proto__.webdriver;
});

await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded' });

console.log('✅ Chrome opened. If already signed in, you should see Google Flow.');
console.log('   Press Ctrl+C when done.\n');

// Stay open until user Ctrl+C
await new Promise(() => {});
