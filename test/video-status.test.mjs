import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoGenerationStatus, parseVideoOperations, decodeFlowRpc, nativeVideoOperations, isReadOnlyFlowRequest, flowRpcUrls} from '../dist/video-status.js';

const media = (code, id='2d3a47f2-76db-40c3-b1d1-69526767cc29') => [id,'d64ff2f6-9783-4fd4-a16c-3d0380cf471f',null,null,null,
  [null,null,null,null,null,null,null,null,[code]],null,[[],[],[id]]];
test('native escaped signed media query is decoded completely instead of truncated at Expires', () => {
  const url='https://flow-content.google/video/2d3a47f2-76db-40c3-b1d1-69526767cc29?Expires=123&Signature=abc';
  const payload=JSON.stringify([url]).replaceAll('=','\\u003d').replaceAll('&','\\u0026');
  const text=`)]}'\n\n100\n${JSON.stringify([['wrb.fr','Zzl0ze',payload]])}\n`;
  assert.deepEqual(flowRpcUrls(text),[url]);
  assert.deepEqual(flowRpcUrls(JSON.stringify({assetUrl:url})),[url]);
});
test('native Flow anti-XSSI frames bind media status, ignoring unrelated RPCs and records', () => {
  const envelope=(rpc,payload)=>`)]}'\n\n100\n${JSON.stringify([['wrb.fr',rpc,JSON.stringify(payload),null]])}\n`;
  const tracker=new VideoGenerationStatus(); tracker.start('https://flow.google.com/project/a');
  const frame=decodeFlowRpc(envelope('YhhmEf',[null,null,[],[media(2)]]))[0];
  tracker.observeOperations(nativeVideoOperations(frame.rpcId,frame.payload),true,tracker.generationId);
  assert.equal(tracker.read().state,'queued');
  assert.equal(tracker.read().operations[0].providerState,'pending');
  assert.equal(tracker.read().operations[0].progress,undefined);
  tracker.observeOperations(nativeVideoOperations('jwpduf',[null,null,[media(3),media(4,'11111111-1111-1111-1111-111111111111')]]),false,tracker.generationId);
  assert.equal(tracker.read().state,'succeeded'); assert.equal(tracker.read().operations.length,1);
  assert.deepEqual(nativeVideoOperations('unknown',[null,null,[media(3)]]),[]);
  assert.equal(nativeVideoOperations('jwpduf',[null,null,[media(99)]])[0].state,'unknown');
  assert.equal(nativeVideoOperations('jwpduf',[null,null,[media(4)]])[0].state,'failed');
});
test('status POST allowlist rejects generation, mixed, malformed and missing RPC requests', () => {
  const body=rpc=>new URLSearchParams({'f.req':JSON.stringify([[...rpc.map(id=>[id,'[]',null,'generic'])]])}).toString();
  assert.equal(isReadOnlyFlowRequest(body(['jwpduf'])),true);
  assert.equal(isReadOnlyFlowRequest(body(['Zzl0ze'])),true);
  assert.equal(isReadOnlyFlowRequest(body(['jwpduf','YhhmEf'])),false);
  assert.equal(isReadOnlyFlowRequest(body(['YhhmEf'])),false);
  assert.equal(isReadOnlyFlowRequest('f.req=garbage'),false);
  assert.equal(isReadOnlyFlowRequest(''),false);
});
test('restore queries the named provider identity rather than inventing not_started', () => {
  const tracker=new VideoGenerationStatus();
  tracker.restore('original-generation','https://flow.google.com/project/a',media(3)[0]);
  assert.equal(tracker.read().state,'unknown');
  tracker.observeOperations(nativeVideoOperations('Zzl0ze',[null,null,[media(3)]]),false,tracker.generationId);
  assert.equal(tracker.read().state,'succeeded');
});
test('native completed media exposes its actual provider URI, never a guessed URL or pending URI', () => {
  const row=media(3); row[7]=[[null,null,null,null,null,null,null,null,'https://example.test/video.mp4']];
  assert.equal(nativeVideoOperations('Zzl0ze',[null,null,[row]])[0].assetUri,'https://example.test/video.mp4');
  row[5][8][0]=2; assert.equal(nativeVideoOperations('jwpduf',[null,null,[row]])[0].assetUri,undefined);
  row[5][8][0]=3;row[7][0][8]='javascript:unsafe';assert.equal(nativeVideoOperations('jwpduf',[null,null,[row]])[0].assetUri,undefined);
});

test('bound operation progresses through actual provider states without inventing progress', () => {
  const tracker = new VideoGenerationStatus(); tracker.start('https://flow.google.com/project/a');
  const generationId = tracker.generationId;
  tracker.observe({operations:[{name:'operations/one', status:'PENDING'}]},true,generationId);
  assert.equal(tracker.read().state,'queued');
  tracker.observe({operations:[{name:'operations/other',status:'FAILED'},{name:'operations/one',status:'RUNNING',progressPercent:42}]},false,generationId);
  assert.equal(tracker.read().state,'running');
  assert.equal(tracker.read().operations[0].progress,42);
  tracker.observe({name:'operations/one',done:true,response:{video:{}}},false,generationId);
  assert.equal(tracker.read().state,'succeeded');
  tracker.observe({name:'operations/one',status:'RUNNING'},false,generationId);
  assert.equal(tracker.read().state,'succeeded');
});

test('unknown shapes, unrelated jobs, old generations and disabled buttons prove no status', () => {
  const tracker = new VideoGenerationStatus(); tracker.start('https://flow.google.com/project/a');
  tracker.observe({name:'operations/old',status:'FAILED'},false,tracker.generationId);
  tracker.observe({name:'operations/old',status:'FAILED'},true,'old-generation');
  assert.equal(tracker.read().state,'unknown');
  assert.deepEqual(parseVideoOperations({disabled:true,progress:80,videoUrl:'https://example.test/old.mp4'}),[]);
  tracker.observe({name:'operations/current',status:'NEW_UNRECOGNIZED_STATE'},true,tracker.generationId);
  assert.equal(tracker.read().state,'unknown');
  assert.equal(tracker.read().operations[0].progress,undefined);
});

test('explicit provider error is terminal and reset cannot inherit an old result', () => {
  const tracker = new VideoGenerationStatus(); tracker.start('https://flow.google.com/project/a');
  tracker.observe({operationId:'one',done:true,error:{code:7,message:'private payload'}},true,tracker.generationId);
  assert.equal(tracker.read().state,'failed');
  assert.equal(tracker.read().operations[0].errorCode,'7');
  assert.ok(!JSON.stringify(tracker.read()).includes('private payload'));
  tracker.start('https://flow.google.com/project/b');
  assert.equal(tracker.read().state,'unknown');
});

test('not started requires no local submission, and is not an alias for unknown', () => {
  const tracker = new VideoGenerationStatus();
  assert.equal(tracker.read().state,'not_started');
  tracker.start('https://flow.google.com/project/a');
  assert.equal(tracker.read().state,'unknown');
});
