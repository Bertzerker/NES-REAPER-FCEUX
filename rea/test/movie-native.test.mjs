import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import path from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {startInspector} from '../server.mjs';
import {fm2Header,fm2InputDigest,sha256} from '../evidence.mjs';
const enabled=process.env.REA_NATIVE_TEST==='1',root=path.resolve('rea'),count=()=>Number(execFileSync('powershell.exe',['-NoProfile','-Command','@(Get-Process -Name fceux,fceux64 -ErrorAction SilentlyContinue).Count'],{encoding:'utf8',windowsHide:true}).trim());
test('real movie playback, speed, frame comments, immutable evidence and annotated FM2 replay',{skip:!enabled,timeout:60000},async()=>{
 assert.equal(count(),0,'Only one FCEUX instance is allowed');const dataDir=path.join(root,'test-output','movie-'+Date.now());await mkdir(dataDir,{recursive:true});
 const server=await startInspector({port:18965,dataDir});const child=spawn(path.join(root,'bin/fceux64.exe'),['-bginput','1','-pause','1',path.join(root,'test-output/inspection-test.nes')],{cwd:path.join(root,'bin'),env:{...process.env,FCEUX_REA_PORT:String(server.nativePort),FCEUX_REA_TOKEN:server.token},windowsHide:true,stdio:'ignore'});
 const get=async route=>{const r=await fetch(server.url+route);assert.equal(r.status,200,await r.clone().text());return r.json();};
 const post=async(route,body)=>{const binary=Buffer.isBuffer(body);return fetch(server.url+route,{method:'POST',headers:{'Content-Type':binary?'application/octet-stream':'application/json','X-REA-Token':server.token},body:binary?body:JSON.stringify(body)});};
 const control=async body=>{const r=await post('/api/control',body);assert.equal(r.status,200,await r.clone().text());return r.json();};const capture=async result=>get('/api/snapshot?snapshot='+result.snapshot);
 try{
  let ready=false;for(let n=0;n<150;n++){if((await get('/api/session')).connected){ready=true;break;}await delay(100);}assert.ok(ready);const initial=await capture(await control({op:'pause'}));
  const head=`version 3\nemuVersion 27000\nromFilename inspection-test\nromChecksum base64:${Buffer.from(initial.romMd5,'hex').toString('base64')}\nguid 00112233-4455-6677-8899-aabbccddeeff\nrerecordCount 2\npalFlag 0\nfourscore 0\nmicrophone 0\nport0 1\nport1 1\nport2 0\nFDS 0\nNewPPU 0\nRAMInitOption 0\nRAMInitSeed 0\n`;
  const fm2=Buffer.from(head+Array.from({length:400},(_,i)=>`|0|${i>=90&&i<120?'R.......':'........'}|........||\n`).join(''));await writeFile(path.join(root,'test-output','inspection-movie.fm2'),fm2);
  let r=await post('/api/movie?name=inspection-movie.fm2',fm2);assert.equal(r.status,200,await r.clone().text());let s=await capture(await r.json());assert.equal(s.playback.movie.mode,'playback');assert.equal(s.playback.movie.readOnly,true);assert.equal(s.frame,0);
  s=await capture(await control({op:'speed',percent:50}));assert.equal(s.playback.speedPercent,50);
  const before=await get('/api/status');assert.equal((await get('/api/playback')).speedPercent,50);assert.equal((await get('/api/status')).captures,before.captures,'Lightweight playback status must not create a graphics capture');
  await control({op:'movie-step',frames:90});s=await capture(await control({op:'movie-step',frames:5}));assert.equal(s.frame,95);assert.equal(Buffer.from(s.buffers.ram,'hex')[16],128,'Movie Right input must be consumed without injected browser input');
  r=await post('/api/annotations/capture',{});assert.equal(r.status,201,await r.clone().text());const anchor=await r.json();assert.equal(anchor.frame,95);assert.equal(anchor.movie.inputFrame,94);assert.equal(anchor.movieFile.status,'verified',JSON.stringify(anchor.movieFile));assert.equal(anchor.movie.inputMd5,fm2InputDigest(fm2).md5);
  r=await post('/api/annotations',{snapshot:anchor.snapshot,evidenceSha256:anchor.evidenceSha256,format:'markdown',kind:'observation',text:'## Collision hypothesis\n\n```json\n{"x":128}\n```\n\n```mermaid\nflowchart LR\nA-->B\n```'});assert.equal(r.status,201);const note=await r.json();
  const png=await fetch(server.url+anchor.imageUrl);assert.equal(png.status,200);assert.equal(sha256(Buffer.from(await png.arrayBuffer())),anchor.imageSha256);
  await control({op:'movie-step',frames:8});assert.equal((await get('/api/annotations/'+note.id+'/snapshot')).frame,95);
  const exported=await fetch(server.url+'/api/annotations/'+note.id+'/fm2');assert.equal(exported.status,200,await exported.clone().text());const annotated=Buffer.from(await exported.arrayBuffer());assert.deepEqual(annotated.subarray(fm2Header(annotated).boundary),fm2.subarray(fm2Header(fm2).boundary));assert.match(annotated.toString(),/comment REA .*"frame":95/);
  const sourcePath=(await get('/api/annotations/'+note.id+'/snapshot')).playback.movie.path;assert.deepEqual(await readFile(sourcePath),fm2);
  r=await post('/api/movie?name=annotated.fm2',annotated);assert.equal(r.status,200);s=await capture(await control({op:'movie-step',frames:95}));const original=await get('/api/annotations/'+note.id+'/snapshot');assert.equal(s.buffers.ram,original.buffers.ram);assert.equal(s.buffers.screen,original.buffers.screen);assert.equal(s.cycle,original.cycle);
  await control({op:'speed',percent:100});await control({op:'movie-play'});await delay(400);s=await capture(await control({op:'pause'}));assert.ok(s.frame>95&&s.frame<150);assert.equal(s.paused,true);assert.equal(s.playback.movie.rerecordCount,2);
  r=await post('/api/control',{op:'step',frames:1,pad0:1});assert.equal(r.status,409,'Movie playback must keep scripted gamepad injection disabled');
  await writeFile(path.join(root,'test-output','movie-validation.json'),JSON.stringify({passed:true,frame:anchor.frame,inputFrame:anchor.movie.inputFrame,inputMd5:anchor.movie.inputMd5,renderSha256:anchor.imageSha256,comment:note.id,annotatedInputEqual:true,ramReplayEqual:true,screenReplayEqual:true,cycleReplayEqual:true},null,2));assert.equal(count(),1);
  const unauthorized=await fetch(server.url+'/api/annotations/capture',{method:'POST',body:'{}'});assert.equal(unauthorized.status,403);
  r=await post('/api/control',{op:'speed',percent:75});assert.equal(r.status,200);r=await post('/api/control',{op:'speed',percent:80});assert.equal(r.status,400);
  await control({op:'movie-restart'});await control({op:'movie-step',frames:399});await control({op:'movie-play'});await delay(250);const ended=await get('/api/playback');assert.equal(ended.paused,true);assert.equal(ended.frame,400,'Movie must stop before any unrecorded frame');await control({op:'movie-stop'});assert.equal((await get('/api/playback')).movie.mode,'inactive');
 }finally{const exited=new Promise(r=>{if(child.exitCode!==null||child.signalCode!==null)r();else child.once('exit',r);});child.kill();await exited;await server.close();}
});
