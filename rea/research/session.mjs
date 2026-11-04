// SPDX-License-Identifier: GPL-2.0-or-later
// Local research client; controls only an already-running FCEUX instance.
import {writeFile,mkdir} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
export const base='http://127.0.0.1:8775';
export async function control(body){const {token}=await(await fetch(base+'/api/session')).json();const r=await fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':token},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(JSON.stringify(result));return result;}
export async function snapshot(id){const r=await fetch(base+'/api/snapshot'+(id?'?snapshot='+encodeURIComponent(id):''));if(!r.ok)throw Error(await r.text());return r.json();}
export async function step(frames,pad0=0){const r=await control({op:'step',frames,pad0});return snapshot(r.snapshot);}
function crc32(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),head=Buffer.alloc(4),crc=Buffer.alloc(4);head.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([head,t,data,crc]);}
export async function capture(s,name){await mkdir('rea/test-output/collision',{recursive:true});await writeFile(`rea/test-output/collision/${name}.json`,JSON.stringify(s));const b=Object.fromEntries(Object.entries(s.buffers).map(([k,v])=>[k,Buffer.from(v,'hex')])),raw=Buffer.alloc(240*(256*3+1));for(let y=0;y<240;y++)for(let x=0;x<256;x++){const n=y*256+x,i=((b.emphasis[n]&7)*64+(b.screen[n]&63))*3;b.rgbPalette.copy(raw,y*769+1+x*3,i,i+3);}const h=Buffer.alloc(13);h.writeUInt32BE(256);h.writeUInt32BE(240,4);h[8]=8;h[9]=2;await writeFile(`rea/test-output/collision/${name}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));return {name,id:s.id,frame:s.frame};}
