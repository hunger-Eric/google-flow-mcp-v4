import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_NAME = 'ASSISTANT_TO_THE_VILLAIN';
const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

const CHARACTERS = [
  {
    id: '01_evie_sage',
    name: 'Evie Sage',
    prompt: 'High fantasy vertical character portrait of Evie Sage, 23-year-old female assistant with soft curves, fair skin, rosy red lips, warm expressive eyes, blonde hair with delicate golden butterfly pins, crisp white cloak, glowing magical scar on shoulder, cinematic lighting, fantasy manor office background.'
  },
  {
    id: '02_trystan_maverine',
    name: 'Trystan Arthur Maverine (The Villain)',
    prompt: 'Dark fantasy vertical character portrait of Trystan Maverine, handsome brooding warrior, thick dark black hair, intense dark eyes, tanned skin, single dimple on left cheek, loose black shirt, vibrant light blue handkerchief, dark gothic castle office backdrop, blue magic mist.'
  },
  {
    id: '03_tatianna',
    name: 'Tatianna',
    prompt: 'Fantasy vertical character portrait of Tatianna, 27-year-old female healer with dark hair in a thick braid tied with a large servant bow, large brown eyes, flouncy servant dress, hands glowing with warm yellow healing magic aura, apothecary background.'
  },
  {
    id: '04_rebecka_erring',
    name: 'Rebecka Erring (Becky)',
    prompt: 'Fantasy vertical character portrait of Rebecka Erring, sharp composed female administrator and spy, neat hair, calculating gaze, pristine administrative collars, desk with parchment scrolls and payroll ledgers, cool tones.'
  },
  {
    id: '05_blade_gushiken',
    name: 'Blade Gushiken',
    prompt: 'High fantasy vertical character portrait of Blade Gushiken, handsome dragon tamer, warm tan skin, athletic build, bright charming smile, light-blue satin vest over crisp white shirt, dragon sanctuary courtyard background.'
  },
  {
    id: '06_griffin_sage',
    name: 'Griffin Sage',
    prompt: 'Fantasy character portrait of Griffin Sage, middle-aged man with graying dark hair, sharp knowing eyes, sinister Valiant Guard armor peeking under plain cloak, holding clockwork explosive device, cozy cottage contrasting dark shadows.'
  },
  {
    id: '07_edwin_ogre',
    name: 'Edwin the Ogre',
    prompt: 'Warm fantasy vertical character portrait of Edwin, giant friendly ogre with glowing turquoise skin, wide warm smile, small gold wire spectacles, baker apron, castle kitchen background with oven and cauldron brew.'
  },
  {
    id: '08_king_benedict',
    name: 'King Benedict',
    prompt: 'Regal fantasy vertical character portrait of King Benedict, 50-year-old monarch with thick sandy hair sprayed with gray, ornate golden crown and royal robes, deceptive smile shifting from charming to sinister, opulent throne room.'
  }
];

async function generateSequentially() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`=======================================================`);
  console.log(`🎭 Google Flow Sequential Batch Generator`);
  console.log(`📌 Project: ${PROJECT_NAME}`);
  console.log(`📁 Output: ${OUTPUT_DIR}`);
  console.log(`=======================================================\n`);

  await browser.navigate('https://labs.google/fx/tools/flow');
  let page = await browser.getPage();
  await sleep(3000);

  // Click "New project"
  const snap = await captureSnapshot(page, []);
  const newProjBtn = snap.interactables.find(
    i => i.text?.toLowerCase().includes('new project') || i.ariaLabel?.toLowerCase().includes('new project')
  );

  if (newProjBtn) {
    console.log(`✨ Creating new project canvas...`);
    await page.click(newProjBtn.selector);
    await sleep(4000);
  }

  page = await browser.getPage();
  console.log('Active Project URL:', page.url());

  for (const [idx, char] of CHARACTERS.entries()) {
    console.log(`\n-------------------------------------------------------`);
    console.log(`[${idx + 1}/${CHARACTERS.length}] Processing: ${char.name} (${char.id})`);

    try {
      page = await browser.getPage();

      // Clear selection overlay by clicking empty space
      await page.keyboard.press('Escape');
      await sleep(300);
      await page.mouse.click(600, 200);
      await sleep(500);

      let currentSnap = await captureSnapshot(page, []);

      // If textbox is not visible, click "Create" button or "+" button to open prompt bar
      let textbox = currentSnap.interactables.find(
        i => i.role === 'textbox' || i.tag === 'TEXTAREA' || i.text?.includes('What do you want to create')
      );

      if (!textbox) {
        const createBtn = currentSnap.interactables.find(
          i => i.text?.toLowerCase().includes('create') || i.text?.includes('add_2') || i.ariaLabel?.toLowerCase().includes('create')
        );

        if (createBtn) {
          console.log(`Opening prompt box via Create button [${createBtn.ref}]...`);
          await page.click(createBtn.selector);
          await sleep(1000);
          currentSnap = await captureSnapshot(page, []);
          textbox = currentSnap.interactables.find(
            i => i.role === 'textbox' || i.tag === 'TEXTAREA' || i.text?.includes('What do you want to create')
          );
        }
      }

      if (!textbox) {
        console.log('⚠️ Prompt box could not be opened. Trying direct keyboard click at (720, 850)...');
        await page.mouse.click(720, 850);
        await sleep(500);
      }

      // Record baseline AI images
      const baselineAiImages = new Set(await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img'))
          .map(i => i.src)
          .filter(src => src.includes('/gg/') || src.includes('lh3.googleusercontent.com/gg/'));
      }));

      // Type prompt
      console.log(`📝 Typing prompt for ${char.name}...`);
      await page.keyboard.type(char.prompt);
      await sleep(1000);

      // Submit via arrow button
      const arrowBtnSelector = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const arrowBtn = btns.find(b => 
          b.querySelector('svg') || 
          b.textContent?.includes('arrow_forward') || 
          b.getAttribute('aria-label')?.toLowerCase().includes('create')
        );
        if (arrowBtn) {
          if (!arrowBtn.id) arrowBtn.id = 'flow_submit_arrow_' + Date.now();
          return '#' + arrowBtn.id;
        }
        return null;
      });

      if (arrowBtnSelector) {
        console.log(`🚀 Submitting prompt...`);
        await page.click(arrowBtnSelector);
      } else {
        console.log('↵ Submitting via Enter...');
        await page.keyboard.press('Enter');
      }

      console.log('⏳ Waiting 42s for AI image render...');
      await sleep(42000);

      page = await browser.getPage();

      // Extract new AI image
      const newImages = await page.evaluate((baseArr) => {
        const baseSet = new Set(baseArr);
        return Array.from(document.querySelectorAll('img'))
          .map(img => img.src)
          .filter(src => 
            src &&
            !baseSet.has(src) &&
            src.includes('/gg/') &&
            !src.includes('/a/ACg') &&
            !src.includes('=s96-c')
          );
      }, Array.from(baselineAiImages));

      const newUrl = newImages.pop();

      if (newUrl) {
        const outPath = path.join(OUTPUT_DIR, `${char.id}.png`);
        console.log(`📥 Downloading portrait from ${newUrl}...`);
        const buf = await browser.downloadAsset(newUrl, outPath, page);
        fs.writeFileSync(outPath, buf);
        console.log(`✅ SAVED: ${outPath}`);
      } else {
        console.log(`ℹ️ Render complete in Flow canvas.`);
      }
    } catch (err: any) {
      console.error(`❌ Error generating ${char.name}:`, err.message);
    }
  }

  console.log(`\n=======================================================`);
  console.log(`🎉 ALL 8 CHARACTER PORTRAITS PROCESSED!`);
  console.log(`📁 Output Folder: ${OUTPUT_DIR}`);
  console.log(`=======================================================`);
  process.exit(0);
}

generateSequentially().catch(err => {
  console.error('Fatal batch error:', err);
  process.exit(1);
});
