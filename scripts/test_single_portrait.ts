import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = '/Volumes/Xstorage/Projects/Immerse-Feb26/dossiers/assistant-to-the-villain/portraits';

async function testSingle() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Navigating to Google Flow main page...');
  await browser.navigate('https://labs.google/fx/tools/flow');
  const page = await browser.getPage();
  await sleep(3000);

  // Click "New project"
  let snap = await captureSnapshot(page, []);
  const newProjBtn = snap.interactables.find(
    i => i.text?.toLowerCase().includes('new project') || i.ariaLabel?.toLowerCase().includes('new project')
  );

  if (newProjBtn) {
    console.log(`Clicking New Project...`);
    await page.click(newProjBtn.selector);
    await sleep(4000);
  }

  console.log('Project URL:', page.url());

  // Focus prompt box
  snap = await captureSnapshot(page, []);
  const textbox = snap.interactables.find(i => i.role === 'textbox' || i.tag === 'TEXTAREA' || i.text?.includes('What do you want to create'));
  
  if (textbox) {
    console.log(`Targeting textbox [${textbox.ref}]...`);
    await page.click(textbox.selector);
    await sleep(500);

    const promptText = 'High fantasy portrait of Evie Sage, 23-year-old female assistant with soft curves, fair skin, rosy red lips, warm expressive eyes, blonde hair with delicate golden butterfly pins, crisp white cloak, glowing magical scar on shoulder, cinematic lighting, fantasy manor office background.';
    
    await page.keyboard.type(promptText);
    await sleep(1000);

    // Find the right-arrow submit button inside the prompt box
    // Look for the last button inside or nearby the prompt container
    const arrowBtnSelector = await page.evaluate(() => {
      // Find white circular button with arrow or last button in the floating bar
      const btns = Array.from(document.querySelectorAll('button'));
      const arrowBtn = btns.find(b => b.querySelector('svg') || b.textContent?.includes('arrow_forward') || b.getAttribute('aria-label')?.toLowerCase().includes('create'));
      if (arrowBtn) {
        if (!arrowBtn.id) arrowBtn.id = 'target_arrow_submit_btn';
        return '#' + arrowBtn.id;
      }
      return null;
    });

    if (arrowBtnSelector) {
      console.log(`Found submit arrow button [${arrowBtnSelector}]. Clicking...`);
      await page.click(arrowBtnSelector);
    } else {
      console.log('Pressing Enter key to submit prompt...');
      await page.keyboard.press('Enter');
    }

    console.log('⏳ Waiting 45s for Google Flow AI generation...');
    await sleep(45000);

    await page.screenshot({ path: '/tmp/evie_generated_screen.png' });
    console.log('Saved screenshot: /tmp/evie_generated_screen.png');

    // Extract generated image URLs
    const generatedImages = await page.evaluate(() => {
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

    console.log('Found generated images:', generatedImages);

    if (generatedImages.length > 0) {
      const imgUrl = generatedImages[generatedImages.length - 1];
      const outPath = path.join(OUTPUT_DIR, '01_evie_sage.png');
      console.log(`Downloading portrait from ${imgUrl}...`);
      const buf = await browser.downloadAsset(imgUrl, outPath, page);
      fs.writeFileSync(outPath, buf);
      console.log(`🎉 SUCCESS! Saved Evie Sage portrait to: ${outPath}`);
    }
  }

  process.exit(0);
}

testSingle().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
