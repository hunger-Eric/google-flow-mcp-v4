import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_URL = 'https://labs.google/fx/tools/flow/project/42ddcf66-f297-42c9-940f-c08ae4481208';
const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

const CHARACTERS = [
  '01_evie_sage.png',
  '02_trystan_maverine.png',
  '03_tatianna.png',
  '04_rebecka_erring.png',
  '05_blade_gushiken.png',
  '06_griffin_sage.png',
  '07_edwin_ogre.png',
  '08_king_benedict.png'
];

async function downloadGallery() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Navigating to project canvas: ${PROJECT_URL}`);
  await browser.navigate(PROJECT_URL);
  const page = await browser.getPage();
  await sleep(4000);

  // Click "All Media" on left sidebar
  const snap = await captureSnapshot(page, []);
  const allMediaBtn = snap.interactables.find(
    i => i.text?.toLowerCase().includes('all media') || i.ariaLabel?.toLowerCase().includes('all media')
  );

  if (allMediaBtn) {
    console.log(`Clicking All Media tab [${allMediaBtn.ref}]...`);
    await page.click(allMediaBtn.selector);
    await sleep(4000);
  }

  await page.screenshot({ path: '/tmp/all_media_gallery.png' });
  console.log('Saved screenshot: /tmp/all_media_gallery.png');

  // Extract all images rendered on page or shadow DOM
  const imageUrls = await page.evaluate(() => {
    const urls: string[] = [];
    const imgs = Array.from(document.querySelectorAll('img'));
    for (const img of imgs) {
      if (img.src && !img.src.includes('/a/ACg') && !img.src.includes('=s96-c')) {
        urls.push(img.src);
      }
    }
    // Also check background images or canvas elements
    const divs = Array.from(document.querySelectorAll('div[style*="background-image"]'));
    for (const div of divs) {
      const bg = window.getComputedStyle(div).backgroundImage;
      const m = bg.match(/url\(["']?(https?:[^"']+)["']?\)/);
      if (m && !m[1].includes('/a/ACg')) urls.push(m[1]);
    }
    return Array.from(new Set(urls));
  });

  console.log(`\n🎉 Extracted ${imageUrls.length} image URLs from All Media gallery:`);
  imageUrls.forEach((u, idx) => console.log(`[${idx + 1}] ${u}`));

  for (let i = 0; i < Math.min(imageUrls.length, CHARACTERS.length); i++) {
    const filename = CHARACTERS[i];
    const url = imageUrls[i];
    const outPath = path.join(OUTPUT_DIR, filename);

    console.log(`\n📥 Downloading [${i + 1}/${CHARACTERS.length}] ${filename} from ${url}...`);
    try {
      const buf = await browser.downloadAsset(url, outPath, page);
      fs.writeFileSync(outPath, buf);
      console.log(`✅ SAVED PORTRAIT: ${outPath}`);
    } catch (err: any) {
      console.error(`❌ Error downloading ${filename}:`, err.message);
    }
  }

  process.exit(0);
}

downloadGallery().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
