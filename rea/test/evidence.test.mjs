import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {renderPNG,validateComment,fm2Header,fm2InputDigest,annotateFM2,sha256} from '../evidence.mjs';
import {annotationStore} from '../annotations.mjs';
import {sizes} from '../public/inspection.mjs';
function fixture(){const buffers=Object.fromEntries(Object.entries(sizes).map(([k,n])=>[k,Buffer.alloc(n)]));buffers.rgbPalette[3]=201;buffers.screen[0]=1;return {meta:{id:'snapshot-a',frame:93,screenValid:true,romMd5:'1'.repeat(32),playback:{paused:true,speedPercent:100,movie:{mode:'inactive'}}},buffers};}
function movie(){return Buffer.from('version 3\nromChecksum base64:'+Buffer.alloc(16,17).toString('base64')+'\nguid 00112233-4455-6677-8899-aabbccddeeff\nrerecordCount 2\nport0 1\nport1 1\nport2 0\nfourscore 0\n|0|R.......|........||\n|0|........|.......A||\n');}
test('PNG is a lossless render of captured indexed colors',()=>{const png=renderPNG(fixture());assert.equal(png.subarray(1,4).toString(),'PNG');let at=8,parts=[];while(at<png.length){const n=png.readUInt32BE(at),type=png.subarray(at+4,at+8).toString();if(type==='IDAT')parts.push(png.subarray(at+8,at+8+n));at+=n+12;}const pixels=inflateSync(Buffer.concat(parts));assert.equal(pixels[1],201);assert.equal(pixels.length,240*769);const s=fixture();s.meta.screenValid=false;assert.throws(()=>renderPNG(s));});
test('comment validation, fenced exports and FM2 markers preserve all input bytes',()=>{
 assert.throws(()=>validateComment({kind:'observation',format:'json',text:'{"bad":'}));assert.throws(()=>validateComment({kind:'observation',format:'javascript',text:'alert(1)'}));
 const bytes=movie(),h=fm2Header(bytes),inputs=fm2InputDigest(bytes);assert.equal(inputs.md5,createHash('md5').update(Buffer.from([0,128,0,0,0,0,0,1,0,0])).digest('hex'));
 const result=annotateFM2(bytes,[{id:'a',frame:93,text:'Line 1\n```mermaid\nA-->B\n```',format:'markdown',evidenceSha256:'a'.repeat(64)}]);assert.deepEqual(result.subarray(fm2Header(result).boundary),bytes.subarray(h.boundary));assert.equal(fm2InputDigest(result).md5,inputs.md5);assert.match(result.toString(),/comment REA .*"frame":93/);
 const binary=Buffer.concat([bytes.subarray(0,h.boundary),Buffer.from('binary 1\n|'),Buffer.from([0,128,0,0,0,1])]);assert.equal(fm2InputDigest(binary).md5,inputs.md5);
});
test('durable comments retain original frame, serialize writes, detect tampering and export verified copies',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'rea-comments-')),store=annotationStore(directory),s=fixture(),bytes=movie(),filename=path.join(directory,'movie.fm2');
 try{
  await writeFile(filename,bytes);const header=fm2Header(bytes),inputs=fm2InputDigest(bytes);s.meta.playback.movie={mode:'playback',path:filename,name:'movie.fm2',guid:header.guid,frame:2,inputFrame:1,length:2,rerecordCount:2,readOnly:true,inputMd5:inputs.md5};
  s.meta.frame=2;const capture=await store.capture(s);assert.equal(capture.movieFile.status,'verified');assert.equal(sha256(await store.image(capture.imageSha256)),capture.imageSha256);
  const bodies=[{kind:'observation',format:'markdown',text:'## Hit\n\n```json\n{"x":128}\n```'},{kind:'hypothesis',format:'mermaid',text:'flowchart LR\nA-->B'}];
  const notes=await Promise.all(bodies.map(body=>store.save({...body,evidenceSha256:capture.evidenceSha256,snapshot:s.meta.id})));assert.equal((await store.list()).length,2);
  s.meta.frame=999;assert.equal((await store.evidence(capture.evidenceSha256)).frame,2);assert.match(store.markdown(notes[1]),/```mermaid/);
  const edited=await store.edit(notes[0].id,{kind:'observation',format:'json',revision:1,text:'{"answer":42}'});assert.equal(edited.evidenceSha256,capture.evidenceSha256);assert.equal(edited.frame,2);
  const reopened=annotationStore(directory);assert.equal((await reopened.list()).length,2);assert.equal((await reopened.evidence(capture.evidenceSha256)).frame,2);
  const exported=await store.exportMovie(notes[0].id);assert.equal(fm2InputDigest(exported).md5,inputs.md5);assert.deepEqual(await readFile(filename),bytes);
  await writeFile(filename,Buffer.concat([bytes,Buffer.from('\n')]));assert.equal(fm2InputDigest(await reopened.exportMovie(notes[0].id)).md5,inputs.md5,'Archived movie survives an original path change and inspector restart');
  await assert.rejects(store.edit(notes[0].id,{kind:'observation',format:'markdown',text:'stale tab',revision:1}),e=>e.status===409&&e.current.revision===2);
  const bundle=await reopened.bundle(notes[0].id);assert.equal(bundle.readUInt32LE(0),0x04034b50);await writeFile(path.join('rea/test-output','evidence-bundle.zip'),bundle);
  await writeFile(path.join(directory,capture.evidenceSha256+'.json'),'tampered');await assert.rejects(store.evidence(capture.evidenceSha256),/SHA-256/);
 }finally{assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('rea-comments-'));await rm(directory,{recursive:true,force:true});}
});
