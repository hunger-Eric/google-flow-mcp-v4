import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';

async function testConceptArt() {
  console.log('Navigating to Google Flow main page...');
  await browser.navigate('https://labs.google/fx/tools/flow');
  const page = await browser.getPage();
  await sleep(3000);

  // Click New Project
  let snap = await captureSnapshot(page, []);
  const newProjBtn = snap.interactables.find(
    i => i.text?.toLowerCase().includes('new project') || i.ariaLabel?.toLowerCase().includes('new project')
  );

  if (newProjBtn) {
    console.log('Clicking New Project...');
    await page.click(newProjBtn.selector);
    await sleep(4000);
  }

  snap = await captureSnapshot(page, []);

  // Click "Generate concept art" button on right panel
  const conceptArtBtn = snap.interactables.find(i => i.text?.includes('Generate concept art'));
  if (conceptArtBtn) {
    console.log(`Clicking "Generate concept art" button [${conceptArtBtn.ref}]...`);
    await page.click(conceptArtBtn.selector);
    await sleep(2000);
  }

  // Type Evie Sage prompt into the prompt box at bottom right
  snap = await captureSnapshot(page, []);
  const textbox = snap.interactables.find(i => i.role === 'textbox' || i.text?.includes('What do you want to create'));
  
  if (textbox) {
    console.log(`Targeting prompt box [${textbox.ref}]...`);
    await page.click(textbox.selector);
    await sleep(300);

    const promptText = 'High fantasy portrait of Evie Sage, 23-year-old female assistant with soft curves, fair skin, rosy red lips, warm expressive eyes, blonde hair with delicate golden butterfly pins, crisp white cloak, glowing magical scar on shoulder, cinematic lighting, fantasy manor office background.';
    
    await page.keyboard.type(promptText);
    await sleep(1000);

    // Find submit arrow
    const freshSnap = await captureSnapshot(page, []);
    const arrowBtn = freshSnap.interactables.find(i => i.text?.includes('arrow_forward') || i.ariaLabel?.toLowerCase().includes('create'));

    if (arrowBtn) {
      console.log(`Clicking arrow submit button [${arrowBtn.ref}]...`);
      await page.click(arrowBtn.selector);
    } else {
      console.log('Pressing Enter...');
      await page.keyboard.press('Enter');
    }

    console.log('Waiting 35s for concept art generation...');
    await sleep(35000);

    await page.screenshot({ path: '/tmp/concept_art_result.png' });
    console.log('Saved screenshot: /tmp/concept_art_result.png');
  }

  process.exit(0);
}

testConceptArt().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
