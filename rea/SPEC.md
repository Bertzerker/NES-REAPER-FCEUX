# FCEUX REA: AI-assisted NES reverse-engineering environment

Status: working Windows implementation with a staged roadmap. Upstream base: TASEmulators/fceux `8cc753da0b8e6924089ed76ce6a2a93997492264`. License: GPL-2.0-or-later; retain upstream COPYING and file notices.

## Purpose

The system must let a human or AI move from an observed behavior to the graphics state, memory changes, and executed instructions responsible for it, then reproduce and test that explanation.

Run one emulated NES. Both the human dashboard and AI clients consume one inspection API. Every finding refers to an immutable capture identifier, ROM identity, frame, cycle, address domain, and evidence source. Never run separate instances for isolated visual layers: different instances can diverge, and changing the emulated PPU's rendering flags can affect game behavior.

The implementation is local. No AI provider, API key, ROM upload, or hosted service is required. AI assistance means providing usable evidence and controls to an agent; it does not mean embedding an unsupported automatic game-understanding claim.

## NES hardware model

| Concept | NES-specific meaning |
| --- | --- |
| Composite | 256 × 240 raster produced by the selected FCEUX PPU core, before OSD, cropping, scaling or display filters |
| Background | One hardware background made from nametable tile indices, attribute palettes, CHR patterns and scroll state |
| Sprites | Up to 64 OAM entries. Each is 8 × 8 or 8 × 16; games combine entries into larger objects |
| Nametables | Four logical 32 × 30 maps at $2000–$2FFF, usually backed by 2 KiB CIRAM; mapper mirroring determines aliases. They are areas of the background map, not four independent layers |
| CHR | Two mapped 4 KiB pattern-table regions; 512 8 × 8 two-bit patterns. Data may be ROM, RAM, bank switched, or mapper-specific |
| Palettes | 32 mapped palette bytes, with universal-color mirrors and transparency rules. Color emphasis and grayscale affect output |
| Priority | Sprite/background priority is not a second background layer. OAM priority and the scanline evaluation limit affect visibility |
| CPU | Ricoh 2A03/2A07, 6502-derived. CPU bus, physical RAM, cartridge mappings and PPU space are distinct address domains |

The NES has no Genesis Plane A, Plane B or Window plane. A game can simulate foreground/background roles through tile art, sprite priority, scrolling and raster changes; those roles are game semantics.

There is no general CPU collision opcode. PPUSTATUS sprite-zero hit describes a qualifying sprite-0/background pixel overlap, with clipping and timing restrictions. Sprite overflow describes evaluation behavior, including hardware quirks. Neither supplies gameplay hitboxes, object identities, damage rules, terrain collision, or all colliding pairs.

Three overlay categories must remain distinct:

1. **Hardware bounds:** OAM rectangles, labeled with their sampling moment. Implemented as an optional diagnostic overlay.
2. **Hardware rendering events:** sprite-zero hit, evaluated/dropped sprites, overlap candidates. Status byte is exported; detailed raster event provenance is a future stage.
3. **Game collision geometry:** discovered from code/data or supplied by a ROM-scoped helper. Declarative point/rectangle helpers and a recovered contact comparator are implemented. Never relabel hardware rectangles as verified hitboxes.

Hardware behavior is grounded in the checked-out core: [PPU renderer](https://github.com/TASEmulators/fceux/blob/8cc753da0b8e6924089ed76ce6a2a93997492264/src/ppu.cpp), [tile fetch](https://github.com/TASEmulators/fceux/blob/8cc753da0b8e6924089ed76ce6a2a93997492264/src/pputile.inc), [CPU](https://github.com/TASEmulators/fceux/blob/8cc753da0b8e6924089ed76ce6a2a93997492264/src/x6502.cpp), [mapping](https://github.com/TASEmulators/fceux/blob/8cc753da0b8e6924089ed76ce6a2a93997492264/src/cart.cpp). These are implementation references, not a claim that every FCEUX hardware approximation is perfect.

## One machine, synchronized views

| View | Current source and semantics |
| --- | --- |
| Composite | Copies XBuf and XDBuf immediately after FCEUPPU_Loop and before Lua after-frame/OSD drawing. Colors use the core's 512-entry palette and per-pixel emphasis |
| Background | Copies the old PPU's rendered scanline before CopySprites; preserves scroll/CHR/palette changes already represented by that renderer |
| Sprites | Copies the old PPU's evaluated sprite scanline; preserves selected nontransparent sprite colors independently of sprite/background priority; respects sprite enable and left clipping |
| Nametables | Reconstructs all four logical maps from copied mapper-backed nametable pages and current CHR; exposes alias indices |
| Patterns | Decodes the 8 KiB currently mapped CHR view once; displayed with background palette 0 |
| Palettes | Displays captured palette RAM and RGB mapping |
| Memory | Shows copied CPU RAM, CHR, nametables, OAM or palette, with changes against the preceding displayed capture |
| Registers | CPU PC/A/X/Y/SP/P and PPUCTRL/MASK/STATUS/OAMADDR/v/t/fine-X from the same capture |
| Execution | Bounded trace/watch events with CPU address, access, value, instruction PC, cycle and register context |

The default dashboard displays all graphics views and memory together. Each view has a separate-window link. Separate windows follow the same capture stream independently; to compare exactly across windows, pin an explicit snapshot through the API. A frozen dashboard holds all panels on one capture.

Captured layers are observations of the core's own render path, not repeated emulation with layers disabled. They retain the accuracy limitations and user rendering options of that core. The new PPU has composite capture but does not have the layer tap: isolated raster views explicitly become unavailable. NSF and skipped/startup frames may also lack complete raster evidence. A restored checkpoint invalidates screen/layer evidence until the next rendered frame; stale output must not be presented as a new observation.

Nametables, CHR and OAM are **end-of-frame diagnostic reconstructions**. They must never be presented as exact raster-time ownership of a selected composite pixel. Mid-frame bank changes, MMC5 separate BG/sprite CHR, extended attributes, latch-controlled fetches and other mapper behavior can make these diagnostics differ from what was fetched earlier. Directly copied mappings must not invoke mapper read hooks.

## Architecture and capture boundary

```text
FCEUX emulation thread
  ├─ input override for bounded gamepad experiments
  ├─ old-PPU background/sprite scanline taps
  ├─ bounded CPU execution/read/write observation
  └─ after-PPU coherent capture
       → nonblocking authenticated loopback TCP producer
       → Node inspection service / bounded snapshot history
            ├─ browser dashboard and detachable views
            ├─ documented HTTP evidence/control API
            └─ local annotation + hashed evidence files
```

State is copied on the emulation thread, never read concurrently by the server. There are no CPU bus or PPU register reads during inspection: reading a UI field must not clear PPUSTATUS, advance PPUDATA, acknowledge an interrupt, strobe a controller, trigger a mapper latch, or log fake game activity.

The bridge is opt-in through FCEUX_REA_PORT and a fresh FCEUX_REA_TOKEN. Without both, no bridge socket, capture copying or memory hooks are installed. The current supported bridge target is the native Windows x64 frontend; other platform builds compile no-op bridge functions. CMake includes the bridge source so upstream frontends remain linkable; Linux/macOS behavior is not validated.

Capture export is demand-driven: the server requests at most one live snapshot per 500 ms across all viewers; command results and stops force an additional capture. No client demand means no automatic exports. The dashboard starts frozen, skips live polling while frozen or hidden, reuses ImageData/RGBA allocations and caches unchanged diagnostic renders. Scanline taps retain only fixed-size latest-frame buffers. Read/write hooks exist only while armed; opcode observation exits immediately when tracing/watching is inactive. REA sessions run at normal priority without CPU-0 affinity. Native output queues, input parsing, HTTP bodies and histories are bounded. The launcher and native test refuse a second FCEUX instance. Builds cap MSBuild workers at two and disable compiler multiprocess fan-out.

## Capture identity and data model

A snapshot is immutable and has a process/session identifier, ROM-change/restore epoch and monotonically increasing sequence. Frame and cycle are coordinates, not unique IDs: restoring a checkpoint can reuse both. FCEUX's ROM MD5 is a compatibility identity, not a security hash. Durable evidence uses SHA-256 of the exact exported JSON.

Each snapshot records schema version, ROM MD5, region, CPU cycle, frame, pause state, capture point, selected PPU core, screen/raster validity, registers, mapper nametable aliases, bounded events, and these copied buffers:

| Domain | Bytes | Address semantics |
| --- | ---: | --- |
| screen, emphasis | 61,440 each | Core palette-index raster and emphasis index, row-major |
| background, sprites | 61,440 each | Captured old-PPU scanlines; sprite bit 7 is opacity, background bit 6 is core transparency |
| lineMasks | 240 | PPUMASK sampled at each scanline composition point |
| rgbPalette | 1,536 | Core palette: 8 emphasis combinations × 64 colors × RGB888 |
| ram | 2,048 | Physical internal CPU RAM, offsets $000–$7FF; CPU bus mirrors are not duplicate storage |
| chr | 8,192 | Current PPU pattern mapping $0000–$1FFF |
| nametables | 4,096 | Logical PPU $2000–$2FFF, mirroring already applied |
| oam | 256 | Primary OAM entries; four bytes each |
| palette | 32 | Core rendering palette RAM, not PPUDATA readback. FCEUX keeps special unused palette readback bytes separately |

No general CPU bus read endpoint is exposed. Cartridge PRG/WRAM and physical bank identities require future typed domains; filling unknown bus regions with zero would fabricate evidence.

## Shared inspection and control API

GET operations are read-only. Explicit snapshot requests pin their result in a 16-entry retained evidence pool, independent of the latest 16 streaming snapshots. Expiration returns 404. In-memory checkpoints and snapshots are lost at process exit; exported evidence and annotations persist.

| Operation | Implemented contract |
| --- | --- |
| capture_state | GET /api/snapshot; optional snapshot ID; JSON with hex buffers |
| read_memory | GET /api/memory with snapshot, space, start, length (1–4096, must fit domain) |
| find_memory_changes | GET /api/diff with from, snapshot and same range parameters; disallows different ROMs |
| inspect_pixel | GET /api/pixel with snapshot, view, x, y; captured color or explicit diagnostic CHR/nametable/palette provenance |
| inspect_sprite | GET /api/sprites with snapshot; optional x/y returns reconstructed sprite candidates, not asserted captured ownership |
| execution_evidence | GET /api/events with snapshot; event columns and frame-boundary stop semantics |
| pause / resume | POST /api/control op pause / run; acknowledgment includes coherent capture ID |
| frame step / scripted input | POST op step, frames 1–3600, pad0/pad1 bitmasks; returns after execution completes or watch/trace stops it |
| save_checkpoint | POST op save, slot 0–15; requires paused emulator and no active movie |
| restore_checkpoint | POST op load, slot 0–15; remains paused, changes evidence epoch, invalidates raster until next frame |
| trace_execution | POST op trace, limit 1–2048; arms an instruction event budget; run/step separately |
| watch_memory | POST op watch, CPU start/end $0000–$FFFF, access bits read=1/write=2/execute=4; access=0 disables |
| annotations | GET/POST /api/annotations; kind observation or hypothesis, text, explicit snapshot; persists ROM identity and SHA-256 capture evidence |

Controls are serialized, except that Pause may interrupt a bounded step, and require X-REA-Token. /api/session supplies the local token to same-origin clients. Both ports bind 127.0.0.1; HTTP Host/Origin are checked and no cross-origin access is enabled. Native producer connection requires the launch token. There are no arbitrary file path, memory-write, shell execution or ROM-upload endpoints.

An AI should first pin a snapshot and reuse its ID for all related reads. A series of requests without explicit IDs follows live time and is not a coherent multi-query experiment.

## Deterministic experiments

The current experiment unit is a **frame**. Trace and watch hits record instruction-level evidence, then stop execution at the first completed frame boundary. Do not claim instruction-exact stops: additional instructions and writes can occur after the recorded hit. Events are bounded to 2,048 and overflow is explicit.

Standard gamepad experiments inject input after device polling and before movie input processing. Mask order is A=1, B=2, Select=4, Start=8, Up=16, Down=32, Left=64, Right=128. The native window's next ordinary poll restores user input after the bounded experiment. Nonstandard input devices and active movies are rejected for scripted stepping; the first controller must be a gamepad, the second may also be disconnected. Pause/step must be owned by one controlling client during an experiment.

Replay protocol:

1. Pause at a frame boundary and save slot N.
2. Pin evidence before the experiment.
3. Execute a bounded run with explicit gamepad masks.
4. Pin the resulting memory, output and execution evidence.
5. Restore slot N; repeat exactly the same input segments.
6. Compare captured CPU cycles, RAM, graphics buffers and relevant registers.

Determinism is conditional on the same ROM, core build, PPU mode, region, mapper, cheats, overclock options, peripheral configuration and external activity. Checkpoint replay is validated using the supplied original NROM diagnostic. It is not certification for every mapper, FDS media, RTC/peripheral, movie mode or FCEUX configuration. Durable experiment manifests, environment fingerprints, automatic replay comparisons and disk checkpoint catalogs are roadmap work.

## Pixel-to-code provenance roadmap

The desired evidence chain is:

```text
selected captured pixel
 → raster-time background tile or evaluated OAM slot
 → CHR byte pair + palette + mapper physical bank at fetch time
 → CHR-RAM upload / bank-select / OAM-DMA source and producing instruction
 → candidate object fields and game routine
 → replayed experiment confirming the proposed relationship
```

Current diagnostic selection exposes nametable/attribute/tile/CHR/palette addresses and reconstructed OAM candidates. Watch/trace captures can separately observe CPU writes to $2000–$2007, $4014, RAM and bank-control addresses. These are evidence building blocks, not an automatically joined upload-to-object provenance graph. CPU DMA reads/writes appear only to the extent the existing core memory hooks observe them; opcode-fetch reads can precede the instruction callback and must not be treated as data reads by the preceding instruction.

Future renderer instrumentation must record per-pixel owner, fetch-time bank identity and timestamped register/mapping changes from both PPU cores. It must preserve sprite evaluation/drop behavior, mid-frame OAM changes, priority and clipping. For unsupported mapper fetch semantics, return unknown instead of inventing a source.

## Collision adapters and AI knowledge

An adapter should be keyed by ROM digest/revision, mapper, region and relevant game state. It defines candidate object arrays, field widths/signs, coordinate transforms, camera offsets, active flags, terrain formats and box sources. Labels must include evidence and validity conditions; reused RAM must not inherit stale object identities.

Example investigation: “Why did the player take damage?”

1. Checkpoint before contact; replay the same approach.
2. Identify candidate health/damage RAM changes by comparison.
3. Arm a write watch; replay and inspect responsible instructions.
4. Trace comparisons and position/table reads around the observed routine.
5. Annotate a hypothesis with candidate geometry and source addresses.
6. Test nearby positions or input sequences and compare results.
7. Only mark geometry verified when a replayable experiment supports the declared conditions.

Implemented helpers use exact ROM identities, per-class activation/position expressions, points/rectangles, explicit confidence/evidence and a shared pure evaluator for browser/API overlays. Local JSON edits are bounded and authenticated. The supplied Kid Dracula adapter recovers terrain probes and exact per-counterpart collision windows, with a replay-verified stage-0/type-$06 boundary and other rows labeled code-derived. See [HELPERS.md](HELPERS.md) for schema/API and [research/KID-DRACULA.md](research/KID-DRACULA.md) for evidence and limits. These combined windows do not imply independently recovered player/enemy hurt rectangles. Current notes deliberately support only observation and hypothesis. Automatic collision discovery, object grouping, automatic confidence promotion, a native MCP server and a conversational model UI are not implemented. The HTTP API is immediately usable by an external agent with local tool access; no changes to the installed REA plugin are made.

## Delivery and acceptance

| Stage | State | Exit criteria |
| --- | --- | --- |
| 1: shared inspection | Implemented | Native build, synchronized dashboard, detached view links, memory/diff API, provenance labels, bounds overlay |
| 2: controlled experiments | Implemented, frame granularity | Pause/step, gamepad injection, 16 memory checkpoints, bounded trace/watch, replay validation |
| 3: durable analyst evidence | Implemented baseline | Notes persist alongside SHA-256 exported snapshots; no unsupported verification claims |
| 4: exact fetch provenance | Planned | Per-pixel source from both PPU cores and supported mappers, physical bank identity, upload/DMA linkage |
| 5: semantic adapters | Implemented baseline | ROM/class definitions, bounded expressions, composite overlays, API/editor, and one game contact replay; further game coverage remains open |
| 6: deeper agent workflow | Planned | Versioned MCP wrapper, environment-bound experiment manifests, instruction/cycle stops, richer search/disassembly integration |

Required checks for the delivered baseline:

- Build the modified native FCEUX executable with the available Visual Studio toolchain.
- Validate decoding of bitplanes, attributes, transparency, palette emphasis, 8 × 16 sprites, flips and OAM Y offset.
- Run an original diagnostic ROM; validate known background/sprite colors, OAM placement, mirroring and RAM signature against actual captures.
- Restore a checkpoint and replay equal input sequences; compare RAM, screen and CPU cycle results.
- Observe a real NMI memory write and collect the exact requested instruction trace budget.
- Reject out-of-range memory/pixel reads, unauthenticated controls and cross-origin requests.
- Validate protocol fragmentation, invalid packet limits, expiration and pinned evidence retention.
- Exercise the browser dashboard against the running native producer and inspect a linked pixel.

Remaining test breadth: PAL/Dendy, new-PPU composite behavior, commercial mapper/raster test suites, disabled-instrumentation regression/performance benchmarks, very slow clients and long sessions. Do not infer those guarantees from the NROM diagnostic.
