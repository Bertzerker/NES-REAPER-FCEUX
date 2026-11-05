// SPDX-License-Identifier: GPL-2.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {actionReason,compareEvidence,draftStorage} from '../public/workbench.mjs';
const sample=(id='session-1-0-1',rom='rom',value=0)=>({meta:{id,romMd5:rom,screenValid:true},buffers:{ram:Uint8Array.from([value,1,2]),chr:Uint8Array.from([4,value])}});
test('availability separates disconnected, unknown, movie, checkpoint and interruptible command states',()=>{
 const s={connected:true,machine:{paused:true,frame:2,movie:{mode:'inactive'},checkpoints:Array.from({length:16},(_,slot)=>({occupied:slot===15}))},current:sample()};
 assert.match(actionReason('play',{...s,connected:false}),/disconnected/);assert.equal(actionReason('export',{...s,connected:false}),'');
 assert.match(actionReason('play',{...s,unknown:true}),/unknown/);assert.equal(actionReason('pause',{...s,unknown:true}),'');
 assert.match(actionReason('step',{...s,pending:[{op:'step'}]}),/pending/);assert.equal(actionReason('pause',{...s,pending:[{op:'step'}]}),'');assert.match(actionReason('pause',{...s,pending:[{op:'speed'}]}),/pending/);
 assert.equal(actionReason('load',{...s,slot:15}),'');assert.match(actionReason('load',{...s,slot:15,machine:{...s.machine,checkpoints:s.machine.checkpoints.map(c=>({...c,compatible:false}))}}),/PPU core/);assert.match(actionReason('load',{...s,slot:0}),/empty/);
 assert.match(actionReason('save',{...s,machine:{...s.machine,paused:false}}),/Pause/);
 assert.match(actionReason('experiment',{...s,machine:{...s.machine,movie:{mode:'playback'}}}),/recorded inputs/);
 assert.match(actionReason('play',{...s,machine:{...s.machine,movie:{mode:'tas-editor',recording:true}}}),/recording/);
 assert.match(actionReason('comment-displayed',{...s,draft:true}),/draft/);
});
test('explicit memory baselines survive domain changes and reject cross-ROM/session comparisons',()=>{
 const a=sample(),b=sample('session-1-0-2','rom',9);assert.deepEqual(compareEvidence(a,b,'ram').changes,[{address:0,before:0,after:9}]);assert.deepEqual(compareEvidence(a,b,'chr').changes,[{address:1,before:0,after:9}]);
 assert.match(compareEvidence(a,sample('other-2-0-1'),'ram').reason,/sessions/);assert.match(compareEvidence(a,sample('session-1-0-2','other'),'ram').reason,/ROMs/);
});
test('draft recovery retains frame anchors, prose and revision separately for each tab',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},a=draftStorage(storage,'tab-a'),b=draftStorage(storage,'tab-b');
 a.write({anchor:{frame:24,evidenceSha256:'a'.repeat(64)},editing:'note',revision:1,text:'unsaved prose'});b.write({anchor:{frame:25},revision:2,text:'another tab'});
 assert.equal(draftStorage(storage,'tab-a').read().text,'unsaved prose');assert.equal(a.read().anchor.frame,24);assert.equal(a.read().revision,1);a.clear();assert.equal(a.read(),null);assert.equal(b.read().text,'another tab');
});
