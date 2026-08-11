import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';

async function testProjectEditor() {
  console.log('Navigating to Google Flow...');
  await browser.navigate('https://labs.google/fx/tools/flow');
  const page = await browser.getPage();
  await sleep(3000);

  const snap1 = await captureSnapshot(page, []);
  const newProjBtn = snap1.interactables.find(
    i => i.text?.toLowerCase().includes('new project') || i.ariaLabel?.toLowerCase().includes('new project')
  );

  if (newProjBtn) {
    console.log(`Clicking New Project button [${newProjBtn.ref}]...`);
    await page.click(newProjBtn.selector);
    await sleep(5000);
  }

  const snap2 = await captureSnapshot(page, []);
  console.log('Project Page URL:', snap2.url);
  console.log('Page Title:', snap2.title);

  console.log('\n--- Project Workspace Elements ---');
  for (const item of snap2.interactables) {
    if (item.visible) {
      console.log(`[${item.ref}] <${item.tag}> text="${item.text}" role="${item.role}" ph="${item.placeholder}" aria="${item.ariaLabel}" sel="${item.selector}"`);
    }
  }

  console.log('\n--- Initial Media Elements ---');
  for (const m of snap2.media) {
    console.log(`[${m.ref}] ${m.kind}: ${m.src}`);
  }

  process.exit(0);
}

testProjectEditor().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
