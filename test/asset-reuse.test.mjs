import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {projectScope,rememberAsset,storedAsset} from '../dist/asset-cache.js';
import {uploadLocalAsset} from '../dist/upload.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'flow-reuse-test-'));
process.env.FLOW_ASSET_CACHE_PATH=path.join(directory,'registry.json');
process.on('exit',()=>fs.rmSync(directory,{recursive:true,force:true}));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const handle=element=>({asElement:()=>element,async dispose(){}});
function reusePage(project,choices=1){
  let picker=false,attached=false,selected=false;
  return {url:()=>`https://flow.google.com/project/${project}`,
    async $(){throw new Error('Must not access a file input during reuse');},
    async waitForFileChooser(){throw new Error('Must not upload during reuse');},
    async evaluate(){return {picker,materials:attached?['https://flow-content.google/image/test-id']:[],choices:picker?choices:0};},
    async evaluateHandle(_fn,value){
      if(value==='add')return handle({async click(){picker=true;},async dispose(){}});
      if(value==='attach')return handle({async click(){assert.ok(selected);picker=false;attached=true;},async dispose(){}});
      if(Array.isArray(value))return handle({async evaluate(){return true;},async click(){selected=true;}});
      throw new Error('Unexpected upload control');
    }};
}
test('Flow domains share project scope, unrelated routes/domains never share assets',()=>{
  assert.equal(projectScope('https://labs.google/fx/tools/flow/project/p1/tool/video'),'p1');
  assert.equal(projectScope('https://flow.google.com/project/p1'),'p1');
  assert.equal(projectScope('https://flow.google.com/'),null);
  assert.equal(projectScope('https://evil.example/project/p1'),null);
});
test('verified bytes are reused after rename and registry module restart, with zero upload operations',async()=>{
  const file=path.join(directory,'old.png');fs.writeFileSync(file,'actor card');
  const digest=sha(file);rememberAsset('p1',{filename:'old.png',sha256:digest});
  const renamed=path.join(directory,'new.png');fs.copyFileSync(file,renamed);
  const fresh=await import('../dist/asset-cache.js?restart');
  assert.equal(fresh.storedAsset('p1',sha(renamed)).filename,'old.png');
  const receipt=await uploadLocalAsset(reusePage('p1'),renamed);
  assert.equal(receipt.reused,true);assert.equal(receipt.uploadedNow,false);assert.equal(receipt.verified,true);
});
test('different project, profile registry, or changed bytes cannot retrieve old assets',()=>{
  const file=path.join(directory,'old.png');const digest=sha(file);
  assert.equal(storedAsset('p2',digest),undefined);
  fs.writeFileSync(file,'different actor');assert.equal(storedAsset('p1',sha(file)),undefined);
  const previous=process.env.FLOW_ASSET_CACHE_PATH;process.env.FLOW_ASSET_CACHE_PATH=path.join(directory,'other-profile.json');
  assert.equal(storedAsset('p1',digest),undefined);process.env.FLOW_ASSET_CACHE_PATH=previous;
});
test('ambiguous existing material does not upload or silently pick another card',async()=>{
  const file=path.join(directory,'ambiguous.png');fs.writeFileSync(file,'known bytes');
  rememberAsset('p3',{filename:'ambiguous.png',sha256:sha(file)});
  await assert.rejects(()=>uploadLocalAsset(reusePage('p3',2),file),/ambiguous/);
});
test('first verified upload records a content-bound name and the next call reuses it',async()=>{
  const file=path.join(directory,'first.png');fs.writeFileSync(file,'brand new material');
  let uploaded=0,uploadedName;
  const page={url:()=> 'https://flow.google.com/project/new-project',
    async $(){return {async uploadFile(staged){uploaded++;uploadedName=path.basename(staged);assert.equal(sha(staged),sha(file));}};},
    async evaluateHandle(){return handle(null);},
    async evaluate(fn){return fn.toString().includes('flow-ingredient-chip') ? (uploaded ? ['https://flow-content.google/image/new-upload'] : []) : {filenameVisible:true,pending:false,inPicker:false,error:''};}};
  const first=await uploadLocalAsset(page,file);
  assert.equal(first.uploadedNow,true);assert.equal(first.reused,false);assert.equal(uploaded,1);
  assert.ok(uploadedName.includes(sha(file).slice(0,16)));
  assert.equal(storedAsset('new-project',sha(file)).filename,uploadedName);
  assert.equal(storedAsset('new-project',sha(file)).mediaId,'https://flow-content.google/image/new-upload');
  const second=await uploadLocalAsset(reusePage('new-project'),file);
  assert.equal(second.reused,true);assert.equal(uploaded,1);
});

test('real DOM: a library thumbnail is not an attached ingredient; reuse adds one native chip and is idempotent',async()=>{
  const executable=process.env.CHROME_EXECUTABLE_PATH || (process.platform==='win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
  if(!fs.existsSync(executable)) throw new Error('Chrome is required for the material DOM regression test');
  const chrome=await puppeteer.launch({executablePath:executable,headless:true,args:['--no-sandbox']});
  try {
    const page=await chrome.newPage();
    await page.setRequestInterception(true);page.on('request',request=>request.abort());
    const file=path.join(directory,'dom.png');fs.writeFileSync(file,'DOM actor');
    rememberAsset('dom',{filename:'dom.png',sha256:sha(file)});
    await page.setContent(`<button title="dom.png">dom.png</button>
      <div class="base-prompt-box"><flow-ingredient-bar></flow-ingredient-bar><button aria-label="在提示框中添加素材" onclick="window.actions.push('open');document.querySelector('#picker').style.display='block'">add</button></div>
      <div id="picker" style="display:none"><button role="option" aria-selected="false" onclick="window.actions.push('select');this.setAttribute('aria-selected','true')">dom.png图片</button>
      <button id="attach">添加到提示</button></div>
      <script>window.actions=[]</script>`);
    await page.evaluate(()=>document.querySelector('#attach').onclick=()=>{
      window.actions.push('attach');
      document.querySelector('flow-ingredient-bar').innerHTML='<flow-ingredient-chip><button aria-busy="false"><img width=32 height=32 alt="素材图片" src="https://flow-content.google/image/dom-id?Expires=test"></button></flow-ingredient-chip>';
      document.querySelector('#picker').style.display='none';
    });
    page.url=()=> 'https://flow.google.com/project/dom';
    const first=await uploadLocalAsset(page,file);
    assert.equal(first.mediaId,'https://flow-content.google/image/dom-id');
    assert.deepEqual(await page.evaluate(()=>window.actions),['open','select','attach']);
    const second=await uploadLocalAsset(page,file);
    assert.equal(second.reused,true);
    assert.deepEqual(await page.evaluate(()=>window.actions),['open','select','attach']);
    assert.equal(await page.evaluate(()=>document.querySelectorAll('flow-ingredient-chip').length),1);
  } finally {await chrome.close();}
});
