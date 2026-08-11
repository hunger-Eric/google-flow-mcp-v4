import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_URL = 'https://labs.google/fx/tools/flow/project/99166f36-5452-4752-b883-9eb1011ff18d';
const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

const CHARACTERS = [
  '01_evie_sage',
  '02_trystan_maverine',
  '03_tatianna',
  '04_rebecka_erring',
  '05_blade_gushiken',
  '06_griffin_sage',
  '07_edwin_ogre',
  '08_king_benedict'
];

async function extractAndSaveAll() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Connecting to Google Flow Project: ${PROJECT_URL}`);
  await browser.navigate(PROJECT_URL);
  const page = await browser.getPage();
  await sleep(5000);

  // Extract all AI generated images from Google Flow canvas DOM
  const aiImages = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img'))
      .map(img => img.src)
      .filter(src => 
        src && 
        !src.includes('zero_states') && 
        !src.includes('gstatic.com') && 
        !src.includes('=s96-c') && 
        !src.includes('avatar') &&
        !src.includes('logo') &&
        (src.includes('googleusercontent.com') || src.includes('/gg/') || src.includes('lh3.'))
      );
  });

  console.log(`\n🎉 Found ${aiImages.length} AI Generated Portrait Images on Canvas!`);
  aiImages.forEach((url, i) => console.log(`[${i + 1}] ${url}`));

  for (let i = 0; i < Math.min(aiImages.length, CHARACTERS.length); i++) {
    const id = CHARACTERS[i];
    const url = aiImages[i];
    const outPath = path.join(OUTPUT_DIR, `${id}.png`);

    console.log(`\n📥 Downloading [${i + 1}/${CHARACTERS.length}] ${id} from ${url}...`);
    try {
      const buf = await browser.downloadAsset(url, outPath, page);
      fs.writeFileSync(outPath, buf);
      console.log(`✅ Saved: ${outPath}`);
    } catch (err: any) {
      console.error(`❌ Error downloading ${id}:`, err.message);
    }
  }

  console.log(`\n=======================================================`);
  console.log(`✨ All Character Portraits Extracted & Saved to Disk!`);
  console.log(`📁 Directory: ${OUTPUT_DIR}`);
  console.log(`=======================================================`);
  process.exit(0);
}

extractAndSaveAll().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
