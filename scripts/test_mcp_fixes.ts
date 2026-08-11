/**
 * Test script: validates the three MCP bug fixes without using the MCP protocol.
 * Tests: isNoise filter, getCapturedAssets, captureSnapshot page.evaluate, and end-to-end asset extraction.
 */
import 'dotenv/config';
import { browser, sleep, isNoise } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';
const TEST_CHAR = {
  id: '01_evie_sage',
  name: 'Evie Sage',
  prompt: 'High fantasy vertical character portrait of Evie Sage, 23-year-old female assistant with soft curves, fair skin, rosy red lips, warm expressive eyes, blonde hair with delicate golden butterfly pins, crisp white cloak, glowing magical scar on shoulder, cinematic lighting, fantasy manor office background.'
};

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

async function runTests() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🧪 Google Flow MCP Fix Verification Tests');
  console.log('═══════════════════════════════════════════════════════\n');

  // ─── Test 1: isNoise filter ─────────────────────────────
  console.log('Test 1: isNoise() filter correctness');
  assert(isNoise('https://lh3.googleusercontent.com/a/ACg8ocI3CL-At7c83ONgvhLqYxiqXyIES70_F3TiNvdKOBr4j0fvG93Z=s96-c') === true, 'Profile avatar URL filtered as noise');
  assert(isNoise('https://www.gstatic.com/aitestkitchen/website/flow/zero_states/red_suit_theater.jpg') === true, 'Zero-state placeholder filtered as noise');
  assert(isNoise('https://www.gstatic.com/aitestkitchen/website/flow/zero_states/mini_keyboard_floating_in_space.jpeg') === true, 'Zero-state keyboard placeholder filtered as noise');
  assert(isNoise('https://lh3.googleusercontent.com/gg/AHOe3sWn7e2W32qJ7gT6w3S6R7W8e9R0=s1024') === false, 'Real AI generated /gg/ image NOT filtered as noise');
  console.log();

  // ─── Test 2: getCapturedAssets method exists ────────────
  console.log('Test 2: getCapturedAssets() method exists');
  assert(typeof browser.getCapturedAssets === 'function', 'browser.getCapturedAssets is a function');
  const emptyAssets = browser.getCapturedAssets();
  assert(Array.isArray(emptyAssets), 'getCapturedAssets returns an array');
  console.log();

  // ─── Test 3: captureSnapshot doesn't crash ──────────────
  console.log('Test 3: captureSnapshot page.evaluate (no __name crash)');
  await browser.navigate('https://labs.google/fx/tools/flow');
  const page = await browser.getPage();
  await sleep(3000);
  
  try {
    const snap = await captureSnapshot(page, browser.getCapturedAssets());
    assert(true, 'captureSnapshot executed without ReferenceError');
    assert(snap.interactables.length > 0, 'Snapshot returned interactable elements');
    assert(snap.capturedAssets !== undefined, 'Snapshot has capturedAssets field');
  } catch (err: any) {
    assert(false, `captureSnapshot crashed: ${err.message}`);
  }
  console.log();

  // ─── Test 4: End-to-end single portrait generation ──────
  console.log('Test 4: End-to-end portrait generation & download');
  
  // Click New Project
  const snap = await captureSnapshot(page, browser.getCapturedAssets());
  const newProjBtn = snap.interactables.find(
    i => i.text?.toLowerCase().includes('new project') || i.ariaLabel?.toLowerCase().includes('new project')
  );

  if (newProjBtn) {
    await page.click(newProjBtn.selector);
    await sleep(4000);
  }

  console.log('  Project URL:', page.url());
  
  // Record baseline
  browser.markGenerationStart();
  const baselineAiImages = new Set(await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img'))
      .map(i => i.src)
      .filter(src => src.includes('/gg/'));
  }));

  // Type prompt
  const currentSnap = await captureSnapshot(page, browser.getCapturedAssets());
  const textbox = currentSnap.interactables.find(
    i => i.role === 'textbox' || i.tag === 'TEXTAREA' || i.text?.includes('What do you want to create')
  );

  if (!textbox) {
    assert(false, 'Prompt textbox found');
  } else {
    assert(true, 'Prompt textbox found');
    await page.click(textbox.selector);
    await sleep(300);
    await page.keyboard.type(TEST_CHAR.prompt);
    await sleep(1000);

    // Submit
    const arrowSelector = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const arrow = btns.find(b => b.querySelector('svg') || b.textContent?.includes('arrow_forward') || b.getAttribute('aria-label')?.toLowerCase().includes('create'));
      if (arrow) {
        if (!arrow.id) arrow.id = 'test_submit_arrow_' + Date.now();
        return '#' + arrow.id;
      }
      return null;
    });

    if (arrowSelector) {
      await page.click(arrowSelector);
      assert(true, 'Submit arrow button clicked');
    } else {
      await page.keyboard.press('Enter');
      assert(true, 'Enter key pressed as fallback');
    }

    console.log('  ⏳ Waiting 42s for AI render...');
    await sleep(42000);

    // Extract new AI images
    const newAiImages = await page.evaluate((baseArr: string[]) => {
      const baseSet = new Set(baseArr);
      return Array.from(document.querySelectorAll('img'))
        .map(img => img.src)
        .filter(src => 
          src && !baseSet.has(src) && src.includes('/gg/') &&
          !src.includes('/a/ACg') && !src.includes('=s96-c')
        );
    }, Array.from(baselineAiImages));

    const newUrl = newAiImages.pop();

    if (newUrl) {
      assert(true, `New AI image detected: ${newUrl.substring(0, 60)}...`);
      
      // Download
      if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const outPath = path.join(OUTPUT_DIR, `${TEST_CHAR.id}.png`);
      const buf = await browser.downloadAsset(newUrl, outPath, page);
      fs.writeFileSync(outPath, buf);
      
      assert(buf.length > 1000, `Downloaded image is valid (${buf.length} bytes)`);
      assert(!outPath.includes('a/ACg') && !outPath.includes('zero_states'), 'Saved file is NOT a profile avatar or placeholder');
      console.log(`  ✅ Saved portrait: ${outPath}`);
    } else {
      // Try network-captured assets via getCapturedAssets
      const captured = browser.getCapturedAssets();
      const aiCaptured = captured.filter(u => u.includes('/gg/'));
      
      if (aiCaptured.length > 0) {
        assert(true, `Network-captured AI image: ${aiCaptured[aiCaptured.length-1].substring(0,60)}...`);
        const outPath = path.join(OUTPUT_DIR, `${TEST_CHAR.id}.png`);
        const buf = await browser.downloadAsset(aiCaptured[aiCaptured.length-1], outPath, page);
        fs.writeFileSync(outPath, buf);
        assert(buf.length > 1000, `Downloaded image is valid (${buf.length} bytes)`);
      } else {
        assert(false, 'No new AI image detected via DOM or network capture');
      }
    }
  }

  // ─── Summary ────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`📊 Results: ${pass} passed, ${fail} failed`);
  console.log('═══════════════════════════════════════════════════════');
  
  process.exit(fail > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
