import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';

async function inspectCanvas() {
  const PROJECT_URL = 'https://labs.google/fx/tools/flow/project/29b1e02a-4959-4c8b-b21f-5b7531213678';
  console.log(`Connecting to Google Flow Project: ${PROJECT_URL}`);
  
  await browser.navigate(PROJECT_URL);
  const page = await browser.getPage();
  await sleep(4000);

  const snapshot = await captureSnapshot(page, []);
  console.log(`Page Title: ${snapshot.title}`);
  
  // Dump all img elements on page directly via evaluate
  const allImgs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.src,
      currentSrc: img.currentSrc,
      alt: img.alt,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      className: img.className,
      parentElement: img.parentElement?.tagName
    }));
  });

  console.log(`\nFound ${allImgs.length} Total Image Tags in Project Canvas:`);
  allImgs.forEach((img, idx) => {
    console.log(`[${idx + 1}] src="${img.src}" (${img.width}x${img.height}) parent=<${img.parentElement}> class="${img.className}"`);
  });

  process.exit(0);
}

inspectCanvas().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
