// SPDX-License-Identifier: GPL-2.0-or-later
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {sha256,jsonSnapshot,renderPNG,validateComment,fm2Header,fm2InputDigest,annotateFM2,commentMarkdown} from './evidence.mjs';
const hash=value=>{if(typeof value!=='string'||!/^([a-f0-9]{64})$/.test(value))throw Error('Invalid evidence hash');return value;};
export function annotationStore(directory){
 let writes=Promise.resolve();const file=path.join(directory,'annotations.json');
 const list=async()=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}};
 const blob=async(name,bytes)=>{await mkdir(directory,{recursive:true});await writeFile(path.join(directory,name),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});};
 async function evidence(digest){const raw=await readFile(path.join(directory,hash(digest)+'.json'));if(sha256(raw)!==digest)throw Error('Stored evidence failed its SHA-256 check');return JSON.parse(raw);}
 async function info(digest){return JSON.parse(await readFile(path.join(directory,hash(digest)+'.capture.json'),'utf8'));}
 async function readMovie(movie){if(!movie?.path||!path.isAbsolute(movie.path)||!/\.fm2$/i.test(movie.path))throw Error('No standalone FM2 file is attached to this capture.');const s=await stat(movie.path);if(!s.isFile()||s.size>16*1024*1024)throw Error('Movie must be a regular FM2 file up to 16 MiB.');return readFile(movie.path);}
 async function capture(s){
  const png=renderPNG(s),raw=JSON.stringify(jsonSnapshot(s)),evidenceSha256=sha256(raw),imageSha256=sha256(png),movie=s.meta.playback?.movie??null;
  let movieFile={status:'not-attached'};
  if(movie?.mode==='playback'||movie?.mode==='finished')try{
   const bytes=await readMovie(movie),header=fm2Header(bytes),inputs=fm2InputDigest(bytes,header);
   if(header.romMd5!==s.meta.romMd5||header.guid!==(movie.guid??'').toLowerCase()||inputs.md5!==movie.inputMd5||inputs.frames!==movie.length||movie.frame>movie.length||header.rerecordCount!==movie.rerecordCount)throw Error('Capture current frame to bind the in-memory movie input revision.');
   movieFile={status:'verified',sha256:sha256(bytes),inputMd5:inputs.md5};
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
  return mutate(notes=>{if(notes.length>=256)throw Error('Comment limit reached; archive this session first');const note={id:randomBytes(8).toString('hex'),...anchor,...content,createdAt:new Date().toISOString()};notes.push(note);return note;});
 }
 const find=async id=>{if(!/^[a-f0-9]{16}$/.test(id))throw Error('Invalid comment ID');const n=(await list()).find(n=>n.id===id);if(!n){const e=Error('Comment not found');e.status=404;throw e;}return n;};
 async function edit(id,body){const content=validateComment(body);return mutate(notes=>{const i=notes.findIndex(n=>n.id===id);if(i<0)throw Error('Comment not found');notes[i]={...notes[i],...content,updatedAt:new Date().toISOString()};return notes[i];});}
 async function exportMovie(id){
  const note=await find(id),anchor=await info(note.evidenceSha256);if(anchor.movieFile.status!=='verified')throw Error(anchor.movieFile.reason??'No verified movie file for this comment');
  const bytes=await readMovie(note.movie);if(sha256(bytes)!==anchor.movieFile.sha256)throw Error('The movie file changed since capture; its saved input revision no longer matches.');
  const notes=(await list()).filter(n=>n.romMd5===note.romMd5&&n.movie?.inputMd5===note.movie?.inputMd5&&(n.movie?.guid??'').toLowerCase()===(note.movie?.guid??'').toLowerCase()&&n.movie?.rerecordCount===note.movie?.rerecordCount&&n.movie?.length===note.movie?.length);
  return annotateFM2(bytes,notes);
 }
 return {list,capture,save,edit,find,evidence,info,exportMovie,markdown:commentMarkdown,image:async digest=>{const bytes=await readFile(path.join(directory,hash(digest)+'.png'));if(sha256(bytes)!==digest)throw Error('Image checksum mismatch');return bytes;}};
}
