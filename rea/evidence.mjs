// SPDX-License-Identifier: GPL-2.0-or-later
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const jsonSnapshot=s=>({...s.meta,buffers:Object.fromEntries(Object.entries(s.buffers).map(([k,v])=>[k,Buffer.from(v).toString('hex')]))});
export function fromJSON(s){const {buffers,...meta}=s;return {meta,buffers:Object.fromEntries(Object.entries(buffers).map(([k,v])=>[k,Buffer.from(v,'hex')]))};}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),head=Buffer.alloc(4),crc=Buffer.alloc(4);head.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([head,t,data,crc]);}
export function renderPNG(s){
 if(!s.meta.screenValid)throw Error('Advance a frame before capturing rendered evidence.');
 const b=s.buffers,raw=Buffer.alloc(240*769),header=Buffer.alloc(13);header.writeUInt32BE(256);header.writeUInt32BE(240,4);header[8]=8;header[9]=2;
 for(let y=0;y<240;y++)for(let x=0;x<256;x++){const i=y*256+x,at=((b.emphasis[i]&7)*64+(b.screen[i]&63))*3,out=y*769+1+x*3;raw[out]=b.rgbPalette[at];raw[out+1]=b.rgbPalette[at+1];raw[out+2]=b.rgbPalette[at+2];}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export function validateComment(body){
 if(!['plain','markdown','json','mermaid'].includes(body.format??'plain')||typeof body.text!=='string'||!body.text.trim()||body.text.length>16000)throw Error('Comment needs 1–16000 characters and a supported format.');
 if(!['observation','hypothesis'].includes(body.kind))throw Error('Choose observation or hypothesis.');
 if(body.format==='json')JSON.parse(body.text);
 if(body.format==='mermaid'&&body.text.length>8000)throw Error('Mermaid diagrams are limited to 8000 characters.');
 return {kind:body.kind,format:body.format??'plain',text:body.text};
}
export function fm2Header(bytes){
 if(bytes.length>16*1024*1024)throw Error('FM2 files are limited to 16 MiB.');
 const boundary=bytes.indexOf(Buffer.from('\n|'));if(boundary<0||boundary>256*1024)throw Error('Expected an FM2 header followed by input records.');
 const text=bytes.subarray(0,boundary+1).toString('utf8').replace(/^\uFEFF/,'');
 if(!/^version 3\r?\n/.test(text))throw Error('Only FM2 version 3 is supported.');
 const field=name=>text.match(new RegExp('^'+name+' ([^\\r\\n]*)','m'))?.[1]??'';
 const checksum=field('romChecksum');let romMd5='';if(/^base64:/i.test(checksum))romMd5=Buffer.from(checksum.slice(7),'base64').toString('hex');else if(/^0x[0-9a-f]{32}$/i.test(checksum))romMd5=checksum.slice(2).toLowerCase();
 if(!/^[a-f0-9]{32}$/.test(romMd5))throw Error('FM2 must include a valid ROM checksum.');
 const guid=field('guid').toLowerCase();if(guid&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(guid))throw Error('Invalid movie GUID.');
 return {boundary:boundary+1,guid,romMd5,rerecordCount:Number(field('rerecordCount')||0),ports:[Number(field('port0')),Number(field('port1')),Number(field('port2'))],fourscore:field('fourscore')==='1',binary:field('binary')==='1'};
}
export function fm2InputDigest(bytes,h=fm2Header(bytes)){
 if(h.ports[2]!==0||h.ports.slice(0,2).some(n=>n!==0&&n!==1))throw Error('Verified FM2 export currently supports standard gamepad movies.');
 const digest=createHash('md5'),row=Buffer.alloc(5);let frames=0;
 if(h.binary){let at=h.boundary+1;const count=h.fourscore?4:h.ports.slice(0,2).filter(n=>n===1).length,width=count+1;if((bytes.length-at)%width)throw Error('Invalid binary input record length.');while(at<bytes.length){row.fill(0);row[0]=bytes[at++];for(let k=0;k<4;k++)if(h.fourscore||(k<2&&h.ports[k]===1))row[k+1]=bytes[at++];digest.update(row);frames++;}}
 else for(const line of bytes.subarray(h.boundary).toString('utf8').split(/\r?\n/)){if(!line)continue;const p=line.split('|'),command=Number(p[1]);if(p[0]!==''||!Number.isInteger(command)||command<0||command>255)throw Error('Invalid FM2 input record.');row.fill(0);row[0]=command;for(let k=0;k<4;k++)if(h.fourscore||(k<2&&h.ports[k]===1)){if(!p[k+2]||p[k+2].length!==8)throw Error('Invalid gamepad input field.');for(let bit=0;bit<8;bit++)if(p[k+2][bit]!=='.'&&p[k+2][bit]!==' ')row[k+1]|=1<<(7-bit);}digest.update(row);frames++;}
 return {md5:digest.digest('hex'),frames};
}
export function annotateFM2(bytes,notes){
 const h=fm2Header(bytes),markers=notes.map(n=>'comment REA '+JSON.stringify({version:1,id:n.id,frame:n.frame,inputFrame:n.movie?.inputFrame??-1,format:n.format??'plain',text:n.text,evidenceSha256:n.evidenceSha256,imageSha256:n.imageSha256,catalogAttachmentSha256:n.catalogAttachmentSha256})+'\n').join('');
 if(h.boundary+Buffer.byteLength(markers)>256*1024)throw Error('Annotated FM2 header exceeds 256 KiB; export comments separately as Markdown or JSON.');
 return Buffer.concat([bytes.subarray(0,h.boundary),Buffer.from(markers),bytes.subarray(h.boundary)]);
}
export function commentMarkdown(note){
 const item=note.catalogAttachment;
 const observation=item
  ? `Catalog entry: ${item.entryId} · revision ${item.entryRevision} · catalog revision ${item.catalogRevision}  \nEvidence class: ${item.confidence}  \nBounds: (${item.match.x}, ${item.match.y}) ${item.match.width}×${item.match.height}  \nCatalog attachment SHA-256: ${note.catalogAttachmentSha256}\n\n`
  : '';
 return `# Frame ${note.frame} — ${note.movie?.name||'NES inspection'}\n\nMovie GUID: ${note.movie?.guid||'none'}  \nRerecord revision: ${note.movie?.rerecordCount??'none'}  \nLast consumed FM2 input index: ${note.movie?.inputFrame??-1}  \nSnapshot: ${note.snapshot}  \nEvidence SHA-256: ${note.evidenceSha256}\n\n`+observation+(note.format==='json'||note.format==='mermaid'?`\`\`\`${note.format}\n${note.text}\n\`\`\`\n`:note.text+'\n');}
