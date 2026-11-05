// SPDX-License-Identifier: GPL-2.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startInspector} from '../server.mjs';
import {decodePacket} from '../public/inspection.mjs';
import {fm2Header, fm2InputDigest, fromJSON, sha256} from '../evidence.mjs';
import {advanceCatalogFollow, beginCatalogFollow, catalogMatches, catalogPick, renderCatalog} from '../public/catalog.mjs';

const root = path.resolve('rea');
const output = path.join(root, 'test-output');
const enabled = process.env.REA_NATIVE_TEST === '1';
const powershell = command => execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
 encoding: 'utf8', windowsHide: true
}).trim();
const count = () => Number(powershell('@(Get-Process -Name fceux,fceux64 -ErrorAction SilentlyContinue).Count'));
const picksFor = (state, source, anyPalette = false) => {
 const x = state.buffers.oam[3] + 2;
 return [x, x + 8].map(x => ({source, x, y: 82, anyPalette}));
};

function zipEntries(bytes) {
 const files = new Map();
 let offset = 0;
 while (bytes.readUInt32LE(offset) === 0x04034b50) {
  assert.equal(bytes.readUInt16LE(offset + 8), 0, 'Evidence ZIP uses stored entries');
  const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26);
  const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
  files.set(bytes.toString('utf8', offset + 30, offset + 30 + nameLength), bytes.subarray(start, start + length));
  offset = start + length;
 }
 return files;
}

function movieBytes(rom) {
 const head = [
  'version 3', 'emuVersion 27000', 'romFilename catalog-test', 'romChecksum base64:' + Buffer.from(rom, 'hex').toString('base64'),
  'guid 89654321-abcd-4567-89ab-cdef00112233', 'rerecordCount 3', 'palFlag 0', 'fourscore 0',
  'microphone 0', 'port0 1', 'port1 1', 'port2 0', 'FDS 0', 'NewPPU 0', 'RAMInitOption 0', 'RAMInitSeed 0'
 ];
 const inputs = Array.from({length: 480}, (_, i) => '|0|' + (i >= 90 && i < 125 ? 'R..U....' : '........') + '|........||');
 return Buffer.from([...head, ...inputs, ''].join('\n'));
}

test('native sprite and tile catalog, replay attachments and restart', {skip: !enabled, timeout: 120000}, async () => {
 assert.equal(count(), 0, 'Close FCEUX before running this test');
 await mkdir(output, {recursive: true});
 const dataDir = await mkdtemp(path.join(output, 'catalog-native-'));
 const romPath = path.join(output, 'catalog-test.nes');
 const runtime = path.join(dataDir, 'runtime');
 await mkdir(runtime);
 const exe = path.join(runtime, 'fceux64.exe');
 for (const name of ['fceux64.exe', 'lua51.dll', 'lua5.1.dll', '7z_64.dll']) {
  await copyFile(path.join(root, 'bin', name), path.join(runtime, name));
 }
 const {REA_TEST_WINDOW_X: x, REA_TEST_WINDOW_Y: y} = process.env;
 if (/^-?\d+$/.test(x) && /^-?\d+$/.test(y)) {
  await writeFile(path.join(runtime, 'fceux.cfg'), ['MainWindow_wndx ' + x, 'MainWindow_wndy ' + y, 'ismaximized 0', ''].join('\r\n'));
 }
 let server = await startInspector({port: 18945, dataDir});
 let child;
 const response = (route, body) => {
  const binary = Buffer.isBuffer(body);
  return fetch(server.url + route, body === undefined ? undefined : {method: 'POST', headers: {
   'Content-Type': binary ? 'application/octet-stream' : 'application/json', 'X-REA-Token': server.token
  }, body: binary ? body : JSON.stringify(body)});
 };
 const get = async (route, body, status = 200) => {
  const r = await response(route, body);
  assert.equal(r.status, status, route + ' ' + (await r.clone().text()).slice(0, 500));
  return r.json();
 };
 const control = body => get('/api/control', body);
 const snapshot = async id => fromJSON(await get('/api/snapshot?snapshot=' + id));
 const capture = async body => snapshot((await control(body)).snapshot);
 const step = (frames, pad0 = 0) => capture({op: 'step', frames, pad0});
 const movieStep = frames => capture({op: 'movie-step', frames});
 const toggle = enabled => control({op: 'catalog-observe', enabled});
 async function stopNative() {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
   const stopped = new Promise(resolve => child.once('exit', resolve));
   child.kill();
   await stopped;
  }
  child = undefined;
 }
 async function profile(observer) {
  await toggle(observer);
  await control({op: 'run'});
  const processSample = () => JSON.parse(powershell(
   'Get-Process -Id ' + child.pid + ' | Select-Object CPU,WorkingSet64 | ConvertTo-Json -Compress'
  ));
  const startMachine = await get('/api/playback');
  const start = await get('/api/status');
  const started = performance.now(), before = processSample();
  let after = start.latest, bytes = 0, observed = 0, dropped = 0, lastSize = 0;
  for (let i = 0; i < 7; i++) {
   const r = await response('/api/live?after=' + after);
   if (r.status === 204) continue;
   assert.equal(r.status, 200);
   const data = new Uint8Array(await r.arrayBuffer());
   const {meta, buffers} = decodePacket(data);
   after = meta.id;
   observed++;
   lastSize = data.length;
   bytes += lastSize;
   dropped += meta.spriteRowsDropped;
   assert.equal(!!buffers.spriteRows, observer);
   await delay(500);
  }
  const end = await get('/api/status'), endMachine = await get('/api/playback'), final = processSample();
  await control({op: 'pause'});
  assert.equal(end.invalidPackets - start.invalidPackets, 0);
  assert.equal(dropped, 0);
  assert.equal(observed, 7);
  return {observer, observed, dropped, bytes, lastSize, serverCaptures: end.captures - start.captures,
   demandRequests: end.demandRequests - start.demandRequests, invalidPackets: end.invalidPackets - start.invalidPackets,
   emulatedFrames: endMachine.emulatedFrames - startMachine.emulatedFrames, seconds: (performance.now() - started) / 1000,
   cpuSeconds: final.CPU - before.CPU, startWorkingSet: before.WorkingSet64, endWorkingSet: final.WorkingSet64};
 }

 async function startNative() {
  assert.equal(count(), 0);
  child = spawn(exe, ['-bginput', '1', '-pause', '1', romPath], {cwd: runtime, windowsHide: true, stdio: 'ignore',
   env: {...process.env, FCEUX_REA_PORT: String(server.nativePort), FCEUX_REA_TOKEN: server.token}});
  let launchError;
  child.on('error', error => {launchError = error;});
  for (let tries = 0; tries < 150; tries++) {
   if (launchError) throw launchError;
   if ((await get('/api/session')).connected) break;
   if (child.exitCode !== null) throw Error('FCEUX exited during startup');
   await delay(100);
  }
  assert.equal(count(), 1);
  assert.equal((await get('/api/session')).connected, true);
  if (process.env.REA_TEST_VERIFY_WINDOW) {
   console.log(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    process.env.REA_TEST_VERIFY_WINDOW, '-EmulatorPid', String(child.pid)], {encoding: 'utf8', windowsHide: true}).trim());
  }

 }

 try {
  await startNative();

  await step(90);
  await control({op: 'save', slot: 0});
  const off = await step(8, 128);
  await control({op: 'load', slot: 0});
  await toggle(true);
  let state = await step(8, 128);
  assert.equal(state.meta.cycle, off.meta.cycle);
  assert.equal(state.meta.spriteRowsDropped, 0);
  assert.equal(state.buffers.spriteRows?.length, 19440);
  for (const [name, bytes] of Object.entries(off.buffers)) assert.deepEqual(state.buffers[name], bytes, name);
  assert.equal(catalogPick(state, picksFor(state, 'sprite-raster')[0]).slot, 0);
  assert.equal(catalogPick(state, picksFor(state, 'oam')[0]).slot, 0);

  const rom = state.meta.romMd5;
  let catalog = await get('/api/catalog?rom=' + rom);
  const revision = () => ({romDigest: rom, revision: catalog.revision, etag: catalog.etag});
  const update = async body => {
   const result = await get('/api/catalog', {...revision(), ...body}, body.op === 'create' ? 201 : 200);
   catalog = result.catalog;
   return result.entryId;
  };
  const spriteId = await update({op: 'create', snapshot: state.meta.id, name: 'Twin actors', labels: ['actor'], notes: '',
   picks: picksFor(state, 'sprite-raster')});
  const stale = revision();
  const tileId = await update({op: 'create', snapshot: state.meta.id, name: 'Repeated wall', labels: ['terrain'], notes: '',
   picks: [{source: 'chr', x: 8, y: 0}]});
  await get('/api/catalog', {...stale, op: 'edit', entryId: spriteId, name: 'Stale', labels: [], notes: ''}, 409);
  const spriteEntry = () => catalog.entries.find(entry => entry.id === spriteId);
  const tile = catalog.entries.find(entry => entry.id === tileId);
  const matches = (s, entry = spriteEntry()) => catalogMatches(s, entry);
  let result = matches(state);
  assert.equal(result.instances.length, 2, result.reason);
  assert.equal(result.instances[0].pieces.length, 2);
  const tiles = matches(state, tile);
  assert.equal(tiles.instances.length, 3840);
  assert.equal(tiles.instances[0].pieces[0].nametableAddress, 8192);
  const tileFollow = beginCatalogFollow(state, tile, tiles.instances[0]);
  const first = result.instances[0], rgba = renderCatalog(state, result, [first]);
  assert.equal(rgba[(82 * 256 + first.x + 2) * 4 + 3], 255);
  assert.equal(rgba[(82 * 256 + result.instances[1].x + 2) * 4 + 3], 0);
  assert.match(matches({...state, meta: {...state.meta, romMd5: '0'.repeat(32)}}).reason, /ROM/);
  assert.match(matches({...state, meta: {...state.meta, ppuCore: 'new'}}).reason, /PPU/);

  state = await step(4, 16);
  await update({op: 'append', entryId: spriteId, snapshot: state.meta.id, picks: picksFor(state, 'sprite-raster', true)});
  assert.equal(spriteEntry().selectors.length, 2);
  assert.equal(matches(state).instances[0].selectorIndex, 1);
  assert.equal(advanceCatalogFollow(tileFollow, state, tile, matches(state, tile)).status, 'following');
  state = await step(4);
  result = matches(state);
  let follow = beginCatalogFollow(state, spriteEntry(), result.instances[0]);
  const startX = follow.instance.x;
  state = await step(8, 144);
  follow = advanceCatalogFollow(follow, state, spriteEntry(), matches(state));
  assert.equal(follow.status, 'following', follow.reason);
  assert.equal(follow.instance.x, startX + 8);
  assert.equal(follow.instance.selectorIndex, 1);

  async function attach(state, instance, text) {
   const entry = spriteEntry();
   const anchor = await get('/api/annotations/capture', {snapshot: state.meta.id, catalog: {
    entryId: entry.id, entryRevision: entry.revision, revision: catalog.revision, etag: catalog.etag, match: instance.key
   }}, 201);
   const note = await get('/api/annotations', {snapshot: anchor.snapshot, evidenceSha256: anchor.evidenceSha256,
    catalogAttachmentSha256: anchor.catalogAttachmentSha256, kind: 'observation', format: 'markdown', text}, 201);
   assert.equal(note.catalogAttachment.captureId, state.meta.id);
   assert.equal(note.catalogAttachment.match.x, instance.x);
   assert.equal(note.catalogAttachment.label, entry.name);
   assert.equal(note.catalogAttachment.evidenceClass, 'sprite-raster');
   return note;
  }
  const live = await attach(state, follow.instance, 'Live motion observation');
  const startFollow = follow;
  state = await step(8, 18);
  follow = advanceCatalogFollow(follow, state, spriteEntry(), matches(state));
  assert.equal(follow.status, 'ambiguous', follow.reason);
  state = await step(4, 20);
  assert.equal(advanceCatalogFollow(startFollow, state, spriteEntry(), matches(state)).status, 'missing');
  assert.equal(advanceCatalogFollow(follow, state, spriteEntry(), matches(state)).status, 'ambiguous', 'Lost track stays unresolved');
  state = await step(4, 8);
  assert.equal(state.buffers.oam[1], 4);
  assert.equal(matches(state).instances.length, 1);
  assert.equal(advanceCatalogFollow(startFollow, state, spriteEntry(), matches(state)).status, 'missing');
  assert.equal(matches(await step(4, 1)).instances.length, 0, 'Palette-exact selector rejects the changed palette');
  assert.equal(matches(await step(4, 17)).instances.length, 2, 'Any-palette animation alternative accepts the palette change');
  state = await step(4, 32);
  assert.equal(catalogPick(state, picksFor(state, 'sprite-raster')[0]).address, 4096 + 32);
  assert.equal(matches(state).instances.length, 0);

  state = await step(4, 64);
  const tall = catalogPick(state, picksFor(state, 'sprite-raster')[0]);
  const mappedTall = catalogPick(state, picksFor(state, 'oam')[0]);
  assert.equal(tall.height, 16);
  assert.ok(tall.flipX && tall.flipY);
  assert.equal(tall.patternId, mappedTall.patternId, 'Actual fetched row order canonicalizes both flips');
  assert.match(matches({...state, meta: {...state.meta, spriteRowsDropped: 1}}).reason, /coverage/);

  const performance = [await profile(false), await profile(true)];
  assert.equal(performance[1].lastSize - performance[0].lastSize >= 19430, true);

  const fm2 = movieBytes(rom);
  await writeFile(path.join(dataDir, 'catalog-diagnostic.fm2'), fm2);
  const opened = await get('/api/movie?name=catalog-diagnostic.fm2', fm2);
  assert.equal((await snapshot(opened.snapshot)).meta.playback.movie.inputMd5, fm2InputDigest(fm2).md5);
  state = await movieStep(90);
  result = matches(state);
  assert.equal(result.instances.length, 2, result.reason);
  follow = beginCatalogFollow(state, spriteEntry(), result.instances[0]);
  const pinned = await movieStep(8);
  follow = advanceCatalogFollow(follow, pinned, spriteEntry(), matches(pinned));
  assert.equal(follow.status, 'following', follow.reason);
  assert.equal(follow.instance.selectorIndex, 1);
  await control({op: 'movie-play'});
  await delay(200);
  assert.equal((await get('/api/playback')).paused, false);
  const replay = await attach(pinned, follow.instance, 'Pinned replay observation');
  assert.equal((await get('/api/playback')).paused, false, 'Attaching pinned evidence leaves replay running');
  assert.equal(replay.frame, 98);
  assert.equal(replay.movie.inputFrame, 97);
  assert.equal(replay.movieFile.status, 'verified', JSON.stringify(replay.movieFile));
  assert.deepEqual(await readFile(replay.movie.path), fm2);
  await control({op: 'pause'});
  for (let i = 0; i < 18; i++) await movieStep(1);
  await get('/api/snapshot?snapshot=' + pinned.meta.id, undefined, 404);
  const restarted = await capture({op: 'movie-restart'});
  assert.equal(advanceCatalogFollow(follow, restarted, spriteEntry(), matches(restarted)).status, 'lost');

  await update({op: 'edit', entryId: spriteId, name: 'Renamed actors', labels: ['revised'], notes: 'Current only'});
  assert.equal(spriteEntry().revision, 3);
  await stopNative();
  await server.close();
  server = await startInspector({port: 18945, dataDir});
  assert.equal((await get('/api/catalog?rom=' + rom)).entries.find(entry => entry.id === spriteId).name, 'Renamed actors');
  for (const note of [live, replay]) {
   const route = '/api/annotations/' + note.id;
   const saved = await get(route + '/catalog');
   assert.equal(saved.label, 'Twin actors');
   assert.equal(saved.entryRevision, 2);
   assert.equal(sha256(JSON.stringify(saved)), note.catalogAttachmentSha256);
   assert.equal((await get(route + '/snapshot')).id, saved.captureId);
   assert.equal((await get(route + '/json')).comment.catalogAttachment.definitionSha256, saved.definitionSha256);
   const png = await response(note.imageUrl);
   assert.equal(sha256(Buffer.from(await png.arrayBuffer())), note.imageSha256);
   const bundle = await response(route + '/bundle');
   assert.equal(bundle.status, 200, await bundle.clone().text());
   const files = zipEntries(Buffer.from(await bundle.arrayBuffer()));
   const manifest = JSON.parse(files.get('manifest.json'));
   for (const entry of manifest.files) assert.equal(sha256(files.get(entry.path)), entry.sha256, entry.path);
   assert.equal(sha256(files.get('catalog/' + note.catalogAttachmentSha256 + '.json')), note.catalogAttachmentSha256);
   if (note === replay) {
    assert.deepEqual(files.get('movie/original.fm2'), fm2);
    const annotated = files.get('movie/annotated.fm2');
    assert.deepEqual(annotated.subarray(fm2Header(annotated).boundary), fm2.subarray(fm2Header(fm2).boundary));
    assert.match(annotated.toString(), new RegExp(note.catalogAttachmentSha256));
   }
  }
  await writeFile(path.join(runtime, 'fceux.cfg'), [
   'newppu 1', 'MainWindow_wndx ' + (x ?? 0), 'MainWindow_wndy ' + (y ?? 0), 'ismaximized 0', ''
  ].join('\r\n'));
  await startNative();
  const newPpu = await step(90);
  assert.equal(newPpu.meta.ppuCore, 'new');
  assert.equal(newPpu.buffers.spriteRows, undefined);
  assert.throws(() => catalogPick(newPpu, picksFor(newPpu, 'sprite-raster')[0]), /old PPU/);
  assert.equal(catalogPick(newPpu, picksFor(newPpu, 'oam')[0]).source, 'oam');
  assert.equal(catalogPick(newPpu, {source:'nametable',x:18,y:18}).source, 'nametable');
  await get('/api/control', {op: 'catalog-observe', enabled: true}, 409);
  const report = {newPpuDiagnostics: ['oam', 'nametable'], live: {id: live.id, frame: live.frame, captureId: live.snapshot, attachment: live.catalogAttachmentSha256},
   replay: {id: replay.id, frame: replay.frame, inputFrame: replay.movie.inputFrame, captureId: replay.snapshot,
    attachment: replay.catalogAttachmentSha256, fm2Sha256: sha256(fm2)}, performance};
  await writeFile(path.join(output, 'catalog-native-validation.json'), JSON.stringify(report, null, 2));
 } finally {
  await stopNative();
  await server.close();
  assert.equal(count(), 0);
 }
});
