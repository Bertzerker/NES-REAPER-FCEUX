// SPDX-License-Identifier: GPL-2.0-or-later
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {decodePacket,sizes,views,inspectPixel,sprite,spritePixel} from './public/inspection.mjs';
import {validateHelper,evaluateHelper} from './public/helpers.mjs';
import {annotationStore} from './annotations.mjs';
import {catalogLimit, catalogStore} from './catalog-store.mjs';
import {sha256,fm2Header,fm2InputDigest,fromJSON} from './evidence.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export async function startInspector({port=8775,nativePort=port+1,token=randomBytes(32).toString('hex'),dataDir=path.join(here,'session'),helperDir=path.join(here,'helpers'),commandTimeout=90000}={}) {
 const notes=annotationStore(dataDir);
 const catalogs=catalogStore(dataDir);
 let lastPlayback=null,lastStatusAt=0,statusPending=null,stateUnknown=false,lastCaptureAt=0,connectionEpoch=0;
 const helpers=new Map();
 for(const directory of [helperDir,path.join(dataDir,'helpers')]){let names=[];try{names=await readdir(directory);}catch(e){if(e.code!=='ENOENT')throw e;}if(names.length>128)throw Error('Too many helper profiles');for(const name of names.filter(n=>/^[-a-z0-9]+\.json$/.test(n))){const raw=await readFile(path.join(directory,name),'utf8');if(raw.length>60000)throw Error('Helper too large');const p=validateHelper(JSON.parse(raw));helpers.set(p.id,p);}}
 const history=new Map(),pinned=new Map(),waiting=new Set(),pending=new Map();
 let latest=null,producer=null,nextRequest=1,closed=false,captures=0,invalidPackets=0,lastProtocolError='',lastDemand=0,receivedBytes=0,demandRequests=0;
 const origin=`http://127.0.0.1:${port}`, allowedHost=`127.0.0.1:${port}`;
 const trim=(map,n)=>{while(map.size>n) map.delete(map.keys().next().value);};
 const remember=s=>{latest=s;lastCaptureAt=Date.now();lastPlayback=s.meta.playback??lastPlayback;history.set(s.meta.id,s);trim(history,16);captures++; for(const wake of waiting) wake(); waiting.clear();};
 const demand=()=>{const now=Date.now();if(producer && now-lastDemand>=500 && !pending.size){producer.write('0 capture\n');lastDemand=now;demandRequests++;}};
 const native=net.createServer(socket=>{
  let authenticated=false,buffer=Buffer.alloc(0);
  socket.setNoDelay(true); socket.setTimeout(5000,()=>{if(!authenticated) socket.destroy();});
  socket.on('data',chunk=>{
   receivedBytes+=chunk.length;
   buffer=Buffer.concat([buffer,chunk]);
   try {
    while(buffer.length>=4) {
     const n=buffer.readUInt32LE(0); if(n<4||n>1500000) throw Error('Invalid native length');
     if(buffer.length<n+4) break;
     const packet=buffer.subarray(4,n+4);buffer=buffer.subarray(n+4);
     const s=decodePacket(packet),m=s.meta;
     if(!authenticated) {
      if(m.kind!=='hello'||m.token!==token||producer) throw Error('Producer authentication failed');
      authenticated=true;producer=socket;connectionEpoch++;latest=null;lastPlayback=null;lastStatusAt=0;socket.setTimeout(0);continue;
     }
     if(m.kind==='snapshot') remember(s);
     else if(m.kind==='reply') { const p=pending.get(m.request);if(p){pending.delete(m.request);p.resolve(m);} }
     else throw Error('Unknown native message');
    }
   } catch(e) { invalidPackets++;lastProtocolError=e.message;socket.destroy(); }
  });
  socket.on('error',()=>{});
  socket.on('close',()=>{if(producer===socket){producer=null;if(pending.size)stateUnknown=true;for(const p of pending.values())p.reject(Error('Emulator disconnected; command outcome unknown'));pending.clear();}});
 });
 const number=(v,def,min,max)=>{const n=v===null||v===undefined?def:Number(v);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(`Expected integer ${min}..${max}`);return n;};
 function snapshot(id=latest?.meta.id,pin=false) {
  const s=pinned.get(id)||history.get(id);if(!s){const e=Error('Snapshot missing or expired');e.status=404;throw e;}
  if(pin){pinned.set(id,s);trim(pinned,16);}return s;
 }
 async function catalogCapture(body) {
  if (typeof body.snapshot !== 'string' || !body.snapshot) throw Error('Select an exact capture.');
  const selected = body.evidenceSha256 ? fromJSON(await notes.evidence(body.evidenceSha256)) : snapshot(body.snapshot,true);
  if (selected.meta.id !== body.snapshot) throw Error('Selected capture does not match the archived evidence.');
  return selected;
 }
 const jsonSnapshot=s=>({...s.meta,buffers:Object.fromEntries(Object.entries(s.buffers).map(([k,v])=>[k,Buffer.from(v).toString('hex')]))});
 function command(op,a=0,b=0,c=0) {
  const rejected=message=>Object.assign(Error(message),{status:409});
  if(!producer) return Promise.reject(rejected('Emulator is disconnected'));
  if(stateUnknown&&!['status','pause','bookmark'].includes(op))return Promise.reject(rejected('Previous command outcome unknown. Recheck machine state or Pause before dispatching another command.'));
  const active=[...pending.values()].filter(p=>p.op!=='status');
  if(active.length && ((!['pause','bookmark'].includes(op))||active.length>=2)) return Promise.reject(rejected('Another control command is pending'));
  const request=nextRequest++;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(request);if(op!=='status')stateUnknown=true;reject(Object.assign(Error('Command timed out; execution state is unknown. Recheck machine state before retrying.'),{status:504}));},commandTimeout);
   pending.set(request,{op,request,resolve:r=>{clearTimeout(timer);if(op==='status'||op==='pause')stateUnknown=false;resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});
   producer.write(`${request} ${op} ${a} ${b} ${c}\n`);
  });
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
   if(req.headers.host!==allowedHost || (req.headers.origin && req.headers.origin!==origin)) {res.writeHead(403);res.end('Local origin required');return;}
   const u=new URL(req.url,origin),q=u.searchParams;
   const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
   if(req.method==='POST') {
    if(req.headers['x-rea-token']!==token){send({error:'Control token required'},403);return;}
    let length=0;const chunks=[],limit=u.pathname==='/api/movie'?16*1024*1024:u.pathname==='/api/catalog'?catalogLimit+4096:u.pathname.startsWith('/api/annotations')?65536:u.pathname==='/api/helpers'?60000:16384;
    for await(const chunk of req){length+=chunk.length;if(length>limit)throw Error('Request too large');chunks.push(chunk);}const raw=Buffer.concat(chunks);
    if(u.pathname==='/api/movie'){
     const header=fm2Header(raw);fm2InputDigest(raw,header);if(!latest||header.romMd5!==latest.meta.romMd5)throw Error('Movie ROM checksum does not match the loaded ROM.');
     if(['recording','tas-editor'].includes(lastPlayback?.movie?.mode))throw Error('Finish recording or close TAS Editor before loading another movie.');
     const name=(q.get('name')||'movie.fm2').split(/[/\\]/).pop().replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100);if(!/\.fm2$/i.test(name))throw Error('Choose an FM2 file.');
     const directory=path.resolve(dataDir,'movies',sha256(raw));await mkdir(directory,{recursive:true});const filename=path.join(directory,name);await writeFile(filename,raw);
     const result=await command('movie-open',Buffer.from(filename,'utf8').toString('hex'));if(result.snapshot)snapshot(result.snapshot,true);send(result,result.ok?200:409);return;
    }
    const body=JSON.parse(raw.toString('utf8')||'{}');
    if(u.pathname==='/api/catalog'){
     const selected=['create','append'].includes(body.op) ? await catalogCapture(body) : undefined;
     send(await catalogs.update(body,selected),body.op==='create'?201:200);return;
    }
    if(u.pathname==='/api/annotations/capture'){
     if(body.catalog){
      const selected=await catalogCapture(body);
      const observation=await catalogs.observe(selected,body.catalog);
      const anchor=body.evidenceSha256 ? await notes.info(body.evidenceSha256) : await notes.capture(selected);
      send(await notes.attach(anchor,observation),201);return;
     }
     if(body.evidenceSha256){await notes.evidence(body.evidenceSha256);send(await notes.info(body.evidenceSha256),201);return;}
     let s;if(body.snapshot)s=snapshot(body.snapshot,true);else{const result=await command('bookmark');if(!result.ok)throw Error(result.message);s=snapshot(result.snapshot,true);}
     send(await notes.capture(s),201);return;
    }
    const edit=u.pathname.match(/^\/api\/annotations\/([a-f0-9]{16})$/);if(edit){send(await notes.edit(edit[1],body));return;}
    if(u.pathname==='/api/helpers'){
     const p=validateHelper(body);if(!helpers.has(p.id)&&helpers.size>=128)throw Error('Helper profile limit reached');
     const directory=path.join(dataDir,'helpers');await mkdir(directory,{recursive:true});const filename=path.join(directory,p.id+'.json');await writeFile(filename+'.tmp',JSON.stringify(p,null,2));await rename(filename+'.tmp',filename);helpers.set(p.id,p);send(p,201);return;
    }
    if(u.pathname==='/api/control') {
     const op=body.op;let a=0,b=0,c=0;
     if(op==='step'){a=number(body.frames,1,1,3600);b=number(body.pad0,0,0,255);c=number(body.pad1,0,0,255);}
     else if(op==='movie-step')a=number(body.frames,1,1,3600);
     else if(op==='speed'){a=number(body.percent,100,25,200);if(a%25)throw Error('Speed must be a multiple of 25%, between 25% and 200%.');}
     else if(op==='catalog-observe'){if(typeof body.enabled!=='boolean')throw Error('Expected a sprite observation toggle.');a=Number(body.enabled);}
     else if(op==='save'||op==='load')a=number(body.slot,0,0,15);
     else if(op==='trace')a=number(body.limit,256,1,2048);
     else if(op==='watch'){a=number(body.start,0,0,65535);b=number(body.end,a,a,65535);c=number(body.access,2,0,7);}
     else if(op==='native-tool'){a=['tas-editor','debugger','ppu','nametables','hex'].indexOf(body.tool)+1;if(!a)throw Error('Unknown native tool');}
     else if(!['pause','run','movie-play','movie-restart','movie-stop'].includes(op))throw Error('Unknown control operation');
     const result=await command(op,a,b,c);if(result.snapshot)snapshot(result.snapshot,true);send(result,result.ok?200:409);return;
    }
    if(u.pathname==='/api/annotations') {
     const s=body.evidenceSha256?null:snapshot(body.snapshot,true);send(await notes.save(body,s),201);return;
    }
    send({error:'Unknown endpoint'},404);return;
   }
   if(req.method!=='GET'){res.writeHead(405);res.end();return;}
   if(u.pathname==='/api/catalog'){send(await catalogs.read(q.get('rom')));return;}
   if(u.pathname==='/api/session'){send({token,connected:!!producer,connectionEpoch,latest:latest?.meta.id,lastCaptureAt,stateUnknown,pending:[...pending.values()].filter(p=>p.op!=='status').map(({op,request})=>({op,request})),playback:lastPlayback,capabilities:['snapshot','memory','diff','pixel','oam','pause','step','checkpoint','trace','watch','annotations','helpers','overlays','movie','speed','rich-comments','movie-stop','native-tools','evidence-bundle','comment-revisions','sprite-tile-catalog'],limits:{liveHz:2,step:[1,3600],trace:[1,2048],watch:[0,65535],speeds:[25,50,75,100,125,150,175,200],checkpoints:16,checkpointLifetime:'native session memory',stopGranularity:'completed-frame-boundary'}});return;}
   if(u.pathname==='/api/playback'){
    if(producer&&!pending.size&&Date.now()-lastStatusAt>=1000&&!statusPending){lastStatusAt=Date.now();const captureVersion=captures;statusPending=command('status').then(r=>{if(r.state&&captureVersion===captures)lastPlayback=r.state;}).finally(()=>statusPending=null);}
    if(statusPending)await statusPending;send(lastPlayback??latest?.meta.playback??{paused:true,movie:{mode:'inactive'}});return;
   }
   if(u.pathname==='/api/helpers'){send(q.has('id')?helpers.get(q.get('id'))??null:[...helpers.values()]);return;}
   if(u.pathname==='/api/status'){send({connected:!!producer,captures,invalidPackets,lastProtocolError,latest:latest?.meta.id,history:history.size,pinned:pinned.size,receivedBytes,demandRequests,captureMode:'on-demand',maximumLiveHz:2});return;}
   if(u.pathname==='/api/history'){send([...history.values()].map(s=>({id:s.meta.id,frame:s.meta.frame,cycle:s.meta.cycle})));return;}
   if(u.pathname==='/api/live') {
    demand();
    if(!latest||q.get('after')===latest.meta.id) await new Promise(resolve=>{
     let timer;const wake=()=>{clearTimeout(timer);waiting.delete(wake);resolve();};waiting.add(wake);timer=setTimeout(wake,1000);req.on('close',wake);
    });
    if(!latest||q.get('after')===latest.meta.id){res.writeHead(204);res.end();return;}
    res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end(latest.bytes);return;
   }
   if(u.pathname==='/api/annotations'){send(await notes.list());return;}
   const image=u.pathname.match(/^\/api\/evidence\/([a-f0-9]{64})\.png$/);if(image){const bytes=await notes.image(image[1]);res.writeHead(200,{'Content-Type':'image/png'});res.end(bytes);return;}
   const evidence=u.pathname.match(/^\/api\/evidence\/([a-f0-9]{64})\.json$/);if(evidence){send(await notes.evidence(evidence[1]));return;}
   const item=u.pathname.match(/^\/api\/annotations\/([a-f0-9]{16})\/(snapshot|json|markdown|fm2|bundle|catalog)$/);
   if(item){const note=await notes.find(item[1]);if(item[2]==='snapshot'){send(await notes.evidence(note.evidenceSha256));return;}
    if(item[2]==='catalog'){send(note.catalogAttachment??null);return;}
    if(item[2]==='json'){res.setHeader('Content-Disposition',`attachment; filename="rea-frame-${note.frame}-${note.id}.json"`);send({comment:note,snapshot:await notes.evidence(note.evidenceSha256)});return;}
    if(item[2]==='markdown'){res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="rea-frame-${note.frame}-${note.id}.md"`});res.end(notes.markdown(note));return;}
    if(item[2]==='bundle'){const bytes=await notes.bundle(note.id);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="rea-investigation.zip"'});res.end(bytes);return;}
    const movie=await notes.exportMovie(note.id);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="movie-with-rea-comments.fm2"'});res.end(movie);return;
   }
   if(u.pathname.startsWith('/api/')) {
    const s=snapshot(q.get('snapshot')||undefined,u.pathname==='/api/snapshot');
    if(u.pathname==='/api/overlays'){const profile=q.has('profile')?helpers.get(q.get('profile')):[...helpers.values()].find(p=>p.romMd5.includes(s.meta.romMd5));if(!profile){send({snapshot:s.meta.id,matched:false,shapes:[],objects:[],warnings:['No matching game helper']});return;}send(evaluateHelper(s,profile,q.get('class')||'all'));return;}
    if(u.pathname==='/api/snapshot'){send(jsonSnapshot(s));return;}
    if(u.pathname==='/api/frame'){res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end(s.bytes);return;}
    if(u.pathname==='/api/pixel'){send(inspectPixel(s,q.get('view')||'composite',number(q.get('x'),0,0,511),number(q.get('y'),0,0,479)));return;}
    if(u.pathname==='/api/sprites'){
     const entries=Array.from({length:64},(_,i)=>sprite(s,i));
     if(q.has('x')&&q.has('y')){const x=number(q.get('x'),0,0,255),y=number(q.get('y'),0,0,239);send({snapshot:s.meta.id,source:'end-of-frame diagnostic candidates, not captured pixel ownership',candidates:entries.map(e=>spritePixel(s,e,x,y)).filter(p=>p&&!p.transparent)});}
     else send({snapshot:s.meta.id,entries});return;
    }
    if(u.pathname==='/api/events'){send({snapshot:s.meta.id,columns:['access','address','value','instructionPC','cycle','a','x','y','s','p'],accessBits:{read:1,write:2,execute:4},events:s.meta.events,dropped:s.meta.eventsDropped,stopGranularity:'frame-boundary'});return;}
    if(u.pathname==='/api/memory'||u.pathname==='/api/diff') {
     const space=q.get('space')||'ram';if(!['ram','chr','nametables','oam','palette'].includes(space))throw Error('Unknown memory space');
     const bytes=s.buffers[space],start=number(q.get('start'),0,0,bytes.length-1),length=number(q.get('length'),Math.min(128,bytes.length-start),1,4096);if(start+length>bytes.length)throw Error('Range exceeds memory');
     if(u.pathname==='/api/memory'){send({snapshot:s.meta.id,space,start,length,hex:Buffer.from(bytes.subarray(start,start+length)).toString('hex'),readSemantics:'direct copied storage; no CPU/PPU register reads'});return;}
     const from=snapshot(q.get('from'));if(from.meta.romMd5!==s.meta.romMd5)throw Error('Cannot compare different ROMs');
     if((from.meta.session??from.meta.id.split('-').slice(0,2).join('-'))!==(s.meta.session??s.meta.id.split('-').slice(0,2).join('-')))throw Error('Cannot compare different native sessions');
     send({snapshot:s.meta.id,from:from.meta.id,space,changes:Array.from({length},(_,i)=>i+start).filter(i=>bytes[i]!==from.buffers[space][i]).map(address=>({address,before:from.buffers[space][address],after:bytes[address]}))});return;
    }
    send({error:'Unknown endpoint'},404);return;
   }
   const routes={'/':'index.html','/app.mjs':'app.mjs','/workbench.mjs':'workbench.mjs','/style.css':'style.css','/inspection.mjs':'inspection.mjs','/helpers.mjs':'helpers.mjs','/comments.mjs':'comments.mjs','/catalog.mjs':'catalog.mjs','/catalog-ui.mjs':'catalog-ui.mjs','/vendor/markup.mjs':'vendor/markup.mjs','/vendor/mermaid.mjs':'vendor/mermaid.mjs','/vendor/LICENSES.txt':'vendor/LICENSES.txt'};
   const name=routes[u.pathname];if(!name){res.writeHead(404);res.end();return;}
   const content=await readFile(path.join(here,'public',name));res.writeHead(200,{'Content-Type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.txt')?'text/plain':'text/html'});res.end(content);
  }catch(e){if(!res.headersSent){res.writeHead(e.status||400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message,current:e.current}));}else res.end();}
 });
 server.requestTimeout=100000;
 await new Promise((resolve,reject)=>{native.once('error',reject);native.listen(nativePort,'127.0.0.1',resolve);});
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch(e){native.close();throw e;}
 return {url:origin,token,port,nativePort,command,close:async()=>{if(closed)return;closed=true;for(const wake of waiting)wake();producer?.destroy();server.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>native.close(r))]);}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 if(process.argv[2]&&process.platform==='win32'){
  const count=Number(execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-Process -Name fceux,fceux64 -ErrorAction SilentlyContinue).Count"],{encoding:'utf8',windowsHide:true}).trim());
  if(!Number.isFinite(count)||count!==0)throw Error('FCEUX already running; refusing a second instance.');
 }
 const port=Number(process.env.PORT||8775);if(!Number.isInteger(port)||port<1024||port>65534)throw Error('PORT must be 1024..65534');
 const inspector=await startInspector({port});console.log(`NES REA inspector: ${inspector.url}`);
 let child;
 const rom=process.argv[2];if(rom){child=spawn(path.join(here,'bin','fceux64.exe'),['-bginput','1','-pause','1',path.resolve(rom)],{cwd:path.join(here,'bin'),env:{...process.env,FCEUX_REA_PORT:String(inspector.nativePort),FCEUX_REA_TOKEN:inspector.token},stdio:'ignore',windowsHide:false});child.on('error',e=>{console.error(e.message);shutdown();});child.on('exit',()=>{console.log('FCEUX closed.');shutdown();});}
 let stopping=false;async function shutdown(){if(stopping)return;stopping=true;child?.kill();await inspector.close();}
 process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
