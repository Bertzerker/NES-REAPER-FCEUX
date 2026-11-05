// SPDX-License-Identifier: GPL-2.0-or-later
import {draftStorage,download} from './workbench.mjs';
let renderer,mermaid,sequence=0;
export async function renderComment(target,text,format='markdown'){
 target.replaceChildren();
 if(format==='plain'){const pre=document.createElement('pre');pre.textContent=text;target.append(pre);return;}
 renderer??=import('./vendor/markup.mjs');const {marked,purify}=await renderer;
 const source=format==='json'||format==='mermaid'?`\`\`\`${format}\n${text}\n\`\`\``:text;
 target.innerHTML=purify.sanitize(marked.parse(source,{gfm:true,breaks:false}),{FORBID_TAGS:['script','style','iframe','object','embed','img','form','input','button','textarea','select','svg','math'],FORBID_ATTR:['style','src','srcset']});
 for(const a of target.querySelectorAll('a')){const href=a.getAttribute('href')??'';if(!/^(https?:\/\/|#)/i.test(href))a.removeAttribute('href');else{a.target='_blank';a.rel='noopener noreferrer';}}
 for(const code of target.querySelectorAll('code.language-json'))try{code.textContent=JSON.stringify(JSON.parse(code.textContent),null,2);}catch(e){const error=document.createElement('p');error.className='comment-error';error.textContent='Invalid JSON: '+e.message;code.parentNode.after(error);}
 const diagrams=[...target.querySelectorAll('code.language-mermaid')];
 for(const [index,code]of diagrams.entries()){
  const box=document.createElement('div');box.className='mermaid-diagram';code.parentNode.replaceWith(box);
  try{
   const source=code.textContent;if(index>=4||source.length>8000)throw Error('Limit: four diagrams, 8000 characters each.');
   if(/%%\s*\{|^\s*---/m.test(source))throw Error('Diagram configuration directives are disabled.');
   mermaid??=import('./vendor/mermaid.mjs').then(m=>{m.default.initialize({startOnLoad:false,securityLevel:'strict',theme:'dark',htmlLabels:false,fontFamily:'Arial, sans-serif',maxTextSize:8000,maxEdges:100,flowchart:{htmlLabels:false},secure:['securityLevel','maxTextSize','maxEdges','htmlLabels','startOnLoad','secure']});return m.default;});
   const m=await mermaid,{svg}=await m.render('rea-diagram-'+(++sequence),source);
   box.innerHTML=purify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','image','a','script'],FORBID_ATTR:['onload','onclick','onerror']});
  }catch(e){box.classList.add('comment-error');box.textContent='Mermaid: '+e.message;}
 }
}
export function setupComments({api,current,review,freeze,notice,refreshNotes,openDrawer,perform,command,reason,setMachine,changed}){
 const $=id=>document.getElementById(id);let anchor=null,editing=null,editRevision=null,notes=[],playback=null,movieKey='',saving=false,conflict=null,anchorAvailable=true;
 const prefix='rea-nes-draft-v1:',tabKey='rea-nes-draft-tab';let tabId;
 try{tabId=sessionStorage.getItem(tabKey)||crypto.randomUUID();sessionStorage.setItem(tabKey,tabId);}catch{tabId=String(Date.now())+Math.random();}
 const key=prefix+tabId,storage=draftStorage(localStorage,key);
 const hasDraft=()=>!!anchor;
 const mode=()=>playback?.movie?.mode??'inactive';
 const label=(m,frame)=>`${m?.name||'NES inspection'} · frame ${frame}${m?.mode&&m.mode!=='inactive'?` · input ${m.inputFrame} · movie revision ${m.rerecordCount}`:''}`;
 function availabilityChanged(){
  $('save-note').disabled=!anchor||saving||!anchorAvailable;$('save-note').title=!anchorAvailable?'Captured evidence is unavailable on this server. Your text is retained.':saving?'Saving comment…':'';
  for(const e of [$('capture-comment'),$('comment-displayed')]){const why=reason(e.dataset.action);e.disabled=!!why;e.title=why;}
 }
 function persist(){if(!anchor)return;try{storage.write({anchor,editing,revision:editRevision,text:$('note').value,kind:$('note-kind').value,format:$('note-format').value});$('draft-status').textContent=`Draft saved locally · ${editing?'editing comment revision '+editRevision:'new comment'} · evidence frame ${anchor.frame}`;}catch(e){$('draft-status').textContent='Draft is only in this tab: browser storage failed. Copy your text before closing.';notice('Draft recovery storage failed: '+e.message,true);}}
 for(const id of ['note','note-kind','note-format'])$(id).addEventListener('input',persist);
 addEventListener('pagehide',persist);
 function editor(){openDrawer('comments');$('comment-editor').hidden=false;$('comment-anchor').textContent=label(anchor.movie,anchor.frame)+` · ${anchor.movieFile?.status??'stored evidence'}`;$('comment-image').hidden=!anchor.imageSha256;if(anchor.imageSha256)$('comment-image').src='/api/evidence/'+anchor.imageSha256+'.png';$('comment-conflict').hidden=!conflict;availabilityChanged();changed();}
 function clearDraft(){anchor=null;editing=null;editRevision=null;conflict=null;anchorAvailable=true;storage.clear();$('note').value='';$('comment-preview').replaceChildren();$('comment-editor').hidden=true;$('comment-conflict').hidden=true;$('draft-status').textContent='No open draft.';changed();}
 function updatePlayback(state){if(!state)return;playback=state;const m=state.movie??{mode:'inactive'},active=m.mode!=='inactive';$('movie-status').textContent=active?`${m.name||'TAS project'} · ${m.mode}${m.recording?' / recording':''} · live frame ${state.frame} / ${m.length} · revision ${m.rerecordCount}${m.readOnly?' · read-only':''}`:'No movie loaded. Open matching FM2 here; recording and input editing use native FCEUX.';$('movie-progress').max=Math.max(1,m.length??0);$('movie-progress').value=Math.min(state.frame??0,m.length??0);const next=[m.guid,m.path,m.mode].join('|');if(next!==movieKey){movieKey=next;renderNotes();}}
 const guarded=fn=>()=>Promise.resolve().then(fn).catch(e=>notice(e.message,true));
 $('movie-restart').onclick=guarded(()=>command({op:'movie-restart'},'movie-restart'));
 $('movie-stop').onclick=guarded(()=>command({op:'movie-stop'},'movie-stop'));
 $('movie-file').onchange=guarded(async()=>{const file=$('movie-file').files[0];if(!file)return;try{if(file.size>16*1024*1024)throw Error('FM2 is limited to 16 MiB.');await perform('movie-import',async()=>{const result=await api('/api/movie?name='+encodeURIComponent(file.name),await file.arrayBuffer()),s=await api('/api/snapshot?snapshot='+encodeURIComponent(result.snapshot));setMachine(s.playback);review(s);notice(result.message);},'movie-open');}finally{$('movie-file').value='';}});
 async function capture(displayed){await perform(displayed?'comment-displayed':'capture-current',async()=>{const s=current();anchor=await api('/api/annotations/capture',displayed?(s.archivedEvidence?{evidenceSha256:s.archivedEvidence}:{snapshot:s.meta.id}):{});editing=null;editRevision=null;anchorAvailable=true;freeze();const raw=await api('/api/evidence/'+anchor.evidenceSha256+'.json');review(raw,anchor.evidenceSha256);if(!displayed)setMachine(raw.playback);editor();persist();$('note').focus();notice('Render and copied memory saved. This draft stays attached to frame '+anchor.frame);},displayed?'comment-displayed':'bookmark');}
 $('capture-comment').onclick=guarded(()=>capture(false));$('comment-displayed').onclick=guarded(()=>capture(true));
 $('comment-preview-button').onclick=guarded(()=>renderComment($('comment-preview'),$('note').value,$('note-format').value));
 for(const [id,code]of [['insert-json','```json\n{\n  "address": "0x0000",\n  "observation": ""\n}\n```'],['insert-mermaid','```mermaid\nflowchart LR\n  Input --> Update[Game update]\n  Update --> Collision\n  Collision --> Render\n```']])$(id).onclick=()=>{$('note-format').value='markdown';const e=$('note');e.setRangeText('\n'+code+'\n',e.selectionStart,e.selectionEnd,'end');persist();e.focus();};
 $('save-note').onclick=guarded(async()=>{
  if(!anchor||saving||!anchorAvailable)return;saving=true;availabilityChanged();persist();
  try{const body={kind:$('note-kind').value,format:$('note-format').value,text:$('note').value};if(editing)body.revision=editRevision;else Object.assign(body,{snapshot:anchor.snapshot,evidenceSha256:anchor.evidenceSha256});await api(editing?'/api/annotations/'+editing:'/api/annotations',body);clearDraft();await refreshNotes();localStorage.setItem('rea-nes-comments-changed',String(Date.now()));notice('Comment saved. Render/memory/frame identity is unchanged.');}
  catch(e){if(e.status===409&&e.current){conflict=e.current;$('comment-conflict').hidden=false;$('conflict-text').textContent=`Latest comment revision ${conflict.revision}:\n${conflict.text}`;$('draft-status').textContent='Conflict: your unsaved text is retained locally. Choose how to resolve it.';}throw e;}
  finally{saving=false;availabilityChanged();}
 });
 $('cancel-comment').onclick=()=>{clearDraft();notice('Local draft discarded. Saved comments are unchanged.');};
 $('conflict-reload').onclick=()=>{if(!conflict)return;editing=conflict.id;editRevision=conflict.revision;anchor=conflict;$('note').value=conflict.text;$('note-kind').value=conflict.kind;$('note-format').value=conflict.format==='plain'?'markdown':conflict.format;conflict=null;editor();persist();};
 $('conflict-copy').onclick=()=>{editing=null;editRevision=null;conflict=null;editor();persist();notice('Your text will save as a new comment against the same immutable evidence.');};
 async function restore(shared=false){let recovered;try{recovered=storage.read();if(!recovered){const candidates=Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>draftStorage(localStorage,k).read()).filter(Boolean).sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''));if(!shared&&candidates.length){$('recover-draft').hidden=false;$('draft-status').textContent='Other local drafts are available. Recover a copy explicitly to avoid replacing another tab’s work.';return;}recovered=candidates[0];}if(!recovered)return;$('recover-draft').hidden=true;anchor=recovered.anchor;editing=recovered.editing;editRevision=recovered.revision;$('note').value=recovered.text;$('note-kind').value=recovered.kind;$('note-format').value=recovered.format;editor();persist();$('draft-status').textContent='Recovered unsaved draft. Its original frame and text revision are retained.';try{await api('/api/evidence/'+anchor.evidenceSha256+'.json');}catch{anchorAvailable=false;availabilityChanged();$('draft-status').textContent='Recovered text; original evidence is unavailable on this server. Your draft remains local.';}}catch(e){notice('Draft recovery failed: '+e.message,true);}}
 function renderNotes(){
  const rom=current()?.meta.romMd5,movie=playback?.movie,scope=$('comment-scope').value;
  const list=notes.filter(n=>scope==='all'||n.romMd5===rom&&(scope==='rom'||!movie||movie.mode==='inactive'||n.movie&&(movie.guid?n.movie.guid?.toLowerCase()===movie.guid.toLowerCase():n.movie.path===movie.path)));
  $('notes').replaceChildren();$('comment-count').textContent=`${list.length} comments`;if(!list.length){$('notes').textContent='No comments in this scope. Choose all archived comments to review another session.';return;}
  for(const n of list.slice().reverse().slice(0,24)){
   const card=document.createElement('article');card.className='movie-comment';card.dataset.note=n.id;const title=document.createElement('b');title.textContent=label(n.movie,n.frame??'?')+` · ${n.kind} · text revision ${n.revision??1}`;card.append(title);
   const actions=[['Review snapshot',async()=>{freeze();review(await api('/api/annotations/'+n.id+'/snapshot'),n.evidenceSha256);notice('SAVED evidence shown; the separately labeled live playhead is unchanged.');}],['Edit',async()=>{if(anchor)throw Error('Save or discard the current draft first.');const latest=(await api('/api/annotations')).find(x=>x.id===n.id);if(!latest)throw Error('Comment no longer exists.');anchor=latest;editing=latest.id;editRevision=latest.revision??1;anchorAvailable=true;$('note').value=latest.text;$('note-kind').value=latest.kind;$('note-format').value=latest.format==='plain'?'markdown':latest.format??'markdown';editor();persist();$('note').focus();}],['Markdown',()=>download('/api/annotations/'+n.id+'/markdown',`frame-${n.frame}.md`)],['JSON + memory',()=>download('/api/annotations/'+n.id+'/json',`frame-${n.frame}.json`)],['Evidence bundle',()=>download('/api/annotations/'+n.id+'/bundle','rea-investigation.zip')]];
   if(n.imageSha256)actions.push(['PNG',()=>download('/api/evidence/'+n.imageSha256+'.png',`frame-${n.frame}.png`)]);if(n.movieFile?.status==='verified')actions.push(['Annotated FM2 copy',()=>download('/api/annotations/'+n.id+'/fm2','movie-with-rea-comments.fm2')]);
   const row=document.createElement('div');row.className='comment-actions';for(const [text,action]of actions){const b=document.createElement('button');b.textContent=text;b.onclick=guarded(action);row.append(b);}
   const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');body.className='comment-body';summary.textContent=`Read ${n.format??'plain'} comment`;details.append(summary,body);let rendered=false;details.ontoggle=()=>{if(details.open&&!rendered){rendered=true;renderComment(body,n.text,n.format??'plain').catch(e=>{body.textContent=e.message;});}};const excerpt=document.createElement('p');excerpt.textContent=n.text.slice(0,180);card.append(excerpt,row,details);$('notes').append(card);
  }
 }
 $('recover-draft').onclick=guarded(()=>restore(true));
 $('comment-scope').onchange=renderNotes;$('refresh-comments').onclick=guarded(refreshNotes);
 addEventListener('storage',e=>{if(e.key==='rea-nes-comments-changed'){refreshNotes().catch(e=>notice(e.message,true));if(editing)$('draft-status').textContent='Another tab saved comments. Your draft is retained; Save checks its revision.';}});
 return {updatePlayback,hasDraft,availabilityChanged,restore,isMovie:()=>['playback','tas-editor'].includes(mode()),setNotes:list=>{notes=list;renderNotes();}};
}
