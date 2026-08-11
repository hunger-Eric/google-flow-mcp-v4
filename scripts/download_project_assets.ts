import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_URL = 'https://labs.google/fx/tools/flow/project/95039193-d845-403e-a1c9-f54b44a647ed';
const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

async function downloadProjectAssets() {
  console.log(`Connecting to Google Flow Project: ${PROJECT_URL}`);
  await browser.navigate(PROJECT_URL);
  const page = await browser.getPage();
  await sleep(5000);

  await page.screenshot({ path: '/tmp/project_9503_canvas.png' });
  console.log('Saved screenshot: /tmp/project_9503_canvas.png');

  // Extract all AI image URLs (googleusercontent.com/gg/)
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

  console.log(`\n🎉 Found ${aiImages.length} Real AI Generated Images in Project:`);
  aiImages.forEach((url, i) => console.log(`[${i + 1}] ${url}`));

  const filenames = ['01_evie_sage.png', '02_trystan_maverine.png', '03_tatianna.png', '04_rebecka_erring.png', '05_blade_gushiken.png', '06_griffin_sage.png', '07_edwin_ogre.png', '08_king_benedict.png'];

  for (let i = 0; i < aiImages.length; i++) {
    const url = aiImages[i];
    const name = filenames[i] || `portrait_${i+1}.png`;
    const outPath = path.join(OUTPUT_DIR, name);
    console.log(`📥 Downloading [${i+1}/${aiImages.length}] ${name} from ${url}...`);
    try {
      const buf = await browser.downloadAsset(url, outPath, page);
      fs.writeFileSync(outPath, buf);
      console.log(`✅ SAVED: ${outPath}`);
    } catch (err: any) {
      console.error(`❌ Error downloading ${name}:`, err.message);
    }
  }

  process.exit(0);
}

downloadProjectAssets().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
