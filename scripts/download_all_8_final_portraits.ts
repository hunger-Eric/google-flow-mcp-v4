import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_URL = 'https://labs.google/fx/tools/flow/project/42ddcf66-f297-42c9-940f-c08ae4481208';
const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

const CHARACTERS = [
  { id: '01_evie_sage', name: 'Evie Sage' },
  { id: '02_trystan_maverine', name: 'Trystan Arthur Maverine (The Villain)' },
  { id: '03_tatianna', name: 'Tatianna' },
  { id: '04_rebecka_erring', name: 'Rebecka Erring (Becky)' },
  { id: '05_blade_gushiken', name: 'Blade Gushiken' },
  { id: '06_griffin_sage', name: 'Griffin Sage' },
  { id: '07_edwin_ogre', name: 'Edwin the Ogre' },
  { id: '08_king_benedict', name: 'King Benedict' }
];

async function downloadAllFinal() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Connecting to Google Flow Project: ${PROJECT_URL}`);
  await browser.navigate(PROJECT_URL);
  const page = await browser.getPage();
  await sleep(6000);

  // Extract all AI image URLs from the canvas DOM
  const aiImages = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img'))
      .map(img => img.src)
      .filter(src => 
        src && 
        src.includes('/gg/') && 
        !src.includes('/a/ACg') && 
        !src.includes('=s96-c')
      );
  });

  console.log(`\n🎉 Found ${aiImages.length} AI Generated Portrait Images on Canvas!`);
  aiImages.forEach((url, i) => console.log(`[${i + 1}] ${url}`));

  for (let i = 0; i < Math.min(aiImages.length, CHARACTERS.length); i++) {
    const char = CHARACTERS[i];
    const url = aiImages[i];
    const outPath = path.join(OUTPUT_DIR, `${char.id}.png`);

    console.log(`\n📥 Downloading [${i + 1}/${CHARACTERS.length}] ${char.name} (${char.id}) from ${url}...`);
    try {
      const buf = await browser.downloadAsset(url, outPath, page);
      fs.writeFileSync(outPath, buf);
      console.log(`✅ SAVED: ${outPath}`);
    } catch (err: any) {
      console.error(`❌ Error downloading ${char.name}:`, err.message);
    }
  }

  console.log(`\n=======================================================`);
  console.log(`🎉 ALL 8 CHARACTER PORTRAITS DOWNLOADED & SAVED TO DISK!`);
  console.log(`📁 Directory: ${OUTPUT_DIR}`);
  console.log(`=======================================================`);
  process.exit(0);
}

downloadAllFinal().catch(err => {
  console.error('Fatal download error:', err);
  process.exit(1);
});
