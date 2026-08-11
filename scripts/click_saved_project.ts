import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

async function clickProject() {
  console.log('Navigating to Google Flow main dashboard...');
  await browser.navigate('https://labs.google/fx/tools/flow');
  const page = await browser.getPage();
  await sleep(4000);

  // Click on the project card containing text "11:11 PM" or "11:05 PM"
  const clicked = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('*'));
    const target = allEls.find(el => 
      el.children.length === 0 && 
      (el.textContent?.includes('11:11 PM') || el.textContent?.includes('11:05 PM') || el.textContent?.includes('11:04 PM'))
    );
    if (target) {
      const parentCard = target.closest('button, a, [role="button"], div[class*="card"], div[class*="sc-"]') || target.parentElement;
      if (parentCard) {
        (parentCard as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  console.log('Clicked project card:', clicked);
  await sleep(5000);

  const currentUrl = page.url();
  console.log('Active Project URL:', currentUrl);

  await page.screenshot({ path: '/tmp/active_project_view.png' });
  console.log('Saved screenshot: /tmp/active_project_view.png');

  // Extract all media image URLs on this project page
  const images = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img'))
      .map(img => img.src)
      .filter(src => 
        src && 
        !src.includes('googleusercontent.com/a/') && // EXCLUDE GOOGLE USER PROFILE PHOTO!
        !src.includes('=s96-c') && 
        !src.includes('zero_states') && 
        !src.includes('gstatic.com') && 
        !src.includes('avatar') &&
        !src.includes('logo') &&
        (src.includes('googleusercontent.com/gg/') || src.includes('fife') || src.includes('ai-sandbox') || src.includes('getMedia'))
      );
  });

  console.log(`\nFound ${images.length} Real Generated AI Images:`);
  images.forEach((url, i) => console.log(`[${i + 1}] ${url}`));

  process.exit(0);
}

clickProject().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
