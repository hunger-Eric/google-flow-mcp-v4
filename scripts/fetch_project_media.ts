import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_URL = 'https://labs.google/fx/tools/flow/project/99166f36-5452-4752-b883-9eb1011ff18d';
const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

async function fetchMedia() {
  console.log(`Connecting to Google Flow Project: ${PROJECT_URL}`);
  await browser.navigate(PROJECT_URL);
  const page = await browser.getPage();
  await sleep(4000);

  let snap = await captureSnapshot(page, []);
  
  // Click "All Media" button on left sidebar
  const allMediaBtn = snap.interactables.find(
    i => i.text?.toLowerCase().includes('all media') || i.ariaLabel?.toLowerCase().includes('all media')
  );

  if (allMediaBtn) {
    console.log(`Clicking "All Media" sidebar tab [${allMediaBtn.ref}]...`);
    await page.click(allMediaBtn.selector);
    await sleep(3000);
  }

  await page.screenshot({ path: '/tmp/flow_all_media.png' });
  console.log('Saved screenshot: /tmp/flow_all_media.png');

  // Extract all img tags
  const images = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(i => ({
      src: i.src,
      currentSrc: i.currentSrc,
      alt: i.alt,
      width: i.naturalWidth || i.width,
      height: i.naturalHeight || i.height,
      parent: i.parentElement?.tagName,
      className: i.className
    }));
  });

  console.log(`\nFound ${images.length} Total Image elements on All Media page:`);
  images.forEach((img, index) => {
    console.log(`[${index + 1}] src="${img.src}" (${img.width}x${img.height}) alt="${img.alt}"`);
  });

  process.exit(0);
}

fetchMedia().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
