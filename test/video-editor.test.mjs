import assert from 'node:assert/strict';
import test from 'node:test';
import puppeteer from 'puppeteer-core';
import {videoEditorUrl,editInstruction,inspectVideoEditor,prepareVideoEdit} from '../dist/video-editor.js';
const project='9f28e1f8-54d3-41f6-b132-d63e8b5a9091',asset='64456a93-09f2-4e0c-8792-3f6b46e8d827';
test('editor identity is exact and invalid identifiers do not create navigation URLs',()=>{
 assert.equal(videoEditorUrl(project,asset),`https://flow.google.com/project/${project}/edit/${asset}`);
 assert.throws(()=>videoEditorUrl(project,'../other'),/UUID/);
 assert.throws(()=>editInstruction(''),/required/);
 assert.throws(()=>editInstruction('change',{startSeconds:3,endSeconds:2}),/Scope/);
 assert.match(editInstruction('改为白衣',{startSeconds:1.5,endSeconds:3}),/1.5–3 seconds/);
});
test('real composer: Chinese follow-up binds original editor, does not submit, and preserves unsent drafts',async()=>{
 const chrome=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 try {
  const page=await chrome.newPage();
  page.url=()=>videoEditorUrl(project,asset);
  await page.setContent('<input class="editable-text-input" value="Warehouse"><div class="ProseMirror" contenteditable="true"></div><button class="generate-icon-button" onclick="window.submissions++">生成</button><div class="timeline-contents"><div class="clip selected"><div class="trim-handle">trim</div></div></div><script>window.submissions=0</script>');
  const first=await prepareVideoEdit(page,page.url(),'把黑色衣服改为白色');
  assert.equal(first.assetId,asset);assert.equal(first.prompt,'把黑色衣服改为白色');assert.equal(first.submitted,false);
  assert.equal(first.capabilities.sceneTrimming,true);assert.equal(first.capabilities.enforcedTemporalEdit,false);
  await prepareVideoEdit(page,page.url(),'把黑色衣服改为白色');
  assert.equal(await page.evaluate(()=>window.submissions),0);
  await assert.rejects(()=>prepareVideoEdit(page,page.url(),'different draft'),/unsent draft/);
  await assert.rejects(()=>prepareVideoEdit(page,videoEditorUrl(project,project),'instruction'),/unavailable/);
  const state=await inspectVideoEditor(page);assert.equal(state.prompt,'把黑色衣服改为白色');
 }finally{await chrome.close();}
});
