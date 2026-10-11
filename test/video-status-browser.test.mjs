import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import puppeteer from 'puppeteer-core';
import {browser} from '../dist/browser.js';
import {handleTool} from '../dist/tools.js';

const chromePath = process.env.TEST_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('native Flow status RPC is actively queried without repeating the generation POST',
  {skip: !fs.existsSync(chromePath)}, async () => {
    let state=2, generations=0, reads=0, failRead=false;
    const id='2d3a47f2-76db-40c3-b1d1-69526767cc29';
    const server=http.createServer((request,response)=>{
      const rpc=new URL(request.url,'http://local.test').searchParams.get('rpcids');
      if (!rpc) {
        if(request.url==='/asb/native-video=d') {
          response.setHeader('Content-Type','video/mp4');response.end(Buffer.from('observed native video fixture'));
        } else {
          response.setHeader('Content-Type','text/html');
          response.end(`<canvas></canvas><img width="40" height="40" alt="Generated video thumbnail" src="/asb/native-video" onclick="fetch('/asb/native-video=d')">`);
        }return;
      }
      if(rpc==='YhhmEf') generations++; else reads++;
      if(rpc!=='YhhmEf' && failRead) {response.statusCode=503;response.end('unavailable');return;}
      const media=[id,null,null,null,null,[null,null,null,null,null,null,null,null,[state]],null,
        [[null,null,null,null,null,null,null,null,'https://lh3.googleusercontent.com/asb/native-video']]];
      const payload=rpc==='YhhmEf'?[null,null,[],[media]]:[null,null,[media]];
      response.end(`)]}'\n\n100\n${JSON.stringify([['wrb.fr',rpc,JSON.stringify(payload)]])}\n`);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const chrome=await puppeteer.launch({executablePath:chromePath,headless:true});
    const originalGetPage=browser.getPage;
    try {
      const page=await chrome.newPage();await page.goto(base+'/project/current');
      browser.page=page;browser.getPage=async()=>page;browser.attachNetworkListener(page);
      await browser.markGenerationStart();
      const post=async rpc=>{
        await page.evaluate(async ({base,rpc})=>{
          const body=new URLSearchParams({'f.req':JSON.stringify([[[rpc,'[]',null,'generic']]])});
          await(await fetch(`${base}/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=${rpc}`,{method:'POST',body})).text();
        },{base,rpc});
      };
      await post('YhhmEf');await post('jwpduf');
      const check=async expected=>{
        for(let i=0;i<10;i++) {
          const result=JSON.parse((await handleTool('flow_generation_status',{generationId:browser.videoStatus.generationId})).content[0].text);
          if(result.state===expected) return result;
        }throw new Error(`Missing ${expected}`);
      };
      const pending=await check('queued');assert.equal(pending.jobId,id);
      assert.equal(pending.operations[0].providerState,'pending');
      failRead=true;const unavailable=await check('unknown');
      assert.equal(unavailable.lastKnownState,'queued');assert.equal(unavailable.remoteQuery.httpStatus,503);
      failRead=false;
      state=3;
      const done=await check('succeeded');
      assert.equal(done.remoteQuery.source,'observed_read_only_status_rpc');
      assert.equal(done.remoteQuery.httpStatus,200);assert.equal(generations,1);assert.ok(reads>=2);
      assert.equal(done.source,'provider_operation_and_observed_media');
      assert.equal(done.assetUrl,base+'/asb/native-video=d');
      assert.equal(await page.$('video'),null); // actual canvas case, no global video-player guess
    } finally {browser.getPage=originalGetPage;browser.page=null;browser.videoStatus.reset();
      await chrome.close();await new Promise(resolve=>server.close(resolve));}
  });
test('real local browser actively reads bound status; ignores late old responses and historical players',
  {skip: !fs.existsSync(chromePath)}, async () => {
    let providerState = 'PENDING';
    const server = http.createServer((request,response) => {
      if (request.url.includes('batchGenerateOld')) {
        setTimeout(() => {response.setHeader('Content-Type','application/json');response.end(JSON.stringify({name:'operations/old',status:'FAILED'}));},150);
      } else if (request.url.includes('batchGenerate') || request.url.includes('flowWorkflows')) {
        response.setHeader('Content-Type','application/json');
        response.end(JSON.stringify({operations:[{name:'operations/current',status:providerState,
          ...(providerState === 'RUNNING' ? {progressPercent:37} : {})}]}));
      } else {response.setHeader('Content-Type','text/html');response.end('<p>local status fixture</p>');}
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const chrome = await puppeteer.launch({executablePath:chromePath,headless:true});
    const originalGetPage = browser.getPage;
    try {
      const page = await chrome.newPage(); await page.goto(base+'/project/current');
      browser.page = page; browser.getPage = async () => page;
      browser.attachNetworkListener(page);
      const oldRequest = page.waitForRequest(request => request.url().includes('batchGenerateOld'));
      const oldResponse = page.waitForResponse(response => response.url().includes('batchGenerateOld'));
      await page.evaluate(base => {void fetch(base+'/batchGenerateOld',{method:'POST'});},base);
      await oldRequest;
      await browser.markGenerationStart();
      const generationId = browser.videoStatus.generationId;
      const post = async (path,method) => {
        await page.evaluate(async ({base,path,method}) => {await (await fetch(base+path,{method})).json();},{base,path,method});
      };
      const check = async state => {
        const deadline=Date.now()+1500;
        let result;
        do {result=JSON.parse((await handleTool('flow_generation_status',{generationId})).content[0].text);
          if (result.state === state) return result;
        } while (Date.now()<deadline);
        assert.equal(result.state,state);
      };
      await post('/batchGenerate','POST');
      await (await oldResponse).text();
      assert.equal((await check('queued')).operations[0].id,'operations/current');
      assert.equal(browser.videoStatus.read().operations.length,1);
      providerState='RUNNING'; await post('/flowWorkflows','GET');
      assert.equal((await check('running')).operations[0].progress,37);
      // Stop frontend polling: the MCP query must actively re-read the exact
      // already-observed status GET rather than waiting for another response.
      providerState='COMPLETED';
      const completed=await check('succeeded');
      assert.equal(completed.remoteQuery.source,'observed_status_endpoint_get');
      assert.equal(completed.remoteQuery.httpStatus,200);
      assert.equal(completed.assetUrl,undefined); // status alone is not a downloaded video
      await page.evaluate(() => {
        const video=document.createElement('video'); video.src='/historical.mp4';document.body.append(video);
      });
      await browser.markGenerationStart();
      assert.equal(JSON.parse((await handleTool('flow_generation_status',{generationId})).content[0].text).state,'unknown');
      assert.equal(browser.videoStatus.read().state,'unknown');
      const current = JSON.parse((await handleTool('flow_generation_status',{generationId:browser.videoStatus.generationId})).content[0].text);
      assert.equal(current.state,'unknown'); assert.equal(current.assetUrl,undefined);
    } finally {
      browser.getPage=originalGetPage; browser.page=null;
      await chrome.close(); await new Promise(resolve => server.close(resolve));
    }
  });
