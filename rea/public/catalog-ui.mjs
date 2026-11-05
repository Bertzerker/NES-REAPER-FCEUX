// SPDX-License-Identifier: GPL-2.0-or-later
import {advanceCatalogFollow, beginCatalogFollow, catalogMatches, catalogPick, catalogSources, renderCatalog} from './catalog.mjs';

export function setupCatalog({api, command, reason, attach, notice, openDrawer, machine}) {
 const $ = id => document.getElementById(id);
 const canvas = $('catalog-isolation');
 const context = canvas.getContext('2d');
 let catalog = null, snapshot, picked = null, group = [], entryId = '';
 let follow = null, selection = null, waitingForPick = false, archived = null;
 let result, image, renderKey = '', request = 0, loadingRom = '', saving = false;

 const visible = () => !$('panel-catalog').hidden && !document.body.classList.contains('detached');
 const entry = () => archived?.definition ?? catalog?.entries.find(item => item.id === entryId);
 const scope = () => /^[a-f0-9]{32}$/.test(snapshot?.meta.romMd5 ?? '') ? snapshot.meta.romMd5 : null;
 const captureRef = state => ({snapshot: state.meta.id, evidenceSha256: state.archivedEvidence});
 const guarded = handler => async (...args) => {
  try { await handler(...args); }
  catch (error) { $('catalog-message').textContent = error.message; notice(error.message, true); }
 };
 const formatSample = sample => [
  sample.slot === undefined ? 'Tile ' + sample.tile : 'OAM slot ' + sample.slot + ' · ' + sample.width + '×' + sample.height,
  '(' + sample.x + ', ' + sample.y + ')',
  'CHR $' + sample.address.toString(16).toUpperCase().padStart(4, '0'),
  'pattern ' + sample.patternId,
  sample.palette === null ? 'any palette' : 'palette ' + sample.palette,
  sample.nametableAddress === undefined ? null : 'NT $' + sample.nametableAddress.toString(16).toUpperCase() + ' · alias ' + sample.alias,
  sample.flipX || sample.flipY ? 'flip ' + (sample.flipX ? 'H' : '') + (sample.flipY ? 'V' : '') : null
 ].filter(Boolean).join(' · ');

 function available() {
  const supports = typeof machine()?.catalogObserver === 'boolean' && machine()?.ppuCore === 'old';
  const observerReason = reason('catalog-observe');
  $('catalog-observer').disabled = !supports || !!archived || !!observerReason;
  $('catalog-observer').title = observerReason;
  $('catalog-observer').textContent = machine()?.catalogObserver ? 'Disable admitted sprite capture' : 'Enable admitted sprite capture';
  $('catalog-observer-status').textContent = supports
   ? (machine()?.catalogObserver ? 'Old PPU sprite observation is on. Samples arrive on rendered frames.' : 'Old PPU sprite observation is off.')
   : 'This native session cannot supply admitted sprite rows. Use OAM or tile diagnostics.';
  const canChange = !!catalog && catalog.rom.digest === scope() && !saving && !archived;
  const hasSeed = !!picked?.sample || !!group.length;
  $('catalog-create').disabled = !canChange || !hasSeed;
  $('catalog-append').disabled = !canChange || !entry() || !hasSeed;
  $('catalog-save').disabled = !canChange || !entry();
  $('catalog-remove').disabled = !canChange || !entry();
  $('catalog-import').disabled = !canChange;
  const attachReason = reason('comment-displayed');
  $('catalog-attach').disabled = !!attachReason || !activeInstance() || !!archived;
  $('catalog-attach').title = attachReason;
  for (const id of ['catalog-name','catalog-labels','catalog-notes']) $(id).readOnly = !!archived;
  $('catalog-entry').disabled = !!archived;
  $('catalog-show-all').disabled = !!archived;
  $('catalog-instance').disabled = !!archived;
  $('catalog-add-piece').disabled = !picked?.sample || !!archived;
  $('catalog-follow').disabled = !result?.instances.length || !!archived;
 }

 function renderGroup() {
  $('catalog-group').replaceChildren();
  for (const [index, piece] of group.entries()) {
   const row = document.createElement('li');
   row.textContent = (index === 0 ? 'Anchor · ' : '') + formatSample(piece.sample) + ' ';
   const button = document.createElement('button');
   button.textContent = 'Remove piece';
   button.onclick = () => {group.splice(index, 1); renderGroup(); available();};
   row.append(button);
   $('catalog-group').append(row);
  }
 }

 function setPick(state, point) {
  if (!point || !state) return;
  const forced = $('catalog-pick-source').value;
  let source;
  if (point.view === 'nametables') source = 'nametable';
  else if (point.view === 'patterns') source = 'chr';
  else if (point.view === 'composite' || point.view === 'sprites') {
   source = forced === 'auto' ? state.buffers.spriteRows ? 'sprite-raster' : 'oam' : forced;
  }
  const slotValue = $('catalog-oam-slot').value;
  const slot = source === 'oam' && slotValue !== '' ? Number(slotValue) : undefined;
  const spec = {source, x: point.x, y: point.y, slot};
  try {
   const sample = catalogPick(state, spec);
   picked = {state, point, spec, sample};
   $('catalog-pick').textContent = catalogSources[source] + ' · ' + formatSample(sample) + ' · capture ' + state.meta.id;
   if (point.view === 'composite') $('catalog-pick').textContent += ' · selected from the sprite layer or diagnostic OAM at this coordinate.';
  } catch (error) {
   picked = {state, point, error};
   $('catalog-pick').textContent = error.message;
  }
  $('catalog-add-piece').disabled = !picked.sample;
  available();
 }

 function fields() {
  return {name: $('catalog-name').value, labels: $('catalog-labels').value.split(',').map(label => label.trim()).filter(Boolean),
   notes: $('catalog-notes').value};
 }

 function showFields() {
  const selected = entry();
  $('catalog-name').value = selected?.name ?? '';
  $('catalog-labels').value = selected?.labels.join(', ') ?? '';
  $('catalog-notes').value = selected?.notes ?? '';
  $('catalog-definition').textContent = selected ? JSON.stringify(selected.selectors, null, 2) : 'No entry selected.';
 }

 function entries(refreshFields = false) {
  const filter = $('catalog-search').value.trim().toLowerCase();
  const kind = $('catalog-kind').value;
  const options = (catalog?.entries ?? []).filter(item =>
   (kind === 'all' || item.kind === kind) && [item.name, ...item.labels, item.notes].some(value => value.toLowerCase().includes(filter)));
  const select = $('catalog-entry');
  select.replaceChildren(new Option('Choose a catalog entry', ''));
  for (const item of options) select.append(new Option(item.name + ' · ' + item.kind + ' · r' + item.revision, item.id));
  if (entryId && !catalog?.entries.some(item => item.id === entryId)) entryId = '';
  select.value = entryId;
  if (refreshFields) showFields();
  available();
 }

 async function reload(refreshFields = false) {
  const rom = scope();
  if (!rom || saving) return;
  const ticket = ++request;
  loadingRom = rom;
  try {
   const updated = await api('/api/catalog?rom=' + rom);
   if (ticket !== request || scope() !== rom) return;
   catalog = updated;
   entries(refreshFields);
   $('catalog-message').textContent = 'Loaded catalog revision ' + catalog.revision + ' for ' + rom + '.';
   draw();
  } finally {
   if (ticket === request) loadingRom = '';
  }
 }

 function activeInstance() {
  if (archived) return archived.match;
  if (!snapshot || catalog?.rom.digest !== scope()) return undefined;
  if (follow?.status === 'following' && follow.captureId === snapshot?.meta.id) return follow.instance;
  if (selection?.captureId === snapshot?.meta.id) return result?.instances.find(item => item.key === selection.key);
  if (!follow && result?.instances.length === 1) return result.instances[0];
  return undefined;
 }

 function draw() {
  if (!visible()) return;
  const selected = entry();
  available();
  if (!snapshot || !selected) {
   context.clearRect(0, 0, canvas.width, canvas.height);
   $('catalog-match-status').textContent = 'Pick a sample or choose a catalog entry.';
   $('catalog-instance').replaceChildren(new Option('Choose a match', ''));
   result = undefined;
   renderKey = '';
   available();
   return;
  }
  const key = [snapshot.meta.id, selected.id, selected.revision, catalog?.etag, archived?.captureId].join('|');
  if (renderKey !== key) {
   result = catalogMatches(snapshot, selected);
   renderKey = key;
   if (follow && !archived) follow = advanceCatalogFollow(follow, snapshot, selected, result);
   const options = [new Option('Choose a match', '')];
   for (const item of result.instances.slice(0, 128)) {
    options.push(new Option('(' + item.x + ', ' + item.y + ') · ' + item.anchor, item.key));
   }
   $('catalog-instance').replaceChildren(...options);
  }
  const [width, height] = result.size;
  if (canvas.width !== width || canvas.height !== height) {
   canvas.width = width;
   canvas.height = height;
   image = null;
  }
  const shown = archived ? [archived.match] : follow ? follow.status === 'following' ? [follow.instance] : [] : result.instances;
  const rgba = renderCatalog(snapshot, result, shown, image?.data);
  image ??= new ImageData(rgba, width, height);
  context.putImageData(image, 0, 0);
  context.strokeStyle = '#a6e3a1';
  for (const instance of shown) {
   context.strokeRect(instance.x + .5, instance.y + .5, Math.max(0, instance.width - 1), Math.max(0, instance.height - 1));
  }
  const bounds = instance => '(' + instance.x + ', ' + instance.y + ') · ' + instance.width + '×' + instance.height;
  const status = archived ? 'Saved observation · ' + archived.label + ' · entry revision ' + archived.entryRevision +
   ' · catalog revision ' + archived.catalogRevision + ' · frame ' + archived.frame +
   (archived.movie ? ' · input ' + archived.movie.inputFrame : '') + ' · ' + bounds(archived.match)
   : follow ? follow.status + (follow.reason ? ' · ' + follow.reason : ' · ' + follow.instance.anchor + ' · ' + bounds(follow.instance))
   : waitingForPick ? 'Click an isolated instance to follow it'
   : result.reason ? 'Unavailable · ' + result.reason
   : 'All matches · ' + result.instances.length;
  $('catalog-match-status').textContent = status + ' · ' + catalogSources[result.source] +
   ' · capture ' + snapshot.meta.id + (result.instances.length > 128 ? ' · Click any sample to pick it.' : '');
  available();
 }

 async function change(op) {
  if (saving || !catalog || archived || catalog.rom.digest !== scope()) return;
  const selected = entry();
  const body = {op, romDigest: catalog.rom.digest, revision: catalog.revision, etag: catalog.etag, entryId: selected?.id};
  if (op === 'create' || op === 'edit') Object.assign(body, fields());
  if (op === 'create' || op === 'append') {
   const pieces = group.length ? group : picked?.sample ? [{...picked, anyPalette: $('catalog-any-palette').checked}] : [];
   if (!pieces.length) throw Error('Pick a supported sample first.');
   Object.assign(body, captureRef(pieces[0].state), {
    picks: pieces.map(piece => ({...piece.spec, anyPalette: piece.anyPalette}))
   });
  }
  if (op === 'import') body.document = JSON.parse($('catalog-json').value);
  saving = true;
  ++request;
  loadingRom = '';
  available();
  try {
   const response = await api('/api/catalog', body);
   if (scope() !== body.romDigest || archived) return;
   catalog = response.catalog;
   if (op === 'create' || op === 'append') {
    group = [];
    renderGroup();
   }
   entryId = response.entryId ?? entryId;
   entries(true);
   $('catalog-message').textContent = 'Saved catalog revision ' + catalog.revision + '.';
   draw();
  } finally {
   saving = false;
   available();
  }
 }

 function choose(instance, start) {
  if (!instance || archived || !snapshot) return;
  selection = {captureId: snapshot.meta.id, key: instance.key};
  if (start) {
   follow = beginCatalogFollow(snapshot, entry(), instance);
   waitingForPick = false;
  }
  draw();
 }

 $('catalog-entry').onchange = () => {
  entryId = $('catalog-entry').value;
  follow = null;
  selection = null;
  waitingForPick = false;
  showFields();
  draw();
 };
 for (const id of ['catalog-search', 'catalog-kind']) $(id).oninput = () => entries();
 for (const id of ['catalog-pick-source', 'catalog-oam-slot']) $(id).onchange = () => {
  if (picked) setPick(picked.state, picked.point);
 };
 $('catalog-add-piece').onclick = guarded(() => {
  if (!picked?.sample) throw Error('Pick a supported sample first.');
  if (group.length && (group[0].state.meta.id !== picked.state.meta.id ||
      group[0].sample.source !== picked.sample.source)) throw Error('Group pieces must use the same capture and source. Clear the group to start again.');
  if (group.length >= 8 || group.some(piece => piece.sample.key === picked.sample.key)) throw Error('Choose a distinct piece. A group holds up to eight pieces.');
  group.push({...picked, anyPalette: $('catalog-any-palette').checked});
  renderGroup();
  available();
 });
 $('catalog-clear-pieces').onclick = () => {group = []; renderGroup(); available();};
 $('catalog-show-all').onclick = () => {follow = null; selection = null; waitingForPick = false; draw();};
 $('catalog-follow').onclick = () => {
  if (selection?.captureId === snapshot?.meta.id && activeInstance()) choose(activeInstance(), true);
  else {follow = null; waitingForPick = true; draw();}
 };
 $('catalog-instance').onchange = () => choose(result?.instances.find(item => item.key === $('catalog-instance').value), waitingForPick);
 canvas.onclick = event => {
  if (!result) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * canvas.width / rect.width);
  const y = Math.floor((event.clientY - rect.top) * canvas.height / rect.height);
  const slot = result.owners?.[y * 256 + x];
  const matches = result.instances.filter(instance => instance.pieces.some(piece =>
   x >= piece.x && x < piece.x + piece.width && y >= piece.y && y < piece.y + piece.height &&
   (result.source !== 'sprite-raster' || piece.slot === slot)));
  if (matches.length === 1) choose(matches[0], true);
  else $('catalog-message').textContent = matches.length ? 'Overlapping groups. Choose a match from the list.' : 'Click a visible matched sample.';
 };
 for (const [id, op] of Object.entries({'catalog-create':'create', 'catalog-append':'append', 'catalog-save':'edit',
  'catalog-remove':'remove', 'catalog-import':'import'})) $(id).onclick = guarded(() => change(op));
 $('catalog-reload').onclick = guarded(() => reload(true));
 $('catalog-json-load').onclick = () => {
  if (!catalog) return;
  const {etag, ...document} = catalog;
  $('catalog-json').value = JSON.stringify(document, null, 2);
 };
 $('catalog-observer').onclick = guarded(() => command({op: 'catalog-observe', enabled: !machine()?.catalogObserver}));
 $('catalog-attach').onclick = guarded(async () => {
  const instance = activeInstance(), selected = entry();
  if (!instance || !selected || archived) throw Error('Choose one matched instance in the displayed capture.');
  await attach(snapshot, {entryId: selected.id, entryRevision: selected.revision,
   revision: catalog.revision, etag: catalog.etag, match: instance.key});
 });

 function update(state) {
  const oldRom = scope();
  snapshot = state;
  if (oldRom && oldRom !== scope()) {
   group = [];
   picked = null;
   renderGroup();
   $('catalog-pick').textContent = 'Pick a sample from this ROM.';
  }
  if (archived?.captureId !== state.meta.id) archived = null;
  if (visible() && scope() && catalog?.rom.digest !== scope() && loadingRom !== scope()) {
   guarded(() => reload(true))();
  }
  draw();
 }

 function review(observation) {
  archived = observation ?? null;
  if (archived) {
   openDrawer('catalog');
   showFields();
  } else if (visible()) showFields();
  draw();
 }

 return {update, pick: setPick, review, available, visible: () => { if (snapshot) update(snapshot); },
  returnLive: () => {if (archived) {archived = null; follow = null; selection = null; showFields(); draw();}}};
}
