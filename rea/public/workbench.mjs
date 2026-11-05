// SPDX-License-Identifier: GPL-2.0-or-later
export const sessionOf=meta=>meta?.session??meta?.id?.split('-').slice(0,2).join('-');
export function compareEvidence(baseline,current,space,start=0,length=96){
 if(!baseline||!current)return {changes:[],reason:'Pin a baseline to compare copied bytes.'};
 if(baseline.meta.romMd5!==current.meta.romMd5)return {changes:[],reason:'Comparison unavailable: different ROMs.'};
 if(sessionOf(baseline.meta)!==sessionOf(current.meta))return {changes:[],reason:'Comparison unavailable: different native sessions.'};
 const a=baseline.buffers[space],b=current.buffers[space];
 if(!a||!b)return {changes:[],reason:'This domain is unavailable in one capture.'};
 return {reason:'',changes:Array.from({length:Math.min(length,b.length-start)},(_,i)=>start+i).filter(i=>a[i]!==b[i]).map(address=>({address,before:a[address],after:b[address]}))};
}
export function actionReason(action,{server=true,connected=false,machine=null,current=null,pending=[],unknown=false,draft=false,slot=0}={}){
 if(!server)return 'Inspector server unavailable. Reconnect before dispatching actions.';
 const local=['freeze','export','baseline','comment-displayed'];
 if(local.includes(action)){
  if(!current)return 'Waiting for a capture. Connect FCEUX and step a frame.';
  if(action==='comment-displayed'&&!current.meta.screenValid)return 'No rendered frame in this capture. Step a frame first.';
  if(action==='comment-displayed'&&draft)return 'Save or discard the open comment draft first.';
  return '';
 }
 if(action==='save-comment')return '';
 if(!connected)return 'FCEUX bridge disconnected. Start or reconnect one FCEUX instance.';
 if(!machine)return 'Waiting for native machine status.';
 const m=machine.movie??{mode:'inactive'},recording=!!m.recording||m.mode==='recording';
 if(unknown&&!['pause','recheck'].includes(action))return 'Previous command outcome unknown. Recheck machine state or Pause.';
 if(pending.length&&!['recheck'].includes(action)){
  const interrupt=['pause','capture-current'].includes(action)&&pending.length===1&&['step','movie-step'].includes(pending[0].op);
  if(!interrupt)return 'Another command is pending: '+pending.map(p=>p.op).join(', ')+'. Pause can interrupt a bounded step.';
 }
 if(['play','step','experiment'].includes(action)&&recording)return 'Native movie/TAS recording is active. Finish recording in FCEUX first.';
 if(['play','step'].includes(action)&&['playback','finished'].includes(m.mode)&&machine.frame>=m.length)return 'Movie reached its end. Restart or stop the movie.';
 if(['step','experiment'].includes(action)&&!machine.paused)return 'Pause the live machine before a bounded step.';
 if(action==='experiment'&&m.mode!=='inactive')return 'Controller experiments require no active movie; recorded inputs remain authoritative.';
 if(['save','load'].includes(action)){
  if(m.mode!=='inactive')return 'Stop the movie or close TAS Editor before using session checkpoints.';
  if(!machine.paused)return 'Pause the live machine before saving/restoring a checkpoint.';
  if(action==='load'&&!machine.checkpoints?.[slot]?.occupied)return `Slot ${slot} is empty in this native session.`;
  if(action==='load'&&machine.checkpoints?.[slot]?.compatible===false)return 'Checkpoint uses a different PPU core or region.';
 }
 if(action==='capture-current'&&draft)return 'Save or discard the open comment draft first.';
 if(action==='capture-current'&&!current?.meta.screenValid)return 'Step a rendered frame before capturing a comment.';
 if(action==='movie-import'&&['recording','tas-editor'].includes(m.mode))return 'Finish recording or close native TAS Editor before importing FM2.';
 if(action==='movie-restart'&&!['playback','finished'].includes(m.mode))return 'Restart is available for a loaded FM2 playback.';
 if(action==='movie-stop'&&!['playback','finished'].includes(m.mode))return 'Stop playback is available for FM2. Finish recording/close TAS Editor in native FCEUX.';
 return '';
}
export function draftStorage(storage,key){
 return {read(){try{const d=JSON.parse(storage.getItem(key));return d?.version===1&&d.anchor&&typeof d.text==='string'?d:null;}catch{return null;}},write(d){storage.setItem(key,JSON.stringify({version:1,...d,updatedAt:new Date().toISOString()}));},clear(){storage.removeItem(key);}};
}
export const snapshotJSON=s=>({...s.meta,buffers:Object.fromEntries(Object.entries(s.buffers).map(([k,v])=>[k,Array.from(v,b=>b.toString(16).padStart(2,'0')).join('')]))});
export function parseSnapshot(raw,evidence){const {buffers,...meta}=raw;return {meta,buffers:Object.fromEntries(Object.entries(buffers).map(([k,v])=>[k,Uint8Array.from(v.match(/../g)??[],s=>parseInt(s,16))])),archivedEvidence:evidence};}
export async function download(url,name){const r=await fetch(url);if(!r.ok){let e;try{e=await r.json();}catch{}throw Error(e?.error??'Export failed');}saveBytes(await r.blob(),name);}
export function saveBytes(bytes,name){const href=URL.createObjectURL(bytes instanceof Blob?bytes:new Blob([bytes])),a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}
