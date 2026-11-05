// SPDX-License-Identifier: GPL-2.0-or-later
import {lstat, mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {catalogMatches, catalogRomAlgorithm, selectorFromPicks} from './public/catalog.mjs';
import {sha256} from './evidence.mjs';

export const catalogLimit = 256 * 1024;
const sources = {sprite: ['sprite-raster', 'oam'], tile: ['nametable']};

function digest(value) {
 if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw Error('Expected an FCEUX ROM MD5.');
 return value;
}

function integer(value, min, max, label) {
 if (!Number.isSafeInteger(value) || value < min || value > max) {
  throw Error('Invalid ' + label + '. Expected an integer from ' + min + ' to ' + max + '.');
 }
 return value;
}

function string(value, max, label, required = false) {
 if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
  throw Error('Invalid ' + label + '.');
 }
 return value.trim();
}

function entryId(value) {
 if (typeof value !== 'string' || !/^[a-f0-9]{16}$/.test(value)) throw Error('Invalid catalog entry ID.');
 return value;
}

function metadata(value) {
 if (!Array.isArray(value.labels) || value.labels.length > 8) throw Error('Use up to eight labels.');
 return {name: string(value.name, 80, 'entry name', true),
  labels: [...new Set(value.labels.map(label => string(label, 32, 'label', true)))],
  notes: string(value.notes, 2000, 'entry notes')};
}

function validateSelector(selector, kind) {
 if (!sources[kind].includes(selector?.source) ||
     !Array.isArray(selector.pieces) || !selector.pieces.length || selector.pieces.length > 8) {
  throw Error('Invalid catalog selector source or piece count.');
 }
 const pieces = selector.pieces.map((piece, index) => {
  const dx = integer(piece.dx, -511, 511, 'piece X offset'), dy = integer(piece.dy, -479, 479, 'piece Y offset');
  if (index === 0 && (dx || dy)) throw Error('The first piece is the group anchor and needs zero offsets.');
  const height = integer(piece.height, 8, 16, 'piece height');
  if (!(height === 8 || (height === 16 && kind === 'sprite'))) throw Error('Invalid NES piece height.');
  const address = integer(piece.address, 0, 8192 - height * 2, 'CHR address');
  if (address % (height * 2)) throw Error('CHR address is not aligned to this piece.');
  if (typeof piece.patternId !== 'string' || !/^[a-f0-9]{16}$/.test(piece.patternId)) throw Error('Invalid pattern fingerprint.');
  const palette = piece.palette === null ? null : integer(piece.palette, 0, 3, 'palette');
  return {dx, dy, height, address, patternId: piece.patternId, palette};
 });
 const seed = selector.seed;
 // Keep a small source locator, rather than admitting arbitrary imported objects.
 const sourceSeed = seed ? {captureId: string(seed.captureId, 96, 'seed capture', true),
  frame: integer(seed.frame, 0, Number.MAX_SAFE_INTEGER, 'seed frame')} : undefined;
 return {source: selector.source, pieces, ...(sourceSeed ? {seed: sourceSeed} : {})};
}

function validateEntry(value, romDigest) {
 const kind = value?.kind;
 if (!Object.hasOwn(sources, kind) || value.romDigest !== romDigest ||
     !['old', 'new'].includes(value.ppuCore) || !['NTSC', 'PAL'].includes(value.region)) throw Error('Invalid catalog scope.');
 if (!Array.isArray(value.selectors) || !value.selectors.length || value.selectors.length > 16) throw Error('Use one to sixteen selectors.');
 const selectors = value.selectors.map(selector => validateSelector(selector, kind));
 if (selectors.some(selector => selector.source !== selectors[0].source) ||
     (selectors[0].source === 'sprite-raster' && value.ppuCore !== 'old')) {
  throw Error('An entry uses one evidence source. Admitted sprite rows require the old PPU.');
 }
 return {id: entryId(value.id), revision: integer(value.revision, 1, Number.MAX_SAFE_INTEGER - 1, 'entry revision'),
  kind, romDigest, ppuCore: value.ppuCore, region: value.region, ...metadata(value), selectors};
}

function validateDocument(value, romDigest) {
 if (value?.version !== 1 || value.rom?.algorithm !== catalogRomAlgorithm ||
     value.rom.digest !== romDigest || !Array.isArray(value.entries) || value.entries.length > 96) {
  throw Error('Invalid catalog version, ROM scope or entry count.');
 }
 const entries = value.entries.map(entry => validateEntry(entry, romDigest));
 if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw Error('Duplicate catalog entry ID.');
 return {version: 1, rom: {algorithm: catalogRomAlgorithm, digest: romDigest},
  revision: integer(value.revision, 0, Number.MAX_SAFE_INTEGER - 1, 'catalog revision'), entries};
}

function conflict() {
 return Object.assign(Error('Catalog changed. Reload it and reapply your edit.'), {status: 409});
}

export function catalogStore(dataDir) {
 const root = path.resolve(dataDir, 'catalogs');
 let writes = Promise.resolve();

 async function regularRoot() {
  const item = await lstat(root).catch(error => {
   if (error.code === 'ENOENT') return null;
   throw error;
  });
  if (item && !item.isDirectory()) throw Error('Catalog root must be a regular directory.');
 }

 async function read(romDigest) {
  const filename = path.join(root, digest(romDigest) + '.json');
  await regularRoot();
  try {
   const item = await lstat(filename);
   if (!item.isFile() || item.size > catalogLimit) throw Error('Catalog must be a regular bounded JSON file.');
   const raw = await readFile(filename);
   if (raw.length > catalogLimit) throw Error('Catalog exceeds its size limit.');
   return {...validateDocument(JSON.parse(raw), romDigest), etag: sha256(raw)};
  } catch (error) {
   if (error.code !== 'ENOENT') throw error;
   return {version: 1, rom: {algorithm: catalogRomAlgorithm, digest: romDigest}, revision: 0, entries: [], etag: ''};
  }
 }

 async function change(body, snapshot) {
  const romDigest = digest(body.romDigest);
  const current = await read(romDigest);
  if (body.revision !== current.revision || body.etag !== current.etag) throw conflict();
  const {etag, ...document} = current;
  let entry;
  if (body.op === 'import') {
   const imported = validateDocument(body.document, romDigest);
   document.entries = imported.entries.map(item => {
    const prior = document.entries.find(existing => existing.id === item.id);
    return {...item, revision: prior ? prior.revision + 1 : 1};
   });
  } else if (body.op === 'create') {
   if (document.entries.length >= 96) throw Error('Catalog entry limit reached.');
   if (!snapshot || snapshot.meta.romMd5 !== romDigest) throw Error('Picked capture belongs to a different ROM.');
   const selector = selectorFromPicks(snapshot, body.picks);
   entry = validateEntry({id: randomBytes(8).toString('hex'), revision: 1,
    kind: selector.source === 'nametable' ? 'tile' : 'sprite',
    romDigest, ppuCore: snapshot.meta.ppuCore, region: snapshot.meta.region,
    ...metadata(body), selectors: [selector]}, romDigest);
   document.entries.push(entry);
  } else {
   const index = document.entries.findIndex(item => item.id === entryId(body.entryId));
   if (index < 0) throw Error('Catalog entry was removed.');
   const prior = document.entries[index];
   if (body.op === 'remove') document.entries.splice(index, 1);
   else {
    const updated = {...prior, revision: prior.revision + 1};
    if (body.op === 'edit') Object.assign(updated, metadata(body));
    else if (body.op === 'append') {
     if (!snapshot || snapshot.meta.romMd5 !== romDigest || snapshot.meta.ppuCore !== prior.ppuCore ||
         snapshot.meta.region !== prior.region) throw Error('Picked capture belongs to another ROM, core or region.');
     updated.selectors = [...prior.selectors, selectorFromPicks(snapshot, body.picks)];
    } else throw Error('Unknown catalog operation.');
    entry = validateEntry(updated, romDigest);
    document.entries[index] = entry;
   }
  }
  document.revision++;
  const raw = Buffer.from(JSON.stringify(validateDocument(document, romDigest), null, 2));
  if (raw.length > catalogLimit) throw Error('Catalog exceeds its size limit.');
  await mkdir(root, {recursive: true});
  await regularRoot();
  const temporary = path.join(root, randomBytes(12).toString('hex') + '.tmp');
  try {
   await writeFile(temporary, raw, {flag: 'wx'});
   // Check again after staging so an external edit is visible as a conflict.
   if ((await read(romDigest)).etag !== etag) throw conflict();
   await rename(temporary, path.join(root, romDigest + '.json'));
  } finally {
   await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return {catalog: {...document, etag: sha256(raw)}, entryId: entry?.id};
 }

 function update(body, snapshot) {
  const next = writes.then(() => change(body, snapshot));
  writes = next.catch(() => {});
  return next;
 }

 async function observe(snapshot, request) {
  const catalog = await read(snapshot.meta.romMd5);
  const entry = catalog.entries.find(item => item.id === entryId(request.entryId));
  if (!entry || request.revision !== catalog.revision || request.entryRevision !== entry.revision ||
      request.etag !== catalog.etag) throw conflict();
  const result = catalogMatches(snapshot, entry);
  const key = string(request.match, 256, 'instance key', true);
  const match = result.instances.find(instance => instance.key === key);
  if (!match) throw Error(result.reason ?? 'The selected instance is absent from this capture.');
  const movie = snapshot.meta.playback?.movie;
  return {version: 1, rom: catalog.rom, catalogRevision: catalog.revision,
   entryId: entry.id, entryRevision: entry.revision, label: entry.name, kind: entry.kind,
   definition: entry, definitionSha256: sha256(JSON.stringify(entry)),
   captureId: snapshot.meta.id, frame: snapshot.meta.frame, ppuCore: snapshot.meta.ppuCore,
   region: snapshot.meta.region, evidenceClass: result.source,
   confidence: result.source === 'sprite-raster' ? 'admitted-winning-sprite-layer' : 'mapped-memory-diagnostic',
   match, movie: movie && movie.mode !== 'inactive' ? {
    mode: movie.mode, guid: movie.guid, frame: movie.frame, inputFrame: movie.inputFrame,
    rerecordCount: movie.rerecordCount, length: movie.length, inputMd5: movie.inputMd5
   } : null};
 }

 return {read, update, observe};
}
