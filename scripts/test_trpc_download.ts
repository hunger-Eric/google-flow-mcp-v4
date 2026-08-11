/**
 * Test: Navigate to existing project canvas, extract the trpc media image, download it.
 * This validates that the trpc/media.getMediaUrlRedirect URL pattern is correctly captured.
 */
import 'dotenv/config';
import { browser, sleep, isNoise, isAiAsset } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    pass++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    fail++;
  }
}

async function runTest() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🧪 Test: trpc Media URL Extraction & Download');
  console.log('═══════════════════════════════════════════════════════\n');

  // ─── Unit tests for isAiAsset + isNoise ──────────────────
  console.log('Unit: isAiAsset() & isNoise() correctness');
  assert(isAiAsset('https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=f046b4c9-abf9-493...') === true, 'trpc media URL is AI asset');
  assert(isAiAsset('https://lh3.googleusercontent.com/gg/AHOe3sWn7e2W32qJ7gT6w3S6R7W8e9R0=s1024') === true, '/gg/ URL is AI asset');
  assert(isAiAsset('https://lh3.googleusercontent.com/a/ACg8ocI3CL=s96-c') === false, 'Profile avatar is NOT AI asset');
  assert(isAiAsset('https://www.gstatic.com/aitestkitchen/website/flow/zero_states/red_suit_theater.jpg') === false, 'Zero-state is NOT AI asset');
  assert(isNoise('https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=f046b4c9') === false, 'trpc URL NOT filtered as noise');
  assert(isNoise('https://www.gstatic.com/aitestkitchen/website/flow/banners/2026-07-15-52de2576') === true, 'Banner image filtered as noise');
  console.log();

  // ─── End-to-end: navigate to project, extract trpc image, download ────
  console.log('E2E: Navigate to project & download via trpc URL');

  // Open the project we created in the previous test run
  const projectUrl = 'https://labs.google/fx/tools/flow/project/0df1e42e-1a95-4a03-9afb-f7f88a718f4d';
  console.log(`  Opening project: ${projectUrl}`);
  await browser.navigate(projectUrl);
  const page = await browser.getPage();
  await sleep(5000);

  // Screenshot to see what's on canvas
  await page.screenshot({ path: '/tmp/project_canvas_test.png' });
  console.log('  Saved screenshot: /tmp/project_canvas_test.png');

  // Extract ALL image URLs and classify them
  const allImages = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.src,
      w: img.naturalWidth,
      h: img.naturalHeight,
    }));
  });

  console.log(`\n  Found ${allImages.length} images on canvas:`);
  allImages.forEach((img, i) => {
    const ai = isAiAsset(img.src);
    const noise = isNoise(img.src);
    const tag = ai ? '✨ AI' : noise ? '🚫 NOISE' : '❓ UNKNOWN';
    console.log(`  [${i+1}] ${tag} ${img.w}x${img.h} | ${img.src.substring(0, 100)}...`);
  });

  // Find the AI generated image
  const aiImages = allImages.filter(img => isAiAsset(img.src) && !isNoise(img.src));
  console.log(`\n  AI images found: ${aiImages.length}`);

  assert(aiImages.length > 0, `Found ${aiImages.length} AI generated image(s) on canvas`);

  if (aiImages.length > 0) {
    const aiUrl = aiImages[0].src;
    console.log(`  AI image URL: ${aiUrl.substring(0, 120)}...`);

    // Download it
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outPath = path.join(OUTPUT_DIR, 'test_trpc_download.png');

    try {
      const buf = await browser.downloadAsset(aiUrl, outPath, page);
      fs.writeFileSync(outPath, buf);
      assert(buf.length > 10000, `Downloaded file is valid (${buf.length} bytes)`);
      
      // Check file type
      const fileOutput = fs.readFileSync(outPath);
      const isPng = fileOutput[0] === 0x89 && fileOutput[1] === 0x50;
      const isJpeg = fileOutput[0] === 0xFF && fileOutput[1] === 0xD8;
      assert(isPng || isJpeg, `Downloaded file is a valid image (PNG=${isPng}, JPEG=${isJpeg})`);
      console.log(`  ✅ Saved: ${outPath} (${buf.length} bytes)`);
    } catch (err: any) {
      assert(false, `Download failed: ${err.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`📊 Results: ${pass} passed, ${fail} failed`);
  console.log('═══════════════════════════════════════════════════════');
  process.exit(fail > 0 ? 1 : 0);
}

runTest().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
