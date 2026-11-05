// SPDX-License-Identifier: GPL-2.0-or-later
export const sizes = {screen:61440,emphasis:61440,background:61440,sprites:61440,lineMasks:240,rgbPalette:1536,ram:2048,chr:8192,nametables:4096,oam:256,palette:32};
export function decodePacket(bytes) {
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<4) throw Error('Short packet');
 const n=v.getUint32(0,true); if(n>512000 || 4+n>bytes.length) throw Error('Bad header length');
 const meta=JSON.parse(new TextDecoder().decode(bytes.subarray(4,4+n))), buffers={}; let at=4+n;
 if(meta.kind==='snapshot') {
  if(meta.version!==1 || !Array.isArray(meta.buffers) || meta.buffers.length>Object.keys(sizes).length+1) throw Error('Unknown schema');
  for(const [name,len] of meta.buffers) {
   const expected=name==='spriteRows'?19440:sizes[name];
   if(expected!==len || buffers[name] || at+len>bytes.length) throw Error('Invalid buffer');
   buffers[name]=bytes.subarray(at,at+len); at+=len;
  }
  if(Object.keys(sizes).some(name=>!buffers[name])) throw Error('Missing capture buffer');
 }
 if(at!==bytes.length) throw Error('Trailing bytes');
 return {meta,buffers,bytes};
}
export function pattern(s,address,x,y) {
 const c=s.buffers.chr, bit=7-x; return ((c[address+y]>>bit)&1)|(((c[address+y+8]>>bit)&1)<<1);
}
export function sprite(s,index) {
 const o=s.buffers.oam,a=index*4,attr=o[a+2],ctrl=s.meta.ppu.ctrl;
 return {index,oamAddress:a,x:o[a+3],y:o[a]+1,tile:o[a+1],height:(ctrl&32)?16:8,palette:attr&3,behindBackground:!!(attr&32),flipX:!!(attr&64),flipY:!!(attr&128),source:'end-of-frame OAM reconstruction; hardware bounds, not gameplay hitboxes'};
}
export function spritePixel(s,entry,x,y) {
 let dx=x-entry.x,dy=y-entry.y; if(dx<0||dx>=8||dy<0||dy>=entry.height) return null;
 if(entry.flipX) dx=7-dx; if(entry.flipY) dy=entry.height-1-dy;
 const address=entry.height===16?((entry.tile&1)*4096+(entry.tile&254)*16+(dy>>3)*16):((s.meta.ppu.ctrl&8)?4096:0)+entry.tile*16;
 const value=pattern(s,address,dx,dy&7);
 return {sprite:entry.index,chrAddress:address+(dy&7),plane1Address:address+(dy&7)+8,patternValue:value,paletteAddress:16+entry.palette*4+value,transparent:value===0};
}
export function nametablePixel(s,x,y) {
 const table=(x>>8)+2*Math.floor(y/240),tx=(x&255)>>3,ty=Math.floor((y%240)/8),nt=table*1024+ty*32+tx;
 const tile=s.buffers.nametables[nt],attributeAddress=table*1024+960+(ty>>2)*8+(tx>>2);
 const attr=s.buffers.nametables[attributeAddress],shift=((ty&2)<<1)|(tx&2),palette=(attr>>shift)&3;
 const chrAddress=((s.meta.ppu.ctrl&16)?4096:0)+tile*16;
 const value=pattern(s,chrAddress,x&7,y%8);
 return {source:'end-of-frame mapped-memory reconstruction',nametable:table,nametableAddress:0x2000+nt,attributeAddress:0x2000+attributeAddress,tile,chrAddress:chrAddress+y%8,plane1Address:chrAddress+y%8+8,palette,patternValue:value,paletteAddress:value?palette*4+value:0};
}
function rgb(s,color,emph=0) { const p=s.buffers.rgbPalette,at=((emph&7)*64+(color&63))*3; return [p[at],p[at+1],p[at+2],255]; }
export const views={composite:[256,240],background:[256,240],sprites:[256,240],nametables:[512,480],patterns:[256,128],palettes:[256,32]};
export function inspectPixel(s,view,x,y) {
 const size=views[view]; if(!size || !Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=size[0]||y>=size[1]) throw Error('Pixel outside view');
 const i=y*256+x,b=s.buffers,m=s.meta; let result={snapshot:m.id,frame:m.frame,view,x,y};
 if(view==='composite') return {...result,source:'captured emulator raster',available:m.screenValid,rgb:rgb(s,b.screen[i],b.emphasis[i]).slice(0,3),provenance:'Per-pixel OAM/tile identity was not recorded; inspect diagnostic views for candidates.'};
 if(view==='background'||view==='sprites') {
  const v=b[view][i],mask=b.lineMasks[y],color=v&((mask&1)?48:63);
  return {...result,source:'captured old-PPU scanline before sprite composition',available:m.rasterValid,rgb:rgb(s,color,mask>>5).slice(0,3),opaque:view==='background'?!(v&64):!!(v&128)};
 }
 if(view==='nametables') return {...result,...nametablePixel(s,x,y)};
 if(view==='patterns') { const tile=(y>>3)*32+(x>>3),address=tile*16+(y&7); return {...result,source:'end-of-frame mapped CHR',tile,chrAddress:address,plane1Address:address+8,patternValue:pattern(s,tile*16,x&7,y&7)}; }
 return {...result,paletteAddress:(y>>4)*16+(x>>4),colorIndex:b.palette[(y>>4)*16+(x>>4)]&63,source:'end-of-frame palette'};
}
export function render(s,view,reuse) {
 const [width,height]=views[view],rgba=reuse?.length===width*height*4?reuse:new Uint8ClampedArray(width*height*4),b=s.buffers,m=s.meta;
 for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
  let color=0,emph=0,alpha=255,i=y*256+x;
  if(view==='composite') { color=b.screen[i]; emph=b.emphasis[i]; if(!m.screenValid) alpha=0; }
  else if(view==='background'||view==='sprites') { const mask=b.lineMasks[y],v=b[view][i]; color=v&((mask&1)?48:63); emph=mask>>5; if(!m.rasterValid || (view==='sprites'&&!(v&128))) alpha=0; }
  else if(view==='nametables') {
   const table=(x>>8)+2*Math.floor(y/240),tx=(x&255)>>3,ty=Math.floor((y%240)/8),nt=table*1024;
   const tile=b.nametables[nt+ty*32+tx],attr=b.nametables[nt+960+(ty>>2)*8+(tx>>2)],pal=(attr>>(((ty&2)<<1)|(tx&2)))&3;
   const value=pattern(s,((m.ppu.ctrl&16)?4096:0)+tile*16,x&7,y%8); color=b.palette[value?pal*4+value:0];
  }
  else if(view==='patterns') { const tile=(y>>3)*32+(x>>3),v=pattern(s,tile*16,x&7,y&7); color=b.palette[v]; }
  else color=b.palette[(y>>4)*16+(x>>4)];
  const at=((emph&7)*64+(color&63))*3,out=(y*width+x)*4;
  rgba[out]=b.rgbPalette[at];rgba[out+1]=b.rgbPalette[at+1];rgba[out+2]=b.rgbPalette[at+2];rgba[out+3]=alpha;
 }
 return {width,height,rgba};
}
