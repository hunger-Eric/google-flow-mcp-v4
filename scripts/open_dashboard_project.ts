import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

async function openLatestProject() {
  console.log('Navigating to Google Flow dashboard...');
  await browser.navigate('https://labs.google/fx/tools/flow');
  const page = await browser.getPage();
  await sleep(4000);

  const snap = await captureSnapshot(page, []);
  
  // Find project cards (elements containing text "Aug 10" or links to /project/)
  const projectCards = snap.interactables.filter(
    i => i.text?.includes('Aug 10') || i.selector.includes('project') || (i.tag === 'A' && i.selector.includes('/project/'))
  );

  console.log(`Found ${projectCards.length} project cards.`);
  projectCards.forEach((c, idx) => {
    console.log(`[${idx + 1}] text="${c.text}" sel="${c.selector}"`);
  });

  // Click the top left project card (Aug 10, 11:11 PM or 11:05 PM)
  const targetCard = projectCards[0] || snap.interactables.find(i => i.text?.includes('11:11 PM') || i.text?.includes('11:05 PM'));

  if (targetCard) {
    console.log(`\nClicking project card [${targetCard.ref}] (${targetCard.text})...`);
    await page.click(targetCard.selector);
    await sleep(5000);
  } else {
    // Click the first card visually at top left
    console.log('Clicking top-left card coordinates...');
    await page.mouse.click(100, 150);
    await sleep(5000);
  }

  console.log('Opened project URL:', page.url());
  await page.screenshot({ path: '/tmp/project_opened.png' });
  console.log('Saved screenshot: /tmp/project_opened.png');

  // Extract images
  const images = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img'))
      .map(img => img.src)
      .filter(src => 
        src && 
        !src.includes('zero_states') && 
        !src.includes('gstatic.com') && 
        !src.includes('=s96-c') && 
        !src.includes('avatar') &&
        !src.includes('logo')
      );
  });

  console.log(`Found ${images.length} AI generated images in this project:`);
  images.forEach((url, i) => console.log(`[${i + 1}] ${url}`));

  process.exit(0);
}

openLatestProject().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
