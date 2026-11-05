// SPDX-License-Identifier: GPL-2.0-or-later
import {sha256} from './evidence.mjs';
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=(c>>>8)^crcTable[(c^b)&255];return(c^0xffffffff)>>>0;}
// Stored ZIP entries need no runtime dependencies. Names and contents are supplied internally.
export function evidenceBundle(entries,metadata={}){
 const files=entries.map(([name,data])=>({name,data:Buffer.isBuffer(data)?data:Buffer.from(data)}));
 if(files.length>1024||files.reduce((n,f)=>n+f.data.length,0)>64*1024*1024)throw Error('Evidence bundle exceeds 64 MiB. Export smaller investigations.');
 const manifest={schema:1,...metadata,files:files.map(f=>({path:f.name,bytes:f.data.length,sha256:sha256(f.data)}))};
 files.push({name:'manifest.json',data:Buffer.from(JSON.stringify(manifest,null,2))});
 const local=[],central=[];let offset=0;
 for(const f of files){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(f.name)||f.name.includes('..'))throw Error('Invalid bundle entry');
  const name=Buffer.from(f.name),crc=crc32(f.data),h=Buffer.alloc(30),d=Buffer.alloc(46);
  h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(f.data.length,18);h.writeUInt32LE(f.data.length,22);h.writeUInt16LE(name.length,26);
  d.writeUInt32LE(0x02014b50);d.writeUInt16LE(20,4);d.writeUInt16LE(20,6);d.writeUInt16LE(0x800,8);d.writeUInt16LE(33,14);d.writeUInt32LE(crc,16);d.writeUInt32LE(f.data.length,20);d.writeUInt32LE(f.data.length,24);d.writeUInt16LE(name.length,28);d.writeUInt32LE(offset,42);
  local.push(h,name,f.data);central.push(d,name);offset+=h.length+name.length+f.data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}
