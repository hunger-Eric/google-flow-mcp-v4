import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';
import fs from 'node:fs';

async function inspectCurrentCanvas() {
  // Navigate to the project we just created in the test
  console.log('Opening latest project...');
  await browser.navigate('https://labs.google/fx/tools/flow');
  const page = await browser.getPage();
  await sleep(4000);

  // Screenshot the full page
  await page.screenshot({ path: '/tmp/flow_dashboard_full.png', fullPage: true });
  console.log('Saved: /tmp/flow_dashboard_full.png');

  // Get all image URLs on page with their dimensions
  const allImages = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.src,
      alt: img.alt,
      width: img.naturalWidth,
      height: img.naturalHeight,
      displayWidth: img.width,
      displayHeight: img.height,
    }));
  });

  console.log(`\nFound ${allImages.length} total <img> elements on page:`);
  allImages.forEach((img, i) => {
    const isAvatar = img.src.includes('/a/') || img.src.includes('=s96-c');
    const isZeroState = img.src.includes('zero_states/') || img.src.includes('gstatic.com/aitestkitchen/');
    const isAi = img.src.includes('/gg/');
    const tag = isAvatar ? '👤 AVATAR' : isZeroState ? '🖼️ ZERO_STATE' : isAi ? '✨ AI_GENERATED' : '❓ UNKNOWN';
    console.log(`[${i+1}] ${tag} ${img.width}x${img.height} | ${img.src.substring(0, 80)}...`);
  });

  // Also check for canvas elements
  const canvasElements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('canvas')).map(c => ({
      width: c.width,
      height: c.height,
      id: c.id,
      className: c.className,
    }));
  });

  console.log(`\nFound ${canvasElements.length} <canvas> elements:`);
  canvasElements.forEach((c, i) => console.log(`[${i+1}] ${c.width}x${c.height} id=${c.id} class=${c.className}`));

  // Check for background-image divs
  const bgImages = await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('div'));
    return divs
      .map(d => {
        const bg = window.getComputedStyle(d).backgroundImage;
        if (bg && bg !== 'none') {
          const m = bg.match(/url\(["']?(https?:[^"')]+)["']?\)/);
          return m ? m[1] : null;
        }
        return null;
      })
      .filter(Boolean);
  });

  console.log(`\nFound ${bgImages.length} div background images:`);
  bgImages.forEach((url, i) => console.log(`[${i+1}] ${url.substring(0, 80)}...`));

  process.exit(0);
}

inspectCurrentCanvas().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
