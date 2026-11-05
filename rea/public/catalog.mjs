// SPDX-License-Identifier: GPL-2.0-or-later
import {nametablePixel, pattern, render, sprite, spritePixel} from './inspection.mjs';

export const catalogRomAlgorithm = 'fceux-rom-md5-v1';
export const catalogSources = {
 'sprite-raster': 'Old PPU winning sprite-layer samples',
 oam: 'End-of-frame OAM and mapped CHR diagnostic',
 nametable: 'End-of-frame nametable and mapped CHR diagnostic',
 chr: 'End-of-frame mapped CHR diagnostic'
};
const cache = new WeakMap();

function patternId(bytes, start, length) {
 let first = 2166136261, second = 0x9e3779b9;
 for (let i = start; i < start + length; i++) {
  first = Math.imul(first ^ bytes[i], 16777619);
  second = Math.imul(second ^ (bytes[i] + 1), 2246822519);
 }
 return [first, second].map(hash => (hash >>> 0).toString(16).padStart(8, '0')).join('');
}

function spriteAddress(snapshot, entry) {
 if (entry.height === 16) return (entry.tile & 1) * 4096 + (entry.tile & 254) * 16;
 return ((snapshot.meta.ppu.ctrl & 8) ? 4096 : 0) + entry.tile * 16;
}

function rasterSamples(snapshot) {
 const rows = snapshot.buffers.spriteRows;
 if (!rows || !snapshot.meta.rasterValid || snapshot.meta.ppuCore !== 'old') {
  return {samples: [], reason: 'Admitted sprite rows require the old PPU and an observed rendered frame.'};
 }
 if (snapshot.meta.spriteRowsDropped) {
  return {samples: [], reason: 'Admitted row coverage exceeded its limit or was incomplete. Use OAM diagnostics.'};
 }
 const owners = new Uint8Array(61440).fill(255);
 const entries = Array(64).fill(null);
 const coverage = new Uint16Array(64);
 for (let y = 0; y < 240; y++) {
  const line = y * 81;
  if (rows[line] > 8) return {samples: [], reason: 'Admitted sprite row coverage is incomplete.'};
  for (let i = 0; i < rows[line]; i++) {
   const at = line + 1 + i * 10;
   const slot = rows[at], x = rows[at+1], top = rows[at+2] + 1, height = rows[at+3];
   const attributes = rows[at+4], tile = rows[at+5];
   const address = rows[at+6] | (rows[at+7] << 8);
   const base = address & ~(height === 16 ? 31 : 15);
   if (slot >= 64 || ![8, 16].includes(height) || address >= 8192 || y < top || y >= top + height) {
    return {samples: [], reason: 'Admitted sprite metadata could not be tied to a complete row.'};
   }
   const signature = [x, top, height, attributes, tile, base].join(':');
   entries[slot] ??= {signature, data: new Uint8Array(height * 2), rowMask: 0, stable: true,
    key: 'sprite:' + slot, slot, x, y: top, width: 8, height, tile, address: base,
    palette: attributes & 3, flipX: !!(attributes & 64), flipY: !!(attributes & 128),
    behindBackground: !!(attributes & 32)};
   const entry = entries[slot];
   if (entry.signature !== signature) entry.stable = false;
   const low = rows[at+8], high = rows[at+9], offset = address - base;
   if (entry.stable) {
    entry.data[offset] = low;
    entry.data[offset+8] = high;
    entry.rowMask |= 1 << (y - top);
   }
   // The PPU writes sprites in reverse admission order. The first opaque
   // admitted row wins; use the captured sprite plane for its actual color.
   for (let dx = 0; dx < 8 && x + dx < 256; dx++) {
    const pixel = y * 256 + x + dx;
    const bit = (attributes & 64) ? dx : 7 - dx;
    if (owners[pixel] !== 255 || !((low | high) & (1 << bit))) continue;
    if (!(snapshot.buffers.sprites[pixel] & 128)) continue;
    owners[pixel] = slot;
    coverage[slot]++;
   }
  }
 }
 for (let i = 0; i < owners.length; i++) {
  if ((snapshot.buffers.sprites[i] & 128) && owners[i] === 255) {
   return {samples: [], reason: 'Sprite-layer pixels lack corresponding admitted rows in this capture.'};
  }
 }
 const samples = entries.filter(entry => entry?.stable && coverage[entry.slot] &&
  entry.rowMask === (1 << entry.height) - 1).map(({data, rowMask, stable, signature, ...entry}) =>
  ({...entry, patternId: patternId(data, 0, data.length)}));
 return {samples, owners};
}

function samplesFor(snapshot, source) {
 let results = cache.get(snapshot);
 if (!results) {
  results = new Map();
  cache.set(snapshot, results);
 }
 if (results.has(source)) return results.get(source);
 let result;
 if (source === 'sprite-raster') result = rasterSamples(snapshot);
 else if (source === 'oam') {
  const samples = [];
  for (let slot = 0; slot < 64; slot++) {
   const entry = sprite(snapshot, slot);
   if (entry.y >= 240) continue;
   const address = spriteAddress(snapshot, entry);
   const {source: diagnosticLabel, index, ...data} = entry;
   samples.push({...data, slot, key: 'oam:' + slot, width: 8, address,
    patternId: patternId(snapshot.buffers.chr, address, entry.height * 2)});
  }
  result = {samples};
 } else if (source === 'nametable') {
  const samples = [], patterns = new Map();
  for (let y = 0; y < 480; y += 8) for (let x = 0; x < 512; x += 8) {
   const pixel = nametablePixel(snapshot, x, y);
   const address = pixel.chrAddress;
   if (!patterns.has(address)) patterns.set(address, patternId(snapshot.buffers.chr, address, 16));
   samples.push({key: 'nt:' + pixel.nametableAddress, x, y, width: 8, height: 8,
    address, nametableAddress: pixel.nametableAddress, tile: pixel.tile, palette: pixel.palette,
    nametable: pixel.nametable, alias: snapshot.meta.nametableAliases?.[pixel.nametable],
    patternId: patterns.get(address)});
  }
  result = {samples};
 } else throw Error('Unknown catalog evidence source.');
 results.set(source, result);
 return result;
}

export function catalogPick(snapshot, pick) {
 const {source, x, y, slot} = pick ?? {};
 const width = source === 'nametable' ? 512 : 256;
 const height = source === 'nametable' ? 480 : source === 'chr' ? 128 : 240;
 if (!Object.hasOwn(catalogSources, source) || !Number.isInteger(x) || !Number.isInteger(y) ||
     x < 0 || y < 0 || x >= width || y >= height) throw Error('Pick a pixel inside a supported evidence view.');
 if (source === 'chr') {
  const tile = (y >> 3) * 32 + (x >> 3), address = tile * 16;
  return {source, x: x & ~7, y: y & ~7, width: 8, height: 8, tile, address,
   palette: null, key: 'chr:' + tile, patternId: patternId(snapshot.buffers.chr, address, 16)};
 }
 const {samples, owners, reason} = samplesFor(snapshot, source);
 if (reason) throw Error(reason);
 const found = samples.find(sample => {
  if (source === 'sprite-raster') return owners[y * 256 + x] === sample.slot;
  if (source === 'oam') {
   if (slot !== undefined && slot !== sample.slot) return false;
   const pixel = spritePixel(snapshot, {...sample, index: sample.slot}, x, y);
   return pixel && !pixel.transparent;
  }
  return x >= sample.x && x < sample.x + 8 && y >= sample.y && y < sample.y + 8;
 });
 if (!found) throw Error(source === 'sprite-raster'
  ? 'No complete, stable admitted sprite at this pixel. Pick a visible sprite pixel or use OAM diagnostics.'
  : 'No matching sample at this pixel.');
 return {...found, source};
}

export function selectorFromPicks(snapshot, picks) {
 if (!Array.isArray(picks) || picks.length < 1 || picks.length > 8) throw Error('A selector needs one to eight picked pieces.');
 const samples = picks.map(pick => catalogPick(snapshot, pick));
 const anchor = samples[0];
 if (samples.some(sample => sample.source !== anchor.source) ||
     (anchor.source === 'chr' && samples.length > 1) ||
     new Set(samples.map(sample => sample.key)).size !== samples.length) {
  throw Error('Pick distinct pieces from one evidence view. CHR seeds use a single tile.');
 }
 return {
  source: anchor.source === 'chr' ? 'nametable' : anchor.source,
  pieces: samples.map((sample, i) => ({dx: sample.x - anchor.x, dy: sample.y - anchor.y,
   height: sample.height, address: sample.address, patternId: sample.patternId,
   palette: picks[i].anyPalette === true ? null : sample.palette})),
  seed: {captureId: snapshot.meta.id, frame: snapshot.meta.frame, samples}
 };
}

function matchesPiece(sample, piece) {
 return sample.address === piece.address && sample.height === piece.height &&
  sample.patternId === piece.patternId && (piece.palette === null || sample.palette === piece.palette);
}

export function catalogMatches(snapshot, entry) {
 const source = entry.selectors[0].source;
 const size = source === 'nametable' ? [512, 480] : [256, 240];
 if (entry.romDigest !== snapshot.meta.romMd5 || entry.ppuCore !== snapshot.meta.ppuCore ||
     entry.region !== snapshot.meta.region) return {source, size, instances: [], reason: 'ROM, PPU core or region differs from this catalog entry.'};
 const {samples, owners, reason} = samplesFor(snapshot, source);
 if (reason) return {source, size, instances: [], reason};
 const positions = new Map();
 for (const sample of samples) {
  const position = sample.y * size[0] + sample.x;
  if (!positions.has(position)) positions.set(position, []);
  positions.get(position).push(sample);
 }
 const instances = new Map();
 entry.selectors.forEach((selector, selectorIndex) => {
  for (const anchor of samples) {
   if (!matchesPiece(anchor, selector.pieces[0])) continue;
   const pieces = [anchor];
   for (const piece of selector.pieces.slice(1)) {
    const x = anchor.x + piece.dx, y = anchor.y + piece.dy;
    if (x < 0 || x >= size[0] || y < 0 || y >= size[1]) break;
    const options = (positions.get(y * size[0] + x) ?? []).filter(sample =>
     !pieces.includes(sample) && matchesPiece(sample, piece));
    if (options.length !== 1) break;
    pieces.push(options[0]);
   }
   if (pieces.length !== selector.pieces.length) continue;
   const key = pieces.map(piece => piece.key).join('+');
   if (instances.has(key)) continue;
   const x = Math.min(...pieces.map(piece => piece.x)), y = Math.min(...pieces.map(piece => piece.y));
   instances.set(key, {key, anchor: anchor.key, x, y, selectorIndex, pieces,
    width: Math.min(size[0], Math.max(...pieces.map(piece => piece.x + piece.width))) - x,
    height: Math.min(size[1], Math.max(...pieces.map(piece => piece.y + piece.height))) - y});
  }
 });
 return {source, size, owners, instances: [...instances.values()]};
}

function followContext(snapshot, entry) {
 const meta = snapshot.meta, movie = meta.playback?.movie;
 return [meta.session ?? meta.id.split('-').slice(0, 2).join('-'), meta.continuity ?? 'unknown',
  meta.romMd5, meta.ppuCore, meta.region, movie?.mode, movie?.guid, movie?.rerecordCount, movie?.length,
  entry.id, entry.revision].join('|');
}

export function beginCatalogFollow(snapshot, entry, instance) {
 return {context: followContext(snapshot, entry), captureId: snapshot.meta.id, frame: snapshot.meta.frame,
  instance, status: 'following'};
}

export function advanceCatalogFollow(follow, snapshot, entry, result) {
 if (follow.status !== 'following' || follow.captureId === snapshot.meta.id) return follow;
 const gap = snapshot.meta.frame - follow.frame;
 const fail = (status, reason) => ({...follow, status, reason});
 if (snapshot.meta.continuity === undefined || follow.context !== followContext(snapshot, entry) || gap < 0 || gap > 60) {
  return fail('lost', 'Capture continuity changed. Pick the instance again.');
 }
 if (result.reason) return fail('unsupported', result.reason);
 if (result.source === 'nametable') {
  const sameCell = result.instances.find(instance => instance.anchor === follow.instance.anchor);
  return sameCell ? beginCatalogFollow(snapshot, entry, sameCell)
   : fail('missing', 'The matched tile is absent from this logical nametable cell. Pick again.');
 }
 const distance = Math.min(40, 4 + gap * 2);
 const nearby = result.instances.filter(instance => Math.abs(instance.x - follow.instance.x) <= distance &&
  Math.abs(instance.y - follow.instance.y) <= distance);
 if (!nearby.length) return fail('missing', 'No visible match in the motion window. Pick again when it returns.');
 if (nearby.length !== 1) return fail('ambiguous', 'Multiple nearby matches. Pick one again.');
 if (nearby[0].key !== follow.instance.key) return fail('lost', 'The native locator changed. Pick again.');
 return beginCatalogFollow(snapshot, entry, nearby[0]);
}

export function renderCatalog(snapshot, result, instances, reuse) {
 const [width, height] = result.size;
 const rgba = reuse?.length === width * height * 4 ? reuse : new Uint8ClampedArray(width * height * 4);
 if (result.source === 'sprite-raster') {
  if (!result.owners || !instances.length) {
   rgba.fill(0);
   return rgba;
  }
  const slots = new Set(instances.flatMap(instance => instance.pieces.map(piece => piece.slot)));
  render(snapshot, 'sprites', rgba);
  for (let i = 0; i < result.owners.length; i++) if (!slots.has(result.owners[i])) rgba[i * 4 + 3] = 0;
  return rgba;
 }
 rgba.fill(0);
 const pieces = new Map(instances.flatMap(instance => instance.pieces.map(piece => [piece.key, piece])));
 const {palette, rgbPalette} = snapshot.buffers;
 for (const piece of [...pieces.values()].sort((a, b) => (b.slot ?? 0) - (a.slot ?? 0))) {
  for (let dy = 0; dy < piece.height && piece.y + dy < height; dy++) {
   const row = piece.flipY ? piece.height - 1 - dy : dy;
   const address = piece.address + (row >> 3) * 16;
   for (let dx = 0; dx < 8 && piece.x + dx < width; dx++) {
    const value = pattern(snapshot, address, piece.flipX ? 7 - dx : dx, row & 7);
    if (result.source === 'oam' && !value) continue;
    const color = palette[value ? piece.palette * 4 + value + (result.source === 'oam' ? 16 : 0) : 0] & 63;
    const offset = ((piece.y + dy) * width + piece.x + dx) * 4;
    rgba[offset] = rgbPalette[color * 3];
    rgba[offset+1] = rgbPalette[color * 3+1];
    rgba[offset+2] = rgbPalette[color * 3+2];
    rgba[offset+3] = 255;
   }
  }
 }
 return rgba;
}
