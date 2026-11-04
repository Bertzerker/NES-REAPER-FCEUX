import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateHelper,evaluateHelper,contactContains} from '../public/helpers.mjs';
const profile=validateHelper(JSON.parse(await readFile(new URL('../helpers/kid-dracula-jp.json',import.meta.url),'utf8')));
function state(){const ram=new Uint8Array(2048);ram[0x18]=3;ram[0x500]=6;ram[0x53c]=128;ram[0x51e]=144;ram[0x5c6]=6;ram[0x50c]=12;ram[0x548]=142;ram[0x52a]=144;return{meta:{id:'fixture',romMd5:profile.romMd5[0],events:[]},buffers:{ram}};}
test('game helper scopes ROM, classes, states and contact gates',()=>{
 const s=state(),r=evaluateHelper(s,profile),box=r.shapes.find(x=>x.kind==='rect');assert.deepEqual([box.x,box.y,box.width,box.height],[116,114,28,57]);assert.equal(box.confidence,'replay-verified');assert.equal(r.objects[1].contact.inside,true);assert.equal(r.warnings.length,0);
 s.buffers.ram[0xc0]=100;assert.equal(evaluateHelper(s,profile).objects[1].contact.enabled,false);
 assert.ok(evaluateHelper(s,profile,'enemies').shapes.every(x=>x.classId==='enemies'));
 s.meta.romMd5='0'.repeat(32);assert.equal(evaluateHelper(s,profile).shapes.length,0);
 s.meta.romMd5=profile.romMd5[0];s.buffers.ram[0x19]=1;assert.equal(evaluateHelper(s,profile).shapes.length,0);
});
test('observed terrain probes and bounded declarative validation',()=>{
 const s=state();s.meta.events=[[4,0xe671,0,0,0,0,1]];assert.equal(evaluateHelper(s,profile).shapes.find(x=>x.label.includes('probe 1')).observed,true);
 for(const change of [p=>p.id='../escape',p=>p.classes[0].x={ram:2048},p=>p.classes[0].count=1000,p=>p.classes[0].x={op:'eval',args:['process.exit()']},p=>p.contactRules[0].rows[0]=[1,2,3,999]]){const p=structuredClone(profile);change(p);assert.throws(()=>validateHelper(p));}
 const p=structuredClone(profile);p.classes[0].x={op:'div',args:[1,0]};validateHelper(p);assert.ok(evaluateHelper(s,p).warnings.length);
});
test('verified boundary preserves two-pixel quantization and Y limits',()=>{
 const row=profile.contactRules[0].rows[4];for(const x of [116,117,142,143])assert.equal(contactContains(128,144,x,144,row),true);for(const x of [114,115,144,145])assert.equal(contactContains(128,144,x,144,row),false);
 for(const y of [114,170])assert.equal(contactContains(128,144,142,y,row),true);for(const y of [113,171])assert.equal(contactContains(128,144,142,y,row),false);
});
test('overlay rectangles preserve the comparator near screen edges and carry boundaries',()=>{
 const p=structuredClone(profile),rule=p.contactRules[0];rule.row=4;
 for(const px of [0,1,127,128,240,250,255])for(const py of [0,144,239])for(const carry of [0,1]){
  const s=state();s.buffers.ram[0x53c]=px;s.buffers.ram[0x51e]=py;rule.carry=carry;
  const boxes=evaluateHelper(s,p).shapes.filter(q=>q.kind==='rect');
  for(let x=0;x<256;x++)for(let y=0;y<256;y+=17)assert.equal(boxes.some(q=>x>=q.x&&x<q.x+q.width&&y>=q.y&&y<q.y+q.height),contactContains(px,py,x,y,rule.rows[4],carry),JSON.stringify({px,py,x,y,carry}));
 }
});
// Independent instruction-level oracle for the local ROM's short comparison routine.
// It executes the original opcodes; no ROM bytes are bundled with these tests.
function runOriginal(rom,px,py,tx,ty,row,carry,trim,inverted){
 const read=a=>a===0x53c?px:a===0x51e?py:a===9?tx>>>1:a===10?ty:a===0xb1?trim?128:0:a===0xad?inverted?128:0:rom[16+13*8192+(a&8191)];
 let pc=0xbcba,a=0,y=row*4,c=+carry,n=0,z=0,v=0;
 const nz=q=>{a=q&255;n=a>>>7;z=+(a===0);},word=()=>{const lo=read(pc++);return lo|read(pc++)<<8;};
 for(let budget=0;budget<80;budget++){
  if(pc===0xbcf3)return true;const code=read(pc++);
  switch(code){
   case 0xad:nz(read(word()));break;
   case 0xf9:case 0xe5:{const b=read(code===0xf9?word()+y:read(pc++)),q=a-b-(1-c);c=+(q>=0);nz(q);break;}
   case 0x6a:{const old=a;nz((a>>>1)|(c<<7));c=old&1;break;}
   case 0x38:c=1;break;
   case 0x0a:{const old=a;nz(a<<1);c=old>>>7;break;}
   case 0xd9:{const q=a-read(word()+y);c=+(q>=0);n=(q&255)>>>7;z=+((q&255)===0);break;}
   case 0xc9:{const q=a-read(pc++);c=+(q>=0);n=(q&255)>>>7;z=+((q&255)===0);break;}
   case 0x24:{const b=read(read(pc++));n=b>>>7;v=(b>>>6)&1;z=+((a&b)===0);break;}
   case 0x69:{const q=a+read(pc++)+c;c=+(q>255);nz(q);break;}
   case 0x30:case 0xb0:case 0x90:case 0x10:{let d=read(pc++);if(d>127)d-=256;if(code===0x30?n:code===0xb0?c:code===0x90?!c:!n)pc+=d;break;}
   case 0x60:return false;
   default:throw Error(`Unexpected original opcode ${code.toString(16)} at ${(pc-1).toString(16)}`);
  }
 }throw Error('Original routine exceeded instruction budget');
}
let localRom;try{localRom=await readFile(new URL('../../roms/Akumajou Special - Boku Dracula-kun (Japan).nes',import.meta.url));}catch(e){if(e.code!=='ENOENT')throw e;}
test('contact evaluator agrees with original ROM instructions across 5000 boundary/state samples',{skip:!localRom},()=>{
 let seed=17;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed>>>8)%n;};
 for(let i=0;i<5000;i++){const px=random(256),py=random(240),tx=random(256),ty=random(240),r=random(26),c=random(2),trim=random(2),inv=random(2);assert.equal(contactContains(px,py,tx,ty,profile.contactRules[0].rows[r],c,trim,inv),runOriginal(localRom,px,py,tx,ty,r,c,trim,inv),JSON.stringify({px,py,tx,ty,r,c,trim,inv}));}
});
