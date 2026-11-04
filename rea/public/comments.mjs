// SPDX-License-Identifier: GPL-2.0-or-later
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
export function setupComments({api,current,review,freeze,notice,refreshNotes}){
 const $=id=>document.getElementById(id);let draft=null,editing=null,notes=[],playback=null,movieKey='';
 const mode=()=>playback?.movie?.mode??'inactive';
 function movieLabel(movie,frame){return `${movie?.name||'NES inspection'} · frame ${frame}${movie?.mode&&movie.mode!=='inactive'?` · input ${movie.inputFrame} · revision ${movie.rerecordCount}`:''}`;}
 function updatePlayback(state){
  if(!state)return;playback=state;const m=state.movie??{mode:'inactive'},active=m.mode!=='inactive',end=active&&m.mode!=='tas-editor'&&state.frame>=m.length;
  $('movie-status').textContent=active?`${m.name||'TAS project'} · ${m.mode} · ${state.paused?'paused':'playing'} · frame ${state.frame} / ${m.length} · revision ${m.rerecordCount}${m.readOnly?' · read-only':''}`:'No movie loaded. Open a local FM2, or use the native FCEUX TAS Editor.';
  $('movie-play').disabled=!['playback','tas-editor'].includes(m.mode)||end||m.recording;$('movie-step').disabled=$('movie-play').disabled;
  $('movie-restart').disabled=!['playback','finished'].includes(m.mode);
  $('movie-progress').max=Math.max(1,m.length??0);$('movie-progress').value=Math.min(state.frame??0,m.length??0);
  if(state.speedPercent)$('movie-speed').value=String(state.speedPercent);
  for(const e of document.querySelectorAll('[data-op="save"],[data-op="load"]'))e.disabled=active;
  const step=document.querySelector('[data-op="step"]');if(step)step.disabled=!!m.recording;
  const key=[m.guid,m.path,m.mode].join('|');if(key!==movieKey){movieKey=key;renderNotes();}
 }
 async function command(body){try{const r=await api('/api/control',body);if(r.snapshot){const s=await api('/api/snapshot?snapshot='+encodeURIComponent(r.snapshot));review(s);updatePlayback(s.playback);}notice(r.message);}catch(e){notice(e.message,true);}}
 $('movie-play').onclick=()=>command({op:'movie-play'});$('movie-pause').onclick=()=>command({op:'pause'});$('movie-step').onclick=()=>command({op:'movie-step',frames:1});$('movie-restart').onclick=()=>command({op:'movie-restart'});
 $('movie-speed').onchange=()=>command({op:'speed',percent:Number($('movie-speed').value)});
 $('movie-file').onchange=async()=>{const file=$('movie-file').files[0];if(!file)return;try{if(file.size>16*1024*1024)throw Error('FM2 files are limited to 16 MiB.');notice('Loading read-only movie…');const result=await api('/api/movie?name='+encodeURIComponent(file.name),await file.arrayBuffer());const s=await api('/api/snapshot?snapshot='+encodeURIComponent(result.snapshot));review(s);updatePlayback(s.playback);notice(result.message);}catch(e){notice(e.message,true);}finally{$('movie-file').value='';}};
 async function capture(displayed=false){
  $('capture-comment').disabled=$('comment-displayed').disabled=true;
  try{const s=current();if(displayed&&!s)throw Error('No displayed capture.');draft=await api('/api/annotations/capture',displayed?(s.archivedEvidence?{evidenceSha256:s.archivedEvidence}:{snapshot:s.meta.id}):{});editing=null;freeze();const saved=await api('/api/evidence/'+draft.evidenceSha256+'.json');review(saved,draft.evidenceSha256);if(!displayed)updatePlayback(saved.playback);$('comment-anchor').textContent=movieLabel(draft.movie,draft.frame)+` · ${draft.movieFile.status}`;$('comment-image').src=draft.imageUrl;$('comment-image').hidden=false;$('save-note').disabled=false;$('comment-editor').hidden=false;$('note').focus();notice('Render and copied memory saved. This comment remains attached to that frame.');}
  catch(e){notice(e.message,true);}finally{$('capture-comment').disabled=$('comment-displayed').disabled=!!(draft||editing);}
 }
 $('capture-comment').onclick=()=>capture();$('comment-displayed').onclick=()=>capture(true);
 $('comment-preview-button').onclick=async()=>{try{await renderComment($('comment-preview'),$('note').value,$('note-format').value);}catch(e){notice(e.message,true);}};
 for(const [id,code]of [['insert-json','```json\n{\n  "address": "0x0000",\n  "observation": ""\n}\n```'],['insert-mermaid','```mermaid\nflowchart LR\n  Input --> Update[Game update]\n  Update --> Collision\n  Collision --> Render\n```']])$(id).onclick=()=>{$('note-format').value='markdown';const e=$('note'),start=e.selectionStart,end=e.selectionEnd;e.setRangeText('\n'+code+'\n',start,end,'end');e.focus();};
 $('save-note').onclick=async()=>{
  if(!draft&&!editing)return;const button=$('save-note');button.disabled=true;
  try{const body={kind:$('note-kind').value,format:$('note-format').value,text:$('note').value};if(!editing)Object.assign(body,{snapshot:draft.snapshot,evidenceSha256:draft.evidenceSha256});await api(editing?'/api/annotations/'+editing:'/api/annotations',body);notice(editing?'Comment updated; its evidence is unchanged.':'Comment saved with render, memory and movie frame.');editing=null;draft=null;$('capture-comment').disabled=$('comment-displayed').disabled=false;$('note').value='';$('comment-preview').replaceChildren();$('comment-editor').hidden=true;await refreshNotes();}catch(e){notice(e.message,true);button.disabled=false;}
 };
 $('cancel-comment').onclick=()=>{draft=null;editing=null;$('note').value='';$('comment-preview').replaceChildren();$('comment-editor').hidden=true;$('capture-comment').disabled=$('comment-displayed').disabled=false;notice('Draft cancelled; saved comments are unchanged.');};
 async function download(url,name){const r=await fetch(url);if(!r.ok){let e;try{e=await r.json();}catch{}throw Error(e?.error??'Export failed');}const href=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}
 function renderNotes(){
  const rom=current()?.meta.romMd5,movie=playback?.movie,scope=$('comment-scope').value;
  const list=notes.filter(n=>n.romMd5===rom&&(scope==='rom'||!movie||movie.mode==='inactive'||(n.movie&&(movie.guid?n.movie.guid===movie.guid:n.movie.path===movie.path))));
  $('notes').replaceChildren();$('comment-count').textContent=`${list.length} comments`;if(!list.length){$('notes').textContent='Capture a frame to start its comment.';return;}
  for(const n of list.slice().reverse().slice(0,24)){
   const card=document.createElement('article');card.className='movie-comment';const title=document.createElement('b');title.textContent=movieLabel(n.movie,n.frame??'?')+' · '+n.kind;card.append(title);
   const row=document.createElement('div');row.className='comment-actions';
   for(const [label,action]of [['Review snapshot',async()=>{freeze();review(await api('/api/annotations/'+n.id+'/snapshot'),n.evidenceSha256);notice('Reviewing saved evidence; the movie playhead is unchanged.');}],['Edit',async()=>{if(draft||editing)throw Error('Save or cancel the current draft first.');editing=n.id;draft=null;$('capture-comment').disabled=$('comment-displayed').disabled=true;$('note').value=n.text;$('note-kind').value=n.kind;$('note-format').value=n.format==='plain'?'markdown':n.format??'markdown';$('comment-anchor').textContent=movieLabel(n.movie,n.frame);$('comment-image').hidden=!n.imageSha256;if(n.imageSha256)$('comment-image').src='/api/evidence/'+n.imageSha256+'.png';$('comment-editor').hidden=false;$('save-note').disabled=false;$('note').focus();}],['Markdown',()=>download('/api/annotations/'+n.id+'/markdown',`frame-${n.frame}.md`)],['JSON + memory',()=>download('/api/annotations/'+n.id+'/json',`frame-${n.frame}.json`)],...(n.imageSha256?[['PNG',()=>download('/api/evidence/'+n.imageSha256+'.png',`frame-${n.frame}.png`)]]:[]),...(n.movieFile?.status==='verified'?[['Annotated FM2 copy',()=>download('/api/annotations/'+n.id+'/fm2','movie-with-rea-comments.fm2')]]:[])]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>Promise.resolve().then(action).catch(e=>notice(e.message,true));row.append(b);}
   const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');body.className='comment-body';summary.textContent=`Read ${n.format??'plain'} comment`;details.append(summary,body);let rendered=false;details.ontoggle=()=>{if(details.open&&!rendered){rendered=true;renderComment(body,n.text,n.format??'plain').catch(e=>{body.textContent=e.message;});}};
   const excerpt=document.createElement('p');excerpt.textContent=n.text.slice(0,180);card.append(excerpt,row,details);$('notes').append(card);
  }
 }
 $('comment-scope').onchange=renderNotes;
 return {updatePlayback,playing:()=>playback&&!playback.paused,isMovie:()=>['playback','tas-editor'].includes(mode()),setNotes:list=>{notes=list;renderNotes();}};
}
