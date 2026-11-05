// SPDX-License-Identifier: GPL-2.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {startInspector} from '../server.mjs';
import {sizes} from '../public/inspection.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function packet(meta,buffers=[]){const text=Buffer.from(JSON.stringify(meta)),h=Buffer.alloc(8);h.writeUInt32LE(4+text.length+buffers.reduce((n,b)=>n+b.length,0));h.writeUInt32LE(text.length,4);return Buffer.concat([h,text,...buffers]);}
test('HTTP command lifecycle: no producer, concurrent commands, pause interruption, reconnect and unknown timeout',{timeout:15000},async()=>{
 const server=await startInspector({port:18987,commandTimeout:150});let producer,held;
 const get=async route=>(await fetch(server.url+route)).json();
 const post=body=>fetch(server.url+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':server.token},body:JSON.stringify(body)});
 const connect=async id=>{const s=net.connect(server.nativePort,'127.0.0.1');await new Promise(r=>s.once('connect',r));s.write(packet({kind:'hello',token:server.token}));s.write(packet({kind:'snapshot',version:1,id,session:id,frame:1,cycle:1,romMd5:'test',buffers:Object.entries(sizes)},Object.values(sizes).map(n=>Buffer.alloc(n))));let text='';s.on('data',b=>{text+=b;while(text.includes('\n')){const at=text.indexOf('\n'),line=text.slice(0,at).split(' ');text=text.slice(at+1);const request=Number(line[0]),op=line[1];if(op==='step')held=request;else if(op==='pause'){s.write(packet({kind:'reply',request,ok:true,snapshot:id}));if(held){s.write(packet({kind:'reply',request:held,ok:false,message:'interrupted by pause',snapshot:id}));held=null;}}else if(op==='status')s.write(packet({kind:'reply',request,ok:true,state:{paused:true,frame:1,movie:{mode:'inactive'}}}));}});for(let i=0;i<30;i++){if((await get('/api/session')).latest===id)break;await delay(5);}return s;};
 try{
  assert.equal((await get('/api/session')).connected,false);assert.equal((await post({op:'step',frames:1})).status,409);
  producer=await connect('first');const stepping=post({op:'step',frames:100});for(let i=0;i<20&&!held;i++)await delay(2);
  assert.equal((await get('/api/session')).pending[0].op,'step');assert.equal((await post({op:'speed',percent:50})).status,409);
  assert.equal((await post({op:'pause'})).status,200);assert.equal((await stepping).status,409);
  producer.destroy();for(let i=0;i<30&&(await get('/api/session')).connected;i++)await delay(5);assert.equal((await get('/api/session')).connected,false);
  producer=await connect('second');assert.equal((await get('/api/session')).connectionEpoch,2);
  assert.equal((await post({op:'trace',limit:1})).status,504);assert.equal((await get('/api/session')).stateUnknown,true);assert.equal((await post({op:'run'})).status,409);
  await get('/api/playback');assert.equal((await get('/api/session')).stateUnknown,false);
 }finally{producer?.destroy();await server.close();}
});
