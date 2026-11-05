// SPDX-License-Identifier: GPL-2.0-or-later
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {evidenceBundle} from './bundle.mjs';
import {sha256,jsonSnapshot,renderPNG,validateComment,fm2Header,fm2InputDigest,annotateFM2,commentMarkdown} from './evidence.mjs';
const hash=value=>{if(typeof value!=='string'||!/^([a-f0-9]{64})$/.test(value))throw Error('Invalid evidence hash');return value;};
export function annotationStore(directory){
 let writes=Promise.resolve();const file=path.join(directory,'annotations.json');
 const list=async()=>{try{return JSON.parse(await readFile(file,'utf8')).map(n=>({...n,revision:n.revision??1}));}catch(e){if(e.code==='ENOENT')return [];throw e;}};
 const blob=async(name,bytes)=>{await mkdir(directory,{recursive:true});await writeFile(path.join(directory,name),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});};
 async function evidence(digest){const raw=await readFile(path.join(directory,hash(digest)+'.json'));if(sha256(raw)!==digest)throw Error('Stored evidence failed its SHA-256 check');return JSON.parse(raw);}
 async function info(digest){return JSON.parse(await readFile(path.join(directory,hash(digest)+'.capture.json'),'utf8'));}
 async function attach(anchor,observation){
  if(anchor.snapshot!==observation.captureId)throw Error('Catalog observation belongs to another capture.');
  const catalogAttachment={...observation,evidenceSha256:anchor.evidenceSha256};
  const raw=JSON.stringify(catalogAttachment),catalogAttachmentSha256=sha256(raw);
  await blob(catalogAttachmentSha256+'.catalog-attachment.json',raw);
  return {...anchor,catalogAttachment,catalogAttachmentSha256};
 }
 async function readMovie(movie){if(!movie?.path||!path.isAbsolute(movie.path)||!/\.fm2$/i.test(movie.path))throw Error('No standalone FM2 file is attached to this capture.');const s=await stat(movie.path);if(!s.isFile()||s.size>16*1024*1024)throw Error('Movie must be a regular FM2 file up to 16 MiB.');return readFile(movie.path);}
 async function capture(s){
  const png=renderPNG(s),raw=JSON.stringify(jsonSnapshot(s)),evidenceSha256=sha256(raw),imageSha256=sha256(png),movie=s.meta.playback?.movie??null;
  let movieFile={status:'not-attached'};
  if(movie?.mode==='playback'||movie?.mode==='finished')try{
   const bytes=await readMovie(movie),header=fm2Header(bytes),inputs=fm2InputDigest(bytes,header);
   if(header.romMd5!==s.meta.romMd5||header.guid!==(movie.guid??'').toLowerCase()||inputs.md5!==movie.inputMd5||inputs.frames!==movie.length||movie.frame>movie.length||header.rerecordCount!==movie.rerecordCount)throw Error('Capture current frame to bind the in-memory movie input revision.');
   const digest=sha256(bytes);await blob(digest+'.fm2',bytes);
   movieFile={status:'verified',sha256:digest,inputMd5:inputs.md5,archived:true};
  }catch(e){movieFile={status:'unverified',reason:e.message};}
  else if(movie?.mode==='recording'||movie?.mode==='tas-editor')movieFile={status:'unsaved-or-editable',reason:'Comments retain the in-memory movie frame/revision; FM2 copy export requires read-only playback of a saved movie.'};
  const result={snapshot:s.meta.id,frame:s.meta.frame,romMd5:s.meta.romMd5,movie,movieFile,evidenceSha256,imageSha256,createdAt:new Date().toISOString(),imageUrl:`/api/evidence/${imageSha256}.png`};
  await blob(evidenceSha256+'.json',raw);await blob(imageSha256+'.png',png);await blob(evidenceSha256+'.capture.json',JSON.stringify(result));return result;
 }
 function mutate(fn){const next=writes.then(async()=>{const notes=await list(),result=await fn(notes);await mkdir(directory,{recursive:true});const temp=file+'.'+randomBytes(6).toString('hex')+'.tmp';await writeFile(temp,JSON.stringify(notes,null,2));await rename(temp,file);return result;});writes=next.catch(()=>{});return next;}
 async function save(body,s){
  const content=validateComment(body);
  let anchor;
  if(body.evidenceSha256){anchor=await info(body.evidenceSha256);const stored=await evidence(body.evidenceSha256);if(body.snapshot&&body.snapshot!==stored.id)throw Error('Comment does not match the captured frame.');}
  else if(s?.meta.screenValid)anchor=await capture(s);
  else {const raw=JSON.stringify(jsonSnapshot(s)),evidenceSha256=sha256(raw);await blob(evidenceSha256+'.json',raw);anchor={snapshot:s.meta.id,romMd5:s.meta.romMd5,frame:s.meta.frame,movie:s.meta.playback?.movie??null,evidenceSha256};}
  if(body.catalogAttachmentSha256){
   const catalogAttachmentSha256=hash(body.catalogAttachmentSha256);
   const raw=await readFile(path.join(directory,catalogAttachmentSha256+'.catalog-attachment.json'));
   if(sha256(raw)!==catalogAttachmentSha256)throw Error('Catalog attachment failed its SHA-256 check.');
   const catalogAttachment=JSON.parse(raw);
   if(catalogAttachment.captureId!==anchor.snapshot||catalogAttachment.evidenceSha256!==anchor.evidenceSha256){
    throw Error('Catalog attachment belongs to a different capture.');
   }
   anchor={...anchor,catalogAttachment,catalogAttachmentSha256};
  }
  return mutate(notes=>{if(notes.length>=256)throw Error('Comment limit reached; archive this session first');const note={id:randomBytes(8).toString('hex'),...anchor,...content,revision:1,createdAt:new Date().toISOString()};notes.push(note);return note;});
 }
 function verifiedCatalog(note){
  const attachment=note.catalogAttachment;
  if(!note.catalogAttachmentSha256&&!attachment)return null;
  const digest=hash(note.catalogAttachmentSha256);
  if(!attachment?.definition||sha256(JSON.stringify(attachment))!==digest||
     attachment.captureId!==note.snapshot||attachment.evidenceSha256!==note.evidenceSha256||
     sha256(JSON.stringify(attachment.definition))!==attachment.definitionSha256){
   throw Error('Saved catalog attachment failed its SHA-256 check.');
  }
  return attachment;
 }
 const find=async id=>{if(!/^[a-f0-9]{16}$/.test(id))throw Error('Invalid comment ID');const n=(await list()).find(n=>n.id===id);if(!n){const e=Error('Comment not found');e.status=404;throw e;}verifiedCatalog(n);return n;};
 async function edit(id,body){const content=validateComment(body);return mutate(notes=>{const i=notes.findIndex(n=>n.id===id);if(i<0)throw Error('Comment not found');if(!Number.isInteger(body.revision)||body.revision!==notes[i].revision){const e=Error('Comment changed in another tab. Your draft is retained; load the latest revision or save your text as a separate comment.');e.status=409;e.current=notes[i];throw e;}notes[i]={...notes[i],...content,revision:notes[i].revision+1,updatedAt:new Date().toISOString()};return notes[i];});}
 async function archivedMovie(note){
  const anchor=await info(note.evidenceSha256);if(anchor.movieFile?.status!=='verified')throw Error(anchor.movieFile?.reason??'No verified movie file for this comment');
  const digest=hash(anchor.movieFile.sha256);let bytes;
  try{bytes=await readFile(path.join(directory,digest+'.fm2'));}catch(e){if(e.code!=='ENOENT')throw e;bytes=await readMovie(note.movie);}
  if(sha256(bytes)!==digest)throw Error('Movie bytes do not match the captured SHA-256.');return bytes;
 }
 const sameMovie=(n,note)=>n.romMd5===note.romMd5&&n.movie?.inputMd5===note.movie?.inputMd5&&(n.movie?.guid??'').toLowerCase()===(note.movie?.guid??'').toLowerCase()&&n.movie?.rerecordCount===note.movie?.rerecordCount&&n.movie?.length===note.movie?.length;
 async function exportMovie(id){
  const note=await find(id),bytes=await archivedMovie(note),notes=(await list()).filter(n=>sameMovie(n,note));
  for(const item of notes)verifiedCatalog(item);
  return annotateFM2(bytes,notes);
 }
 async function image(digest){const bytes=await readFile(path.join(directory,hash(digest)+'.png'));if(sha256(bytes)!==digest)throw Error('Image checksum mismatch');return bytes;}
 async function bundle(id){
  const note=await find(id),selected=note.movieFile?.status==='verified'?(await list()).filter(n=>sameMovie(n,note)):[note],entries=[],seen=new Set();let bytes=0;
  const add=(...items)=>{for(const item of items){bytes+=Buffer.byteLength(item[1]);if(bytes>64*1024*1024)throw Error('Investigation exceeds 64 MiB. Export individual comments instead.');entries.push(item);}};
  for(const n of selected){add([`comments/${n.id}.json`,JSON.stringify(n,null,2)],[`comments/${n.id}.md`,commentMarkdown(n)]);if(!seen.has(n.evidenceSha256)){seen.add(n.evidenceSha256);await evidence(n.evidenceSha256);add([`evidence/${n.evidenceSha256}.json`,await readFile(path.join(directory,hash(n.evidenceSha256)+'.json'))]);}if(n.imageSha256&&!seen.has(n.imageSha256)){seen.add(n.imageSha256);add([`evidence/${n.imageSha256}.png`,await image(n.imageSha256)]);}}
  for(const n of selected){
   const digest=n.catalogAttachmentSha256;
   if(!digest||seen.has(digest))continue;
   const raw=JSON.stringify(verifiedCatalog(n));
   seen.add(digest);
   add(['catalog/'+digest+'.json',raw]);
  }
  if(note.movieFile?.status==='verified')add(['movie/original.fm2',await archivedMovie(note)],['movie/annotated.fm2',await exportMovie(id)]);
  add(['README.md','# REA investigation evidence\n\nVerify each file against manifest.json SHA-256. Original and annotated FM2 inputs are identical; notes identify completed frame N and consumed input N-1. Evidence is copied inspection memory, not a restorable savestate. No ROM is included.\n']);
  return evidenceBundle(entries,{romMd5:note.romMd5,movie:note.movie?{guid:note.movie.guid,inputMd5:note.movie.inputMd5,rerecordCount:note.movie.rerecordCount}:null});
 }
 return {list,capture,attach,save,edit,find,evidence,info,exportMovie,bundle,markdown:commentMarkdown,image};
}
