import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import {startInspector} from '../server.mjs';
import {sizes} from '../public/inspection.mjs';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const enabled=process.env.REA_NATIVE_TEST==='1';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function frame(meta,buffers=[]){const json=Buffer.from(JSON.stringify(meta)),head=Buffer.alloc(8);head.writeUInt32LE(4+json.length+buffers.reduce((n,b)=>n+b.length,0));head.writeUInt32LE(json.length,4);return Buffer.concat([head,json,...buffers]);}
function snapshot(id){return frame({kind:'snapshot',version:1,id,frame:id,cycle:id,romMd5:'diagnostic',buffers:Object.entries(sizes)},Object.values(sizes).map(n=>Buffer.alloc(n)));}
test('native framing, authentication, bounded history, retained pins and long polling',{skip:!enabled,timeout:20000},async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'nes-rea-protocol-'));
 const inspector=await startInspector({port:18985,dataDir});
 const connect=()=>new Promise((resolve,reject)=>{const s=net.connect(inspector.nativePort,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
 const get=async route=>{const r=await fetch(inspector.url+route);assert.equal(r.status,200);return r.json();};
 let producer;
 try{
  const bad=await connect();const rejected=new Promise(r=>bad.on('close',r));bad.write(frame({kind:'hello',token:'wrong'}));await rejected;assert.equal((await get('/api/status')).connected,false);
  producer=await connect();const hello=frame({kind:'hello',token:inspector.token});producer.write(hello.subarray(0,2));await delay(5);producer.write(hello.subarray(2));
  const one=snapshot('s1');producer.write(one.subarray(0,7));await delay(5);producer.write(one.subarray(7));
  for(let i=0;i<50;i++){if((await get('/api/status')).latest==='s1')break;await delay(5);}
  await get('/api/snapshot?snapshot=s1'); // independently pinned
  producer.write(Buffer.concat(Array.from({length:24},(_,i)=>snapshot(`s${i+2}`))));
  for(let i=0;i<100;i++){if((await get('/api/status')).latest==='s25')break;await delay(5);}
  assert.equal((await get('/api/status')).history,16);assert.equal((await get('/api/snapshot?snapshot=s1')).id,'s1');
  assert.equal((await fetch(inspector.url+'/api/snapshot?snapshot=s2')).status,404);
  const live=fetch(inspector.url+'/api/live?after=s25');await delay(10);producer.write(snapshot('s26'));const response=await live;assert.equal(response.status,200);assert.ok((await response.arrayBuffer()).byteLength>200000);
  const before=await get('/api/status');await Promise.all(Array.from({length:30},()=>fetch(inspector.url+'/api/live').then(r=>r.arrayBuffer())));const after=await get('/api/status');assert.ok(after.demandRequests-before.demandRequests<=1,'Concurrent viewers share the 2 Hz capture limit');assert.equal(after.maximumLiveHz,2);assert.equal(after.captureMode,'on-demand');
  await delay(600);assert.equal((await get('/api/status')).demandRequests,after.demandRequests,'No timer produces captures without demand');
  const p=JSON.parse(await readFile(new URL('../helpers/kid-dracula-jp.json',import.meta.url),'utf8'));
  const post=body=>fetch(inspector.url+'/api/helpers',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':inspector.token},body:JSON.stringify(body)});
  assert.equal((await fetch(inspector.url+'/api/helpers',{method:'POST',body:JSON.stringify(p)})).status,403);
  assert.equal((await post({...p,id:'../outside'})).status,400);assert.equal((await post(p)).status,201);
  assert.equal(JSON.parse(await readFile(path.join(dataDir,'helpers',p.id+'.json'),'utf8')).id,p.id);
  assert.equal((await get('/api/helpers?id='+p.id)).id,p.id);assert.equal((await get('/api/overlays?snapshot=s26')).matched,false);
  producer.end();
 }finally{producer?.destroy();await inspector.close();assert.equal(path.dirname(path.resolve(dataDir)),path.resolve(tmpdir()));assert.ok(path.basename(dataDir).startsWith('nes-rea-protocol-'));await rm(dataDir,{recursive:true,force:true});}
});
