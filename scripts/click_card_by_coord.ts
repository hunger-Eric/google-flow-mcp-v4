import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

async function openCardByCoord() {
  console.log('Navigating to Google Flow main dashboard...');
  await browser.navigate('https://labs.google/fx/tools/flow');
  const page = await browser.getPage();
  await sleep(4000);

  // Click top-left project card at (150, 180)
  console.log('Clicking top-left project card at (150, 180)...');
  await page.mouse.click(150, 180);
  await sleep(5000);

  const activeUrl = page.url();
  console.log('Active URL after click:', activeUrl);

  await page.screenshot({ path: '/tmp/opened_card_canvas.png' });
  console.log('Saved screenshot: /tmp/opened_card_canvas.png');

  // Extract all AI generated image URLs on canvas
  const images = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img'))
      .map(img => img.src)
      .filter(src => 
        src && 
        !src.includes('/a/ACg') && // EXCLUDE PROFILE AVATAR PHOTO!
        !src.includes('=s96-c') && 
        !src.includes('zero_states') && 
        !src.includes('gstatic.com') && 
        !src.includes('avatar') &&
        !src.includes('logo') &&
        (src.includes('googleusercontent.com/gg/') || src.includes('fife') || src.includes('ai-sandbox') || src.includes('getMedia') || src.includes('=s1024'))
      );
  });

  console.log(`\nFound ${images.length} Real Generated AI Images:`);
  images.forEach((url, i) => console.log(`[${i + 1}] ${url}`));

  process.exit(0);
}

openCardByCoord().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
