// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const [packagePath,romPath]=process.argv.slice(2).map(x=>path.resolve(x));
if(!packagePath||!romPath)throw Error('Usage: node package-smoke.mjs EXTRACTED_PACKAGE DIAGNOSTIC_ROM');
const count=()=>Number(execFileSync('powershell.exe',['-NoProfile','-Command','@(Get-Process -Name fceux,fceux64 -ErrorAction SilentlyContinue).Count'],{encoding:'utf8',windowsHide:true}).trim());
assert.equal(count(),0,'Close FCEUX first; this test never launches a second instance');
const manifest=JSON.parse((await readFile(path.join(packagePath,'release-manifest.json'),'utf8')).replace(/^\uFEFF/,''));
const base='http://127.0.0.1:18995',launch=['-NoProfile','-ExecutionPolicy','Bypass','-STA','-File',path.join(packagePath,'Launch-NES-REAPER.ps1'),'-Rom',romPath,'-Port','18995'];
let output='',emulatorPid,token,complete=false;
const child=spawn('powershell.exe',launch,{cwd:packagePath,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
let exited=false;child.on('exit',()=>exited=true);child.on('error',e=>output+=e.message);
const get=async route=>{const r=await fetch(base+route);assert.equal(r.status,200,await r.clone().text());return r.json();};
const control=async body=>{const r=await fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':token},body:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
const snapshot=async result=>get('/api/snapshot?snapshot='+result.snapshot);
try{
 const deadline=Date.now()+30000;let session;
 while(Date.now()<deadline&&!exited){try{session=await get('/api/session');if(session.connected)break;}catch{}await delay(200);}
 assert.ok(session?.connected,output);token=session.token;let s=await snapshot(await control({op:'pause'}));emulatorPid=Number(s.id.split('-')[0]);assert.equal(count(),1);assert.equal(s.paused,true);
 const first=await snapshot(await control({op:'step',frames:90}));assert.equal(Buffer.from(first.buffers.ram,'hex').subarray(32,36).toString(),'REAN');assert.equal(first.screenValid,true);assert.equal(first.rasterValid,true);
 await control({op:'save',slot:0});const a=await snapshot(await control({op:'step',frames:3,pad0:129}));await control({op:'load',slot:0});const b=await snapshot(await control({op:'step',frames:3,pad0:129}));assert.equal(a.buffers.ram,b.buffers.ram);assert.equal(a.buffers.screen,b.buffers.screen);assert.equal(a.cycle,b.cycle);
 assert.ok((await get('/api/helpers')).length);assert.equal((await get('/api/overlays?snapshot='+b.id)).matched,false);
 const before=await get('/api/status');await delay(800);const after=await get('/api/status');assert.equal(after.captures,before.captures,'No automatic captures while no viewer demands them');assert.equal(after.receivedBytes,before.receivedBytes);
 const duplicate=spawn('powershell.exe',launch.map(x=>x==='18995'?'18997':x),{cwd:packagePath,windowsHide:true,stdio:['ignore','pipe','pipe']});let refused='';duplicate.stdout.on('data',b=>refused+=b);duplicate.stderr.on('data',b=>refused+=b);const duplicateCode=await new Promise(r=>duplicate.once('exit',r));assert.equal(duplicateCode,1);assert.match(refused,/FCEUX is already running/);assert.equal(count(),1);
 complete=true;console.log(JSON.stringify({passed:true,sourceCommit:manifest.sourceCommit,nodeVersion:manifest.nodeVersion,frame:b.frame,checks:['extracted launcher','bundled runtime','single FCEUX','native pixels/RAM','checkpoint replay','helpers API','zero idle captures','duplicate refusal']},null,2));
}finally{
 if(emulatorPid){const expected=path.join(packagePath,'rea','bin','fceux64.exe').replaceAll("'","''");execFileSync('powershell.exe',['-NoProfile','-Command',`$p=Get-Process -Id ${emulatorPid} -ErrorAction SilentlyContinue; if($p){if([IO.Path]::GetFullPath($p.Path) -ne '${expected}'){throw 'Unexpected executable; refusing cleanup'};Stop-Process -InputObject $p}`],{windowsHide:true});}
 for(let i=0;i<40&&!exited;i++)await delay(100);if(!exited)child.kill();assert.equal(count(),0,'The test must close its own FCEUX');if(!complete)console.error(output);
}
