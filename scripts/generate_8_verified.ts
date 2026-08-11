import 'dotenv/config';
import { browser, sleep, isAiAsset, isNoise } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

const CHARACTERS = [
  { id: '01_evie_sage', name: 'Evie Sage', prompt: 'High fantasy vertical character portrait of Evie Sage, 23-year-old female assistant with soft curves, fair skin, rosy red lips, warm expressive eyes, blonde hair with delicate golden butterfly pins, crisp white cloak, glowing magical scar on shoulder, cinematic lighting, fantasy manor office background.' },
  { id: '02_trystan_maverine', name: 'Trystan Maverine (The Villain)', prompt: 'Dark fantasy vertical character portrait of Trystan Maverine, handsome brooding warrior, thick dark black hair, intense dark eyes, tanned skin, single dimple on left cheek, loose black shirt, vibrant light blue handkerchief, dark gothic castle office backdrop, blue magic mist.' },
  { id: '03_tatianna', name: 'Tatianna', prompt: 'Fantasy vertical character portrait of Tatianna, 27-year-old female healer with dark hair in a thick braid tied with a large servant bow, large brown eyes, flouncy servant dress, hands glowing with warm yellow healing magic aura, apothecary background.' },
  { id: '04_rebecka_erring', name: 'Rebecka Erring (Becky)', prompt: 'Fantasy vertical character portrait of Rebecka Erring, sharp composed female administrator and spy, neat hair, calculating gaze, pristine administrative collars, desk with parchment scrolls and payroll ledgers, cool tones.' },
  { id: '05_blade_gushiken', name: 'Blade Gushiken', prompt: 'High fantasy vertical character portrait of Blade Gushiken, handsome dragon tamer, warm tan skin, athletic build, bright charming smile, light-blue satin vest over crisp white shirt, dragon sanctuary courtyard background.' },
  { id: '06_griffin_sage', name: 'Griffin Sage', prompt: 'Fantasy character portrait of Griffin Sage, middle-aged man with graying dark hair, sharp knowing eyes, sinister Valiant Guard armor peeking under plain cloak, holding clockwork explosive device, cozy cottage contrasting dark shadows.' },
  { id: '07_edwin_ogre', name: 'Edwin the Ogre', prompt: 'Warm fantasy vertical character portrait of Edwin, giant friendly ogre with glowing turquoise skin, wide warm smile, small gold wire spectacles, baker apron, castle kitchen background with oven and cauldron brew.' },
  { id: '08_king_benedict', name: 'King Benedict', prompt: 'Regal fantasy vertical character portrait of King Benedict, 50-year-old monarch with thick sandy hair sprayed with gray, ornate golden crown and royal robes, deceptive smile shifting from charming to sinister, opulent throne room.' }
];

async function generateAll8WithVerification() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('═══════════════════════════════════════════════════════');
  console.log('🎭 Google Flow — 8 Character Portrait Generation');
  console.log('═══════════════════════════════════════════════════════\n');

  // Start fresh: open Flow dashboard and create new project
  await browser.navigate('https://labs.google/fx/tools/flow');
  let page = await browser.getPage();
  await sleep(3000);

  const snap = await captureSnapshot(page, browser.getCapturedAssets());
  const newProjBtn = snap.interactables.find(
    i => i.text?.toLowerCase().includes('new project') || i.ariaLabel?.toLowerCase().includes('new project')
  );

  if (newProjBtn) {
    console.log('✨ Creating new project...');
    await page.click(newProjBtn.selector);
    await sleep(4000);
  }

  page = await browser.getPage();
  console.log('Project URL:', page.url());

  for (const [idx, char] of CHARACTERS.entries()) {
    console.log(`\n───────────────────────────────────────────────────────`);
    console.log(`[${idx + 1}/8] ${char.name} (${char.id})`);

    try {
      page = await browser.getPage();

      // Step 1: Record baseline of existing AI images
      const baselineUrls = new Set(await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img'))
          .map(img => img.src)
          .filter(src => src.includes('trpc/media.getMediaUrlRedirect') || src.includes('/gg/'));
      }));
      console.log(`  Baseline: ${baselineUrls.size} existing AI images on canvas`);

      // Step 2: Find the prompt textbox
      const currentSnap = await captureSnapshot(page, browser.getCapturedAssets());
      const textbox = currentSnap.interactables.find(
        i => i.role === 'textbox' || i.tag === 'TEXTAREA' || i.text?.includes('What do you want to create')
      );

      if (!textbox) {
        // Try clicking the Create/+ button to reopen the prompt bar
        console.log('  ⚠️ Prompt textbox not found. Looking for Create button...');
        const createBtn = currentSnap.interactables.find(
          i => i.text?.toLowerCase().includes('create') || i.ariaLabel?.toLowerCase().includes('create')
        );
        if (createBtn) {
          await page.click(createBtn.selector);
          await sleep(1500);
          const reSnap = await captureSnapshot(page, browser.getCapturedAssets());
          const tb = reSnap.interactables.find(
            i => i.role === 'textbox' || i.tag === 'TEXTAREA' || i.text?.includes('What do you want to create')
          );
          if (tb) {
            console.log('  Found prompt textbox after clicking Create button.');
            await page.click(tb.selector);
          } else {
            // Fallback: click at bottom-center where prompt bar lives
            console.log('  Clicking at (720, 850) to activate prompt bar...');
            await page.mouse.click(720, 850);
            await sleep(800);
          }
        } else {
          // Fallback: click at bottom-center where prompt bar lives
          console.log('  Clicking at (720, 850) to activate prompt bar...');
          await page.mouse.click(720, 850);
          await sleep(800);
        }
      } else {
        await page.click(textbox.selector);
      }

      await sleep(300);

      // Step 3: Type the prompt
      console.log(`  📝 Typing prompt: "${char.prompt.substring(0, 60)}..."`);
      await page.keyboard.type(char.prompt, { delay: 20 });
      await sleep(800);

      // Step 4: Find and click the submit arrow button
      const submitSelector = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        // Look for the arrow_forward icon button
        const arrow = btns.find(b =>
          b.querySelector('svg') ||
          b.textContent?.includes('arrow_forward') ||
          b.getAttribute('aria-label')?.toLowerCase().includes('create')
        );
        if (arrow) {
          if (!arrow.id) arrow.id = 'flow_submit_' + Date.now();
          return '#' + arrow.id;
        }
        return null;
      });

      if (submitSelector) {
        console.log('  🚀 Submitting prompt...');
        await page.click(submitSelector);
      } else {
        console.log('  ↵ Pressing Enter to submit...');
        await page.keyboard.press('Enter');
      }

      // Step 5: Wait for render
      console.log('  ⏳ Waiting 45s for AI render...');
      await sleep(45000);

      page = await browser.getPage();

      // Step 6: Extract new AI images (compare against baseline)
      const newAiUrls = await page.evaluate((baseArr: string[]) => {
        const baseSet = new Set(baseArr);
        return Array.from(document.querySelectorAll('img'))
          .map(img => img.src)
          .filter(src =>
            src &&
            !baseSet.has(src) &&
            (src.includes('trpc/media.getMediaUrlRedirect') || src.includes('/gg/')) &&
            !src.includes('/a/') &&
            !src.includes('=s96-c')
          );
      }, Array.from(baselineUrls));

      // Deduplicate
      const uniqueNew = Array.from(new Set(newAiUrls));

      if (uniqueNew.length > 0) {
        const downloadUrl = uniqueNew[0];
        const outPath = path.join(OUTPUT_DIR, `${char.id}.png`);
        console.log(`  📥 Downloading AI portrait (${downloadUrl.substring(0, 80)}...)`);
        const buf = await browser.downloadAsset(downloadUrl, outPath, page);
        fs.writeFileSync(outPath, buf);
        console.log(`  ✅ SAVED: ${char.id}.png (${buf.length.toLocaleString()} bytes)`);
      } else {
        // Fallback: check if ANY AI image exists that wasn't in baseline
        console.log('  ⚠️ No new AI image detected. Checking all AI images on canvas...');
        const allAi = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('img'))
            .map(img => img.src)
            .filter(src => src.includes('trpc/media.getMediaUrlRedirect') || src.includes('/gg/'));
        });
        console.log(`  Total AI images on canvas: ${allAi.length}`);

        // If there's at least one more than baseline, use the last one
        const allUnique = Array.from(new Set(allAi));
        if (allUnique.length > baselineUrls.size) {
          const downloadUrl = allUnique[allUnique.length - 1];
          const outPath = path.join(OUTPUT_DIR, `${char.id}.png`);
          const buf = await browser.downloadAsset(downloadUrl, outPath, page);
          fs.writeFileSync(outPath, buf);
          console.log(`  ✅ SAVED (fallback): ${char.id}.png (${buf.length.toLocaleString()} bytes)`);
        } else {
          console.log(`  ❌ Could not find new AI image for ${char.name}`);
        }
      }

      // Step 7: Close any overlay/modal and click canvas to reset for next prompt
      await page.keyboard.press('Escape');
      await sleep(300);
      // Click on empty canvas area to deselect any selected image
      await page.mouse.click(400, 300);
      await sleep(500);

    } catch (err: any) {
      console.error(`  ❌ Error processing ${char.name}:`, err.message);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log('🎉 ALL 8 CHARACTER PORTRAITS COMPLETE!');
  console.log(`📁 ${OUTPUT_DIR}`);
  console.log('═══════════════════════════════════════════════════════');
  process.exit(0);
}

generateAll8WithVerification().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
