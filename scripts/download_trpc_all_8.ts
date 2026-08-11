import 'dotenv/config';
import { browser, sleep, isAiAsset, isNoise } from '../src/browser.js';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_URL = 'https://labs.google/fx/tools/flow/project/0df1e42e-1a95-4a03-9afb-f7f88a718f4d';
const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

const FILENAMES = [
  '01_evie_sage.png',
  '02_trystan_maverine.png',
  '03_tatianna.png',
  '04_rebecka_erring.png',
  '05_blade_gushiken.png',
  '06_griffin_sage.png',
  '07_edwin_ogre.png',
  '08_king_benedict.png'
];

async function downloadAll8() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Opening project: ${PROJECT_URL}`);
  await browser.navigate(PROJECT_URL);
  const page = await browser.getPage();
  await sleep(5000);

  // Extract unique AI image URLs
  const allImages = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.src,
      w: img.naturalWidth,
      h: img.naturalHeight,
    }));
  });

  // Filter for unique AI assets
  const seen = new Set<string>();
  const uniqueAi: string[] = [];
  for (const img of allImages) {
    if (isAiAsset(img.src) && !isNoise(img.src) && !seen.has(img.src)) {
      seen.add(img.src);
      uniqueAi.push(img.src);
    }
  }

  console.log(`\nFound ${uniqueAi.length} unique AI images on canvas`);
  uniqueAi.forEach((url, i) => console.log(`  [${i + 1}] ${url.substring(0, 100)}...`));

  for (let i = 0; i < Math.min(uniqueAi.length, FILENAMES.length); i++) {
    const url = uniqueAi[i];
    const filename = FILENAMES[i];
    const outPath = path.join(OUTPUT_DIR, filename);

    console.log(`\n📥 [${i + 1}/${FILENAMES.length}] Downloading ${filename}...`);
    try {
      const buf = await browser.downloadAsset(url, outPath, page);
      fs.writeFileSync(outPath, buf);
      console.log(`✅ SAVED: ${outPath} (${buf.length} bytes)`);
    } catch (err: any) {
      console.error(`❌ Error downloading ${filename}: ${err.message}`);
    }
  }

  console.log(`\n=======================================================`);
  console.log(`🎉 ALL 8 PORTRAITS DOWNLOADED!`);
  console.log(`📁 ${OUTPUT_DIR}`);
  console.log(`=======================================================`);
  process.exit(0);
}

downloadAll8().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
