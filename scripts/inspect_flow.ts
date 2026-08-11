import 'dotenv/config';
import { browser } from '../src/browser.js';
import { captureSnapshot } from '../src/snapshot.js';

async function inspect() {
  console.log('Navigating to Google Flow...');
  const { page, url } = await browser.navigate('https://labs.google/fx/tools/flow');
  console.log('Current URL:', url);
  
  // Wait a bit for JS hydration
  await new Promise((r) => setTimeout(r, 5000));

  const pageUrl = page.url();
  console.log('Page URL after wait:', pageUrl);

  const snapshot = await captureSnapshot(page, []);
  console.log('Snapshot Summary:', snapshot.summary);
  console.log('Page Title:', snapshot.title);
  
  console.log('\n--- Interactable Elements ---');
  for (const item of snapshot.interactables) {
    if (item.visible) {
      console.log(`[${item.ref}] <${item.tag}> text="${item.text}" aria="${item.ariaLabel}" ph="${item.placeholder}" sel="${item.selector}"`);
    }
  }

  process.exit(0);
}

inspect().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
