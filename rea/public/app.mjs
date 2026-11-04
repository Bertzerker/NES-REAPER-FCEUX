// SPDX-License-Identifier: GPL-2.0-or-later
import {decodePacket,render,views,inspectPixel,sprite} from './inspection.mjs';
import {validateHelper,evaluateHelper} from './helpers.mjs';
import {setupComments} from './comments.mjs';
const $=id=>document.getElementById(id),hex=(n,len=4)=>n.toString(16).toUpperCase().padStart(len,'0');
let current,previous,frozen=true,token='',connected=false,selectionPoint=null,annotations=[],helpers=[],helperKey='';
let commentUI;
$('freeze').textContent='Resume inspection';
const detached=new URLSearchParams(location.search).get('view');if(detached)document.body.classList.add('detached');
const definitions={composite:['Composite','Captured','Actual core output, before text and debugger overlays.'],background:['Background','Captured','Old-PPU scanlines before sprite composition. Includes scroll and raster changes.'],sprites:['Sprites','Captured','Evaluated sprite pixels with priority hidden. Transparent areas show the grid.'],nametables:['Nametables','Diagnostic','All four logical nametables. Mirroring aliases and end-of-frame CHR mapping apply.'],patterns:['CHR patterns','Diagnostic','512 mapped 8 × 8 patterns. Background palette 0; this is not the original sprite sheet.'],palettes:['Palettes','Diagnostic','Background palettes above, sprite palettes below. End-of-frame colors.']};
const canvases={},renderCache={};
const liveMetrics={received:0,bytes:0,draws:0,drawMs:0,maxDrawMs:0};
for(const [view,[title,type,caption]] of Object.entries(definitions)) {
 if(detached&&detached!==view)continue;
 const card=document.createElement('article');card.className='view';
 const header=document.createElement('div');header.className='view-header';const titleEl=document.createElement('b');titleEl.textContent=title;const badge=document.createElement('span');badge.className=`badge ${type==='Diagnostic'?'diagnostic':''}`;badge.textContent=type;
 const link=document.createElement('a');link.href=`/?view=${view}`;link.target='_blank';link.rel='noopener';link.textContent='↗';link.title=`Open ${title} separately`;
 header.append(titleEl,badge,link);const wrap=document.createElement('div');wrap.className='canvas-wrap';const canvas=document.createElement('canvas');[canvas.width,canvas.height]=views[view];canvas.setAttribute('aria-label',title);wrap.append(canvas);
 const info=document.createElement('div');info.className='view-caption';info.textContent=caption;card.append(header,wrap,info);$('views').append(card);canvases[view]=canvas;
 canvas.addEventListener('click',async e=>{
  if(!current)return;const rect=canvas.getBoundingClientRect(),x=Math.floor((e.clientX-rect.left)*canvas.width/rect.width),y=Math.floor((e.clientY-rect.top)*canvas.height/rect.height);
  selectionPoint={view,x,y};const selected=updateSelection();frozen=true;$('freeze').textContent='Resume inspection';
  try{await api(`/api/snapshot?snapshot=${encodeURIComponent(selected.snapshot)}`);}catch(e){notice(e.message,true);}
 });
}
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function updateSelection(){if(!current||!selectionPoint)return;const {view,x,y}=selectionPoint,selected=inspectPixel(current,view,x,y);$('selection-label').textContent=`${definitions[view][0]} · ${x}, ${y}`;$('selection').textContent=JSON.stringify(selected,null,2);return selected;}
async function api(url,body){const binary=body instanceof ArrayBuffer;const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':binary?'application/octet-stream':'application/json','X-REA-Token':token},body:binary?body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw Error(data.error||data.message||`HTTP ${r.status}`);return data;}
async function control(body){try{notice(`Executing ${body.op}…`);const data=await api('/api/control',body);notice(`${data.message} · ${data.snapshot}`);if(data.snapshot){const r=await fetch(`/api/frame?snapshot=${encodeURIComponent(data.snapshot)}`);if(r.ok)show(decodePacket(new Uint8Array(await r.arrayBuffer())),true);}}catch(e){notice(e.message,true);}}
for(const el of document.querySelectorAll('[data-op]'))el.onclick=()=>control({op:el.dataset.op==='step'&&commentUI?.isMovie()?'movie-step':el.dataset.op,slot:Number($('slot').value),frames:1});
$('freeze').onclick=async()=>{frozen=!frozen;$('freeze').textContent=frozen?'Resume inspection':'Freeze inspection';if(frozen&&current)try{await api(`/api/snapshot?snapshot=${encodeURIComponent(current.meta.id)}`);}catch(e){notice(e.message,true);}};
$('bounds').onchange=()=>{if(current)draw();};
$('trace').onclick=()=>control({op:'trace',limit:128});
$('watch').onclick=()=>control({op:'watch',start:Number($('watch-address').value),end:Number($('watch-address').value),access:Number($('watch-access').value)});
$('unwatch').onclick=()=>control({op:'watch',start:0,end:0,access:0});
$('export').onclick=async()=>{try{if(!current)return;const snapshot=await api(`/api/snapshot?snapshot=${encodeURIComponent(current.meta.id)}`);const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`nes-rea-${current.meta.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notice(e.message,true);}};
async function notes(){annotations=await api('/api/annotations');renderNotes();}
function renderNotes(){commentUI?.setNotes(annotations);}
function equalBytes(a,b){if(a===b)return true;if(!a||!b||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function activeHelper(){const id=$('helper-profile').value;return id==='auto'?helpers.find(p=>p.romMd5.includes(current?.meta.romMd5)):helpers.find(p=>p.id===id);}
function helperSelection(){const p=activeHelper(),key=(p?.id??'none')+current?.meta.romMd5;if(key===helperKey)return;helperKey=key;$('helper-class').replaceChildren(new Option('All classes','all'));if(p){for(const c of p.classes)$('helper-class').append(new Option(c.label,c.id));$('helper-json').value=JSON.stringify(p,null,2);}$('helper-description').textContent=p?.notes??'No helper matches this ROM revision. Create a definition to add object classes and collision geometry.';}
function drawHelper(ctx){helperSelection();const p=activeHelper();if(!p){$('helper-result').textContent='No matching helper.';return;}
 const result=evaluateHelper(current,p,$('helper-class').value);if(!result.matched){$('helper-result').textContent='ROM digest mismatch — this helper is inactive.';return;}
 const boxes=result.shapes.filter(s=>s.kind==='rect');$('helper-result').textContent=`${result.shapes.length} shapes · ${result.objects.length} objects · ${current.meta.id}\n`+boxes.map(s=>`${s.label}: (${s.x}, ${s.y}) ${s.width} × ${s.height} · ${s.confidence}`).join('\n')+'\n'+result.objects.filter(o=>o.contact).map(o=>`${o.classId}[${o.index}] origin (${o.x}, ${o.y}) · row ${o.contact.row} · ${o.contact.inside?'inside':'outside'} · ${o.contact.enabled?'enabled':'gated'}`).join('\n')+(result.warnings.length?'\n'+result.warnings.join('\n'):'');
 if(!$('helper-overlay').checked||!ctx)return;
 ctx.save();ctx.lineWidth=.8;
 for(const s of result.shapes){ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.setLineDash(s.enabled===false||s.confidence==='hypothesis'?[2,2]:[]);if(s.kind==='rect'){ctx.globalAlpha=.12;ctx.fillRect(s.x,s.y,s.width,s.height);ctx.globalAlpha=1;ctx.strokeRect(s.x+.5,s.y+.5,s.width-1,s.height-1);}else{ctx.beginPath();ctx.moveTo(s.x-2,s.y+.5);ctx.lineTo(s.x+3,s.y+.5);ctx.moveTo(s.x+.5,s.y-2);ctx.lineTo(s.x+.5,s.y+3);ctx.stroke();if(s.observed)ctx.fillRect(s.x-1,s.y-1,3,3);}}
 ctx.restore();
}
for(const id of ['helper-overlay','helper-class'])$(id).onchange=()=>{if(current)draw();};
$('helper-profile').onchange=()=>{helperKey='';if(current)draw();};
$('helper-new').onclick=()=>{$('helper-json').value=JSON.stringify({version:1,id:'my-game',title:'My game helper',romMd5:[current?.meta.romMd5??'00000000000000000000000000000000'],notes:'Replace RAM addresses, validity conditions and geometry with evidence for this ROM.',classes:[{id:'player',label:'Player',count:1,active:1,x:{ram:0},y:{ram:1},shapes:[{kind:'rect',label:'Candidate box',x:-4,y:-8,width:8,height:16,color:'#ffbf69',confidence:'hypothesis',evidence:'Unverified placeholder; replace with game-code evidence.'}]}]},null,2);$('helper-json').closest('details').open=true;$('helper-save-status').textContent='New unsaved template — fill the actual game fields before saving.';};
$('helper-save').onclick=async()=>{try{const p=validateHelper(JSON.parse($('helper-json').value));await api('/api/helpers',p);helpers=await api('/api/helpers');populateHelpers(p.id);helperKey='';if(current)draw();$('helper-save-status').textContent='Helper validated and saved locally.';}catch(e){$('helper-save-status').textContent=e.message;}};
function populateHelpers(selected='auto'){$('helper-profile').replaceChildren(new Option('Auto · match ROM digest','auto'));for(const p of helpers)$('helper-profile').append(new Option(p.title,p.id));$('helper-profile').value=selected;}
function draw(){const begin=performance.now();for(const [view,canvas]of Object.entries(canvases)){
 const old=renderCache[view],staticView=['nametables','patterns','palettes'].includes(view);
 const deps=view==='nametables'?['nametables','chr','palette','rgbPalette']:view==='patterns'?['chr','palette','rgbPalette']:['palette','rgbPalette'];
 const unchanged=staticView&&old&&old.state.meta.ppu.ctrl===current.meta.ppu.ctrl&&deps.every(k=>equalBytes(old.state.buffers[k],current.buffers[k]));
 let image=old?.image;if(!unchanged){const r=render(current,view,image?.data);if(!image)image=new ImageData(r.rgba,r.width,r.height);renderCache[view]={state:current,image};}
 const ctx=canvas.getContext('2d');ctx.putImageData(image,0,0);
 if($('bounds').checked&&(view==='composite'||view==='sprites')){ctx.strokeStyle='#ddff90';ctx.lineWidth=.7;for(let i=0;i<64;i++){const e=sprite(current,i);if(e.y<240)ctx.strokeRect(e.x+.5,e.y+.5,7,e.height-1);}}
 if(view==='composite')drawHelper(ctx);
 }if(!canvases.composite)drawHelper(null);const elapsed=performance.now()-begin;liveMetrics.draws++;liveMetrics.drawMs=elapsed;liveMetrics.maxDrawMs=Math.max(liveMetrics.maxDrawMs,elapsed);if($('performance'))$('performance').textContent=`On demand · max 2 Hz · draw ${elapsed.toFixed(1)} ms`;}
function memory(){if(!current)return;const space=$('space').value,bytes=current.buffers[space],old=previous?.meta.romMd5===current.meta.romMd5?previous?.buffers[space]:null,start=Number($('address').value);if(!Number.isInteger(start)||start<0||start>=bytes.length){$('memory').textContent='Offset outside domain';return;}$('memory').replaceChildren();for(let a=start;a<Math.min(start+96,bytes.length);a+=8){$('memory').append(`${hex(a)}  `);for(let i=a;i<Math.min(a+8,bytes.length);i++){if(old&&old[i]!==bytes[i]){const mark=document.createElement('mark');mark.textContent=hex(bytes[i],2);$('memory').append(mark,' ');}else $('memory').append(`${hex(bytes[i],2)} `);}$('memory').append('\n');}}
$('space').onchange=memory;$('address').onchange=memory;$('address').oninput=memory;
function show(s,force=false,updatePlayback=true){if(frozen&&!force)return;previous=current;current=s;const m=s.meta;if(updatePlayback)commentUI?.updatePlayback(m.playback);$('frame').textContent=`${String(m.frame).padStart(6,'0')}`;$('moment').textContent=`${m.region} · CPU ${m.cycle} · ${m.paused?'paused':'running'}`;$('capture-id').textContent=m.id;$('registers').textContent=`PC ${hex(m.cpu.pc)}   A ${hex(m.cpu.a,2)}   X ${hex(m.cpu.x,2)}\nY  ${hex(m.cpu.y,2)}     SP ${hex(m.cpu.s,2)}  P ${hex(m.cpu.p,2)}\n\nCTRL ${hex(m.ppu.ctrl,2)}  MASK ${hex(m.ppu.mask,2)}  STATUS ${hex(m.ppu.status,2)}\nv ${hex(m.ppu.v)}   t ${hex(m.ppu.t)}   fine X ${m.ppu.fineX}\nNT aliases ${m.nametableAliases.join(' / ')}\nCore: ${m.ppuCore} PPU · raster ${m.rasterValid?'available':'unavailable'}`;draw();memory();updateSelection();if(previous?.meta.romMd5!==m.romMd5)renderNotes();$('events').textContent=m.events.length?m.events.slice(-80).map(e=>`${e[0]===4?'EXEC ':e[0]===2?'WRITE':'READ '} $${hex(e[1])}  ${hex(e[2],2)}  PC $${hex(e[3])}  @${e[4]}`).join('\n')+`\n${m.events.length} events · ${m.eventsDropped} dropped`: 'Arm a trace or watch, then step or run the emulator.';}
async function stream(){let after='';while(true){const begin=performance.now();try{if(!frozen&&!document.hidden){const r=await fetch(`/api/live?after=${encodeURIComponent(after)}`);if(r.status!==204){if(!r.ok)throw Error('Live capture unavailable');const bytes=new Uint8Array(await r.arrayBuffer());liveMetrics.received++;liveMetrics.bytes+=bytes.length;const s=decodePacket(bytes);after=s.meta.id;show(s);}}}catch(e){notice(e.message,true);}await new Promise(r=>setTimeout(r,Math.max(50,500-(performance.now()-begin))));}}
async function status(){try{const s=await api('/api/session');token=s.token;connected=s.connected;$('lamp').classList.toggle('on',connected);$('status').textContent=connected?'Emulator connected · local inspection':'Waiting for emulator';if(connected&&!document.hidden&&commentUI)commentUI.updatePlayback(await api('/api/playback'));}catch(e){notice(e.message,true);}}
commentUI=setupComments({api,current:()=>current,review:(raw,evidence)=>{const {buffers,...meta}=raw;const state={meta,buffers:Object.fromEntries(Object.entries(buffers).map(([k,v])=>[k,Uint8Array.from(v.match(/../g)??[],s=>parseInt(s,16))])),archivedEvidence:evidence};show(state,true,false);},freeze:()=>{frozen=true;$('freeze').textContent='Resume inspection';},notice,refreshNotes:notes});
await status();await notes();helpers=await api('/api/helpers');populateHelpers();try{const r=await fetch('/api/frame');if(r.ok)show(decodePacket(new Uint8Array(await r.arrayBuffer())),true);}catch(e){notice(e.message,true);}setInterval(status,1000);stream();
