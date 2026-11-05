// SPDX-License-Identifier: GPL-2.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startInspector} from '../server.mjs';
import {decodePacket} from '../public/inspection.mjs';
import {fm2Header, fm2InputDigest, fromJSON, jsonSnapshot, sha256} from '../evidence.mjs';
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
  const tileAddress = 0x2042;
  const chosenCell = result => result.instances.find(instance => instance.pieces[0].nametableAddress === tileAddress);
  const chosen = chosenCell(tiles);
  assert.deepEqual([chosen.x, chosen.y, chosen.width, chosen.height], [16, 16, 8, 8]);
  const tilePixels = renderCatalog(state, tiles, [chosen]);
  assert.equal(tilePixels[(16 * tiles.size[0] + 16) * 4 + 3], 255);
  assert.equal(tilePixels[(16 * tiles.size[0] + 24) * 4 + 3], 0, 'An adjacent repeat stays outside the isolation');
  const first = result.instances[0], rgba = renderCatalog(state, result, [first]);
  assert.equal(rgba[(82 * 256 + first.x + 2) * 4 + 3], 255);
  assert.equal(rgba[(82 * 256 + result.instances[1].x + 2) * 4 + 3], 0);
  assert.match(matches({...state, meta: {...state.meta, romMd5: '0'.repeat(32)}}).reason, /ROM/);
  assert.match(matches({...state, meta: {...state.meta, ppuCore: 'new'}}).reason, /PPU/);

  state = await step(4, 16);
  await update({op: 'append', entryId: spriteId, snapshot: state.meta.id, picks: picksFor(state, 'sprite-raster', true)});
  assert.equal(spriteEntry().selectors.length, 2);
  assert.equal(matches(state).instances[0].selectorIndex, 1);
  state = await step(4);
  result = matches(state);
  let follow = beginCatalogFollow(state, spriteEntry(), result.instances[0]);
  const startX = follow.instance.x;
  state = await step(8, 144);
  follow = advanceCatalogFollow(follow, state, spriteEntry(), matches(state));
  assert.equal(follow.status, 'following', follow.reason);
  assert.equal(follow.instance.x, startX + 8);
  assert.equal(follow.instance.selectorIndex, 1);

  const observations = [];
  async function attach(state, entry, instance, text) {
   const anchor = await get('/api/annotations/capture', {snapshot: state.meta.id, catalog: {
    entryId: entry.id, entryRevision: entry.revision, revision: catalog.revision, etag: catalog.etag, match: instance.key
   }}, 201);
   const note = await get('/api/annotations', {snapshot: anchor.snapshot, evidenceSha256: anchor.evidenceSha256,
    catalogAttachmentSha256: anchor.catalogAttachmentSha256, kind: 'observation', format: 'markdown', text}, 201);
   assert.equal(note.catalogAttachment.captureId, state.meta.id);
   assert.deepEqual(note.catalogAttachment.match, instance);
   assert.equal(note.catalogAttachment.label, entry.name);
   assert.equal(note.catalogAttachment.evidenceClass, entry.kind === 'tile' ? 'nametable' : 'sprite-raster');
   assert.equal(note.catalogAttachment.catalogRevision, catalog.revision);
   assert.equal(note.catalogAttachment.entryRevision, entry.revision);
   observations.push({note, state, entry});
   return note;
  }

  async function nextRunningCapture(previous) {
   await delay(510);
   const r = await response('/api/live?after=' + previous.meta.id);
   assert.equal(r.status, 200);
   const next = decodePacket(Buffer.from(await r.arrayBuffer()));
   assert.ok(next.meta.frame > previous.meta.frame, 'The machine advanced during capture');
   assert.equal(next.meta.playback.paused, false);
   return next;
  }

  async function attachRunningTile(start, text) {
   const startCell = chosenCell(matches(start, tile));
   assert.ok(startCell, 'The chosen logical cell is visible before following');
   const observed = await nextRunningCapture(start);
   const track = advanceCatalogFollow(beginCatalogFollow(start, tile, startCell), observed, tile, matches(observed, tile));
   assert.equal(track.status, 'following', track.reason);
   assert.deepEqual(track.instance, startCell);
   assert.equal(track.captureId, observed.meta.id);
   const pinnedTile = await snapshot(track.captureId);
   const later = await nextRunningCapture(observed);
   const note = await attach(pinnedTile, tile, track.instance, text);
   assert.ok(note.frame < later.meta.frame, 'The comment stays on the pinned frame while playback advances');
   assert.equal((await get('/api/playback')).paused, false);
   return note;
  }

  const live = await attach(state, spriteEntry(), follow.instance, 'Live motion observation');
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
  const liveTile = await attachRunningTile(await capture({op: 'run'}), 'Live observation of the chosen wall cell');
  assert.equal(liveTile.catalogAttachment.movie, null);
  await control({op: 'pause'});

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
  const replayStart = await capture({op: 'movie-play'});
  assert.equal(replayStart.meta.playback.movie.readOnly, true);
  await delay(200);
  assert.equal((await get('/api/playback')).paused, false);
  const replay = await attach(pinned, spriteEntry(), follow.instance, 'Pinned replay observation');
  assert.equal((await get('/api/playback')).paused, false, 'Attaching pinned evidence leaves replay running');
  assert.equal(replay.frame, 98);
  assert.equal(replay.movie.inputFrame, 97);
  assert.equal(replay.movieFile.status, 'verified', JSON.stringify(replay.movieFile));
  assert.deepEqual(await readFile(replay.movie.path), fm2);
  const tileReplayStart = await nextRunningCapture(replayStart);
  const replayTile = await attachRunningTile(tileReplayStart, 'FM2 observation of the chosen wall cell');
  assert.equal(replayTile.movie.readOnly, true);
  assert.equal(replayTile.movie.inputFrame, replayTile.frame - 1);
  assert.equal(replayTile.movieFile.status, 'verified', JSON.stringify(replayTile.movieFile));
  assert.deepEqual(await readFile(replayTile.movie.path), fm2);
  await control({op: 'pause'});
  for (let i = 0; i < 18; i++) await movieStep(1);
  await get('/api/snapshot?snapshot=' + pinned.meta.id, undefined, 404);
  await get('/api/snapshot?snapshot=' + replayTile.snapshot, undefined, 404);
  const restarted = await capture({op: 'movie-restart'});
  assert.equal(advanceCatalogFollow(follow, restarted, spriteEntry(), matches(restarted)).status, 'lost');

  await update({op: 'edit', entryId: spriteId, name: 'Renamed actors', labels: ['revised'], notes: 'Current only'});
  await update({op: 'edit', entryId: tileId, name: 'Renamed wall', labels: ['revised'], notes: 'Current only'});
  assert.equal(spriteEntry().revision, 3);
  await stopNative();
  await server.close();
  server = await startInspector({port: 18945, dataDir});
  const reopenedCatalog = await get('/api/catalog?rom=' + rom);
  assert.equal(reopenedCatalog.entries.find(entry => entry.id === spriteId).name, 'Renamed actors');
  const renamedTile = reopenedCatalog.entries.find(entry => entry.id === tileId);
  assert.equal(renamedTile.name, 'Renamed wall');
  assert.equal(renamedTile.revision, tile.revision + 1);
  for (const {note, state, entry} of observations) {
   const route = '/api/annotations/' + note.id;
   const saved = await get(route + '/catalog');
   assert.deepEqual(saved, note.catalogAttachment);
   assert.deepEqual(saved.definition, entry);
   assert.equal(saved.label, entry.name);
   assert.equal(saved.entryRevision, entry.revision);
   assert.equal(sha256(JSON.stringify(saved)), note.catalogAttachmentSha256);
   assert.deepEqual(await get(route + '/snapshot'), jsonSnapshot(state));
   assert.equal((await get(route + '/json')).comment.catalogAttachment.definitionSha256, saved.definitionSha256);
   const png = await response(note.imageUrl);
   assert.equal(sha256(Buffer.from(await png.arrayBuffer())), note.imageSha256);
   const bundle = await response(route + '/bundle');
   assert.equal(bundle.status, 200, await bundle.clone().text());
   const files = zipEntries(Buffer.from(await bundle.arrayBuffer()));
   const manifest = JSON.parse(files.get('manifest.json'));
   for (const entry of manifest.files) assert.equal(sha256(files.get(entry.path)), entry.sha256, entry.path);
   assert.equal(sha256(files.get('catalog/' + note.catalogAttachmentSha256 + '.json')), note.catalogAttachmentSha256);
   assert.equal(sha256(files.get('evidence/' + note.evidenceSha256 + '.json')), note.evidenceSha256);
   assert.equal(sha256(files.get('evidence/' + note.imageSha256 + '.png')), note.imageSha256);
   if (note.movieFile.status === 'verified') {
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
  const tileEvidence = note => ({
   id: note.id, frame: note.frame, inputFrame: note.movie?.inputFrame, captureId: note.snapshot,
   catalogRevision: note.catalogAttachment.catalogRevision, entryRevision: note.catalogAttachment.entryRevision,
   nametableAddress: tileAddress, bounds: [chosen.x, chosen.y, chosen.width, chosen.height],
   attachment: note.catalogAttachmentSha256, snapshotSha256: note.evidenceSha256, imageSha256: note.imageSha256
  });
  const report = {newPpuDiagnostics: ['oam', 'nametable'], live: {id: live.id, frame: live.frame, captureId: live.snapshot, attachment: live.catalogAttachmentSha256},
   replay: {id: replay.id, frame: replay.frame, inputFrame: replay.movie.inputFrame, captureId: replay.snapshot,
    attachment: replay.catalogAttachmentSha256, fm2Sha256: sha256(fm2)},
   tiles: {live: tileEvidence(liveTile), replay: tileEvidence(replayTile), reopenedAs: renamedTile.name,
    reopenedEntryRevision: renamedTile.revision, fm2InputsUnchanged: true}, performance};
  await writeFile(path.join(output, 'catalog-native-validation.json'), JSON.stringify(report, null, 2));
 } finally {
  await stopNative();
  await server.close();
  assert.equal(count(), 0);
 }
});
