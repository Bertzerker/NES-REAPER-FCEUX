// SPDX-License-Identifier: GPL-2.0-or-later
// Declarative, bounded game helpers. Reads copied RAM; never executes profile code.
const fail=m=>{throw Error(`Helper: ${m}`);};
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const text=(v,n=200)=>typeof v==='string'&&v.length<=n;
const ops={add:[2,8],sub:[2,2],mul:[2,2],div:[2,2],mod:[2,2],and:[2,2],eq:[2,2],ne:[2,2],lt:[2,2],gte:[2,2],all:[1,8],any:[1,8],select:[3,3],table:[2,2]};
function checkExpr(e,depth=0){
 if(depth>12)fail('expression too deep');
 if(typeof e==='number'){if(!Number.isFinite(e)||Math.abs(e)>65536)fail('invalid number');return;}
 if(!e||typeof e!=='object'||Array.isArray(e))fail('invalid expression');
 if('ram'in e){if(!integer(e.ram,0,2047)||!integer(e.stride??0,0,64)||![1,2].includes(e.width??1)||typeof(e.signed??false)!=='boolean'||e.ram+31*(e.stride??0)+(e.width??1)>2048)fail('RAM field out of bounds');return;}
 const arity=ops[e.op];if(!arity||!Array.isArray(e.args)||e.args.length<arity[0]||e.args.length>arity[1])fail('unknown expression operation');
 if(e.op==='table'){if(!Array.isArray(e.args[0])||e.args[0].length>256||e.args[0].some(x=>!integer(x,-65536,65536)))fail('invalid lookup table');checkExpr(e.args[1],depth+1);}
 else e.args.forEach(a=>checkExpr(a,depth+1));
}
export function validateHelper(p){
 if(!p||p.version!==1||!text(p.id,64)||!/^[-a-z0-9]+$/.test(p.id)||!text(p.title)||!Array.isArray(p.romMd5)||p.romMd5.length<1||p.romMd5.length>16||p.romMd5.some(x=>!/^([a-f0-9]{32})$/.test(x)))fail('invalid identity');
 if(!text(p.notes??'',4000)||!Array.isArray(p.classes)||p.classes.length<1||p.classes.length>16)fail('invalid classes');
 const ids=new Set();
 for(const c of p.classes){
  if(!text(c.id,40)||!/^[-a-z0-9]+$/.test(c.id)||ids.has(c.id)||!text(c.label)||!integer(c.count,1,32)||!Array.isArray(c.shapes)||c.shapes.length>32)fail('invalid object class');ids.add(c.id);
  for(const e of [c.active??1,c.x,c.y])checkExpr(e);
  for(const s of c.shapes){
   if(!['point','rect'].includes(s.kind)||!text(s.label)||!/^#[a-f0-9]{6}$/i.test(s.color)||!['code-derived','replay-verified','hypothesis'].includes(s.confidence)||!text(s.evidence,2000))fail('invalid shape');
   for(const e of [s.when??1,s.x??0,s.y??0,...(s.kind==='rect'?[s.width,s.height]:[])])checkExpr(e);
   if(s.observedPc!==undefined&&(!integer(s.observedPc,0,65535)||!integer(s.probeIndex,0,255)))fail('invalid observed probe');
  }
 }
 if(!Array.isArray(p.contactRules??[])||(p.contactRules??[]).length>8)fail('too many contact rules');
 for(const r of p.contactRules??[]){
  if(r.algorithm!=='6502-contact-window-v1'||!ids.has(r.playerClass)||!ids.has(r.targetClass)||!text(r.label)||!text(r.evidence,2000)||!Array.isArray(r.rows)||r.rows.length>64||!r.rows.length||r.rows.some(a=>!Array.isArray(a)||a.length!==4||a.some(v=>!integer(v,0,255))))fail('invalid contact rule');
  for(const e of [r.row,r.carry??0,r.enabled??1,r.trimEnabled??0,r.trimInverted??0,r.verifiedWhen??0])checkExpr(e);
  if(!Array.isArray(r.verifiedRows??[])||(r.verifiedRows??[]).some(v=>!integer(v,0,r.rows.length-1)))fail('invalid verified rows');
 }
 if(JSON.stringify(p).length>60000)fail('profile too large');return p;
}
function value(e,ram,i){
 if(typeof e==='number')return e;
 if('ram'in e){const a=e.ram+(e.stride??0)*i,w=e.width??1;let n=ram[a]+(w===2?ram[a+1]*256:0);if(e.signed&&n>=2**(w*8-1))n-=2**(w*8);return n;}
 if(e.op==='select')return value(e.args[value(e.args[0],ram,i)?1:2],ram,i);
 if(e.op==='table'){const a=value(e.args[1],ram,i);if(!integer(a,0,e.args[0].length-1))throw Error('lookup index outside table');return e.args[0][a];}
 const a=e.args.map(x=>value(x,ram,i));let n;
 switch(e.op){case'add':n=a.reduce((x,y)=>x+y,0);break;case'sub':n=a[0]-a[1];break;case'mul':n=a[0]*a[1];break;case'div':n=Math.floor(a[0]/a[1]);break;case'mod':n=((a[0]%a[1])+a[1])%a[1];break;case'and':n=a[0]&a[1];break;case'eq':n=+(a[0]===a[1]);break;case'ne':n=+(a[0]!==a[1]);break;case'lt':n=+(a[0]<a[1]);break;case'gte':n=+(a[0]>=a[1]);break;case'all':n=+a.every(Boolean);break;case'any':n=+a.some(Boolean);break;}
 if(!Number.isFinite(n)||Math.abs(n)>1e9)throw Error('expression outside numeric bounds');return n;
}
const sbc=(a,b,c)=>{const n=a-b-(c?0:1);return[n&255,+(n>=0)];};
// Exact byte arithmetic at $BCBA..$BCF1, including ROR carry and odd X parity.
function contactX(px,tx,row,carry){
 const [v,c]=sbc(px,row[0],carry),dx=(((v>>>1)|(c<<7))-(tx>>>1))&255;
 return !(dx&128)&&((dx<<1)&255)<row[1];
}
function contactY(py,ty,row,trim,inverted){
 const [y,cy]=sbc(py,row[2],0);if(cy)return false;
 const [dy,hit]=sbc(y,ty,0);return !!hit&&dy<row[3]&&(!trim||(inverted?dy>=10:dy+10<row[3]));
}
export function contactContains(px,py,tx,ty,row,carry=0,trim=false,inverted=false){return contactX(px,tx,row,carry)&&contactY(py,ty,row,trim,inverted);}
function spans(test){const out=[];let start=-1;for(let n=0;n<=256;n++){const yes=n<256&&test(n);if(yes&&start<0)start=n;if(!yes&&start>=0){out.push([start,n-start]);start=-1;}}return out;}
export function evaluateHelper(state,p,selectedClass='all'){
 const meta=state.meta??state,result={snapshot:meta.id,profile:p.id,matched:p.romMd5.includes(meta.romMd5),shapes:[],objects:[],warnings:[]};
 if(!result.matched)return result;
 const ram=typeof state.buffers.ram==='string'?Uint8Array.from(state.buffers.ram.match(/../g)??[],s=>parseInt(s,16)):state.buffers.ram;
 if(ram.length!==2048)fail('expected copied 2 KiB RAM');
 const objects=new Map(),show=id=>selectedClass==='all'||selectedClass===id;
 for(const c of p.classes){const entries=[];objects.set(c.id,entries);
  for(let i=0;i<c.count;i++)try{
   if(!value(c.active??1,ram,i))continue;const x=value(c.x,ram,i),y=value(c.y,ram,i);if(Math.abs(x)>65536||Math.abs(y)>65536)throw Error('position outside bounds');
   const obj={classId:c.id,label:c.label,index:i,x,y};entries.push(obj);result.objects.push(obj);
   if(show(c.id))for(const s of c.shapes){if(!value(s.when??1,ram,i))continue;const shape={...obj,kind:s.kind,label:s.label,x:x+value(s.x??0,ram,i),y:y+value(s.y??0,ram,i),color:s.color,confidence:s.confidence,evidence:s.evidence};
    if(s.kind==='rect'){shape.width=value(s.width,ram,i);shape.height=value(s.height,ram,i);if(shape.width<=0||shape.height<=0||shape.width>1024||shape.height>1024)continue;}
    if(s.observedPc!==undefined)shape.observed=(meta.events??[]).some(e=>e[0]===4&&e[1]===s.observedPc&&e[6]===s.probeIndex);
    result.shapes.push(shape);
   }
  }catch(e){result.warnings.push(`${c.id}[${i}]: ${e.message}`);}
 }
 for(const rule of p.contactRules??[]){if(!show(rule.playerClass))continue;const cache=new Map();
  for(const player of objects.get(rule.playerClass))for(const target of objects.get(rule.targetClass))try{
   const rowIndex=value(rule.row,ram,target.index);if(!integer(rowIndex,0,rule.rows.length-1))throw Error('contact row outside table');
   const row=rule.rows[rowIndex],carry=!!value(rule.carry??0,ram,target.index),trim=!!value(rule.trimEnabled??0,ram,target.index),inv=!!value(rule.trimInverted??0,ram,target.index),enabled=!!value(rule.enabled??1,ram,target.index);
   const key=JSON.stringify([player.x,player.y,rowIndex,carry,trim,inv]);let regions=cache.get(key);
   if(!regions){
    const ys=spans(y=>contactY(player.y,y,row,trim,inv));
    const xs=ys.length?spans(x=>contactX(player.x,x,row,carry)):[];
    regions=xs.flatMap(([x,width])=>ys.map(([y,height])=>({x,y,width,height})));cache.set(key,regions);
   }
   for(const region of regions)if(!result.shapes.some(s=>s.rule===rule.label&&s.row===rowIndex&&s.enabled===enabled&&s.x===region.x&&s.y===region.y))result.shapes.push({...region,classId:rule.playerClass,kind:'rect',rule:rule.label,row:rowIndex,label:`${rule.label} · row ${rowIndex}${enabled?'':' · gated'}`,color:enabled?'#ffbf69':'#a7aab6',confidence:(rule.verifiedRows??[]).includes(rowIndex)&&value(rule.verifiedWhen??0,ram,target.index)?'replay-verified':'code-derived',evidence:rule.evidence,enabled,semantics:'Region of counterpart origins accepted by the player contact test; combined dimensions, not a separate player hurtbox.'});
   target.contact={row:rowIndex,enabled,inside:contactContains(player.x,player.y,target.x,target.y,row,carry,trim,inv)};
  }catch(e){result.warnings.push(`contact[${target.index}]: ${e.message}`);}
 }
 return result;
}
