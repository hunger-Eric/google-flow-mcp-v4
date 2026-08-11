import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';
import fs from 'node:fs';

async function debugFlow() {
  console.log('Navigating to Google Flow main page...');
  await browser.navigate('https://labs.google/fx/tools/flow');
  const page = await browser.getPage();
  await sleep(3000);

  // Take screenshot 1
  await page.screenshot({ path: '/tmp/flow_step1.png' });
  console.log('Saved screenshot 1: /tmp/flow_step1.png');

  // Click "New Project"
  let snap = await captureSnapshot(page, []);
  const newProjBtn = snap.interactables.find(
    i => i.text?.toLowerCase().includes('new project') || i.ariaLabel?.toLowerCase().includes('new project')
  );

  if (newProjBtn) {
    console.log(`Clicking New Project button [${newProjBtn.ref}]...`);
    await page.click(newProjBtn.selector);
    await sleep(4000);
  }

  console.log('Current URL:', page.url());
  await page.screenshot({ path: '/tmp/flow_step2_project.png' });
  console.log('Saved screenshot 2: /tmp/flow_step2_project.png');

  // Check buttons on project page
  snap = await captureSnapshot(page, []);
  console.log('\n--- All Buttons & Inputs in Project Page ---');
  for (const item of snap.interactables) {
    if (item.visible) {
      console.log(`[${item.ref}] <${item.tag}> text="${item.text}" role="${item.role}" ph="${item.placeholder}" aria="${item.ariaLabel}" sel="${item.selector}"`);
    }
  }

  // Find "Image" tool button or prompt box
  const imgToolBtn = snap.interactables.find(i => i.text?.trim() === 'Image');
  if (imgToolBtn) {
    console.log(`\nClicking Image tool button [${imgToolBtn.ref}]...`);
    await page.click(imgToolBtn.selector);
    await sleep(2000);
    await page.screenshot({ path: '/tmp/flow_step3_image_tool.png' });
    console.log('Saved screenshot 3: /tmp/flow_step3_image_tool.png');
  }

  // Type test prompt into textbox
  snap = await captureSnapshot(page, []);
  const textbox = snap.interactables.find(i => i.role === 'textbox' || i.tag === 'TEXTAREA' || i.placeholder?.includes('Describe'));
  
  if (textbox) {
    console.log(`\nTargeting textbox [${textbox.ref}]...`);
    await page.click(textbox.selector);
    await sleep(500);
    await page.keyboard.type('Cinematic portrait of a fantasy elf princess with golden butterfly pins, ultra detailed digital painting');
    await sleep(1000);
    await page.screenshot({ path: '/tmp/flow_step4_typed.png' });

    // Look for Submit / Generate / Create arrow button
    const freshSnap = await captureSnapshot(page, []);
    console.log('\n--- Fresh Buttons After Typing ---');
    for (const b of freshSnap.interactables.filter(i => i.tag === 'BUTTON' || i.role === 'button')) {
      console.log(`[${b.ref}] text="${b.text}" aria="${b.ariaLabel}" sel="${b.selector}"`);
    }

    const generateBtn = freshSnap.interactables.find(
      i => i.text?.toLowerCase().includes('create') || 
           i.text?.toLowerCase().includes('generate') ||
           i.text?.includes('arrow_forward')
    );

    if (generateBtn) {
      console.log(`\nClicking Generate/Create button [${generateBtn.ref}] (${generateBtn.text})...`);
      await page.click(generateBtn.selector);
    } else {
      console.log('\nPressing Enter...');
      await page.keyboard.press('Enter');
    }

    console.log('Waiting 15s for generation response...');
    await sleep(15000);
    await page.screenshot({ path: '/tmp/flow_step5_after_generate.png' });
    console.log('Saved screenshot 5: /tmp/flow_step5_after_generate.png');
  }

  process.exit(0);
}

debugFlow().catch(err => {
  console.error('Debug error:', err);
  process.exit(1);
});
