import 'dotenv/config';
import { browser, sleep } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';

async function listProjects() {
  console.log('Navigating to Google Flow main dashboard...');
  await browser.navigate('https://labs.google/fx/tools/flow');
  const page = await browser.getPage();
  await sleep(4000);

  await page.screenshot({ path: '/tmp/flow_dashboard.png' });
  console.log('Saved screenshot: /tmp/flow_dashboard.png');

  const snap = await captureSnapshot(page, []);
  console.log(`\nFound ${snap.interactables.length} interactable items on main dashboard:`);
  for (const item of snap.interactables) {
    if (item.visible && (item.text || item.ariaLabel)) {
      console.log(`[${item.ref}] <${item.tag}> text="${item.text}" aria="${item.ariaLabel}" sel="${item.selector}"`);
    }
  }

  process.exit(0);
}

listProjects().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
