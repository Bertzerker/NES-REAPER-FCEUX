# NES REAPER - FCEUX

Published as **NES REAPER - FCEUX**, an independent GitHub fork of `TASEmulators/fceux`. The portable **NES REAPER - FCEUX** Windows release includes the emulator, REA interface, launcher and Node runtime: [download the latest release](https://github.com/Bertzerker/NES-REAPER-FCEUX/releases/latest). See [RELEASING.md](RELEASING.md) for package contents and source.

A local GPL-2.0-or-later FCEUX modification with synchronized inspection for humans and AI clients. The complete hardware model, contracts, limitations and roadmap are in [SPEC.md](SPEC.md). Upstream base: [TASEmulators/fceux](https://github.com/TASEmulators/fceux), commit `8cc753da0b8e6924089ed76ce6a2a93997492264`. Retain upstream `COPYING` when sharing binaries or source.

Use the [sprite and tile catalog](CATALOG.md) to track selected graphics and attach exact frame evidence to comments. See [WORKBENCH.md](WORKBENCH.md) for the compact interface, availability states, comparisons, checkpoints, draft recovery and bundles. See [VALIDATION.md](VALIDATION.md) for checks and limits.

The movie toolbar supports play, pause, frame step, restart and 25–200% speed. **Pause & capture current frame** saves a composite PNG and copied memory snapshot anchored to the movie's frame and input revision. Comments support Markdown with JSON and Mermaid blocks, previews, editing, review and exports, including an annotated FM2 copy with unchanged inputs. See [MOVIES.md](MOVIES.md) for use, provenance and API contracts.

## Run on Windows

From the `fceux` directory:

```powershell
./rea/Start-REA.ps1 -Rom 'C:/path/to/game.nes'
```

Open **http://127.0.0.1:8775** in the Codex in-app browser. Use `-Port 8890` if necessary; the native bridge uses the next port. The launcher refuses to start while another FCEUX process exists, then starts one paused native FCEUX window and a local inspector. Close FCEUX or press Ctrl+C to end the session. It does not download or upload ROMs and needs no model key. Node 20+ is required; there are no npm dependencies.

The dashboard shows composite, isolated background, isolated sprites, four logical nametables, mapped CHR patterns, palettes, CPU/PPU registers and memory. Each graphics card can open separately. Click a pixel to freeze all panels on its capture and inspect provenance. `Freeze inspection` freezes the dashboard; `Pause` pauses the actual machine. `OAM bounds` shows hardware sprite rectangles. **Game collision helper** overlays ROM-specific terrain probes and gameplay contact regions in the composite. It matches the ROM digest and supports per-class selection and local JSON editing; see [HELPERS.md](HELPERS.md). The included Kid Dracula profile has a replay-verified stage-0 contact boundary.

Composite and old-PPU layer captures derive from one render execution. Nametables, pattern tables, OAM and palettes are labeled end-of-frame diagnostics: mapper/raster effects may differ from earlier fetches. The new PPU currently supplies composite only. Restoring a checkpoint invalidates graphics evidence until another frame is rendered. Normal FCEUX debugging windows remain available.

## Build and test

Visual Studio C++ build tools and Windows SDK are required; upstream bundles the native frontend dependencies. This workstation uses Visual Studio 18 with toolset v145:

```powershell
./rea/Build-REA.ps1
```

Pass `-MSBuild 'C:/path/to/MSBuild.exe' -Toolset v143` for a different installation. Output: `rea/bin/fceux64.exe`. The build also rebuilds the bundled Lua 5.1.4 core with a static CRT, retaining the upstream `lua51.dll` compatibility shim and removing the legacy MSVCR80 dependency. New bridge files and modified upstream files remain GPL-2.0-or-later. The Windows bridge is implemented; non-Windows bridge functions are no-ops.

Generate the original test ROM with the verified installed Python interpreter, then run tests:

```powershell
& 'C:/Users/Chris/AppData/Local/Python/bin/python.exe' rea/make_test_rom.py
node --test rea/test/*.test.mjs
$env:REA_NATIVE_TEST='1'
node --test --test-concurrency=1 rea/test/native.test.mjs rea/test/movie-native.test.mjs
Remove-Item Env:REA_NATIVE_TEST
```

The integration test launches the actual native build, validates known raster pixels and RAM, checks checkpoint replay, input masks, memory diff, watchpoints, trace limits, origin/control validation and persisted evidence. It closes its own emulator. Native tests require loopback connections and GUI process access. Generated ROM, captures, logs, build products and notes are ignored by Git. Launch the diagnostic using `./rea/Start-REA.ps1 -Rom ./rea/test-output/inspection-test.nes`.

## HTTP API for an AI

All routes use the local URL. Pin a snapshot first, then supply its ID on related queries so that they refer to the same moment:

```javascript
const base = 'http://127.0.0.1:8775';
const snapshot = await (await fetch(base + '/api/snapshot')).json();
const id = encodeURIComponent(snapshot.id);
const ram = await (await fetch(base + `/api/memory?snapshot=${id}&space=ram&start=0x20&length=16`)).json();
const pixel = await (await fetch(base + `/api/pixel?snapshot=${id}&view=nametables&x=80&y=80`)).json();
```

| GET | Result |
| --- | --- |
| /api/session | Connection status, capability list and local control token |
| /api/status | Producer connection, received count and retained history |
| /api/snapshot?snapshot=ID | Full JSON; buffers are hex strings; pins evidence |
| /api/history | Latest capture IDs and frame/cycle coordinates |
| /api/frame?snapshot=ID | Binary capture for one retained ID |
| /api/live?after=ID | Long-polls for the next binary capture; 204 if unchanged |
| /api/memory | snapshot, space, start, length; spaces ram/chr/nametables/oam/palette |
| /api/diff | from and snapshot IDs, plus memory range parameters |
| /api/pixel | snapshot, view, integer x/y; views composite/background/sprites/nametables/patterns/palettes |
| /api/sprites | snapshot; optional x/y for diagnostic sprite candidates |
| /api/events | snapshot; bounded events and column definitions |
| /api/annotations | Local notes with ROM identity and evidence hash |
| /api/helpers | Local ROM / class helper definitions; optional id |
| /api/overlays | snapshot; optional profile and class; exact shared helper evaluation |

RAM offsets are physical internal RAM $000–$7FF, CHR offsets are PPU $0000–$1FFF, and nametable offset zero corresponds to PPU $2000. There is no general CPU-bus inspection endpoint; no speculative reads of device registers occur. Memory lengths are 1–4096 and must fit the copied domain. Invalid ranges return 400; missing/expired snapshots return 404. The most recent 16 snapshots and the last 16 explicitly pinned snapshots are retained independently.

Controls use POST /api/control with JSON and an `X-REA-Token` header obtained from /api/session:

```javascript
const {token} = await (await fetch(base + '/api/session')).json();
async function control(body) {
  const response = await fetch(base + '/api/control', {
    method: 'POST', headers: {'Content-Type':'application/json','X-REA-Token':token},
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw Error(JSON.stringify(result));
  return result; // snapshot identifies the resulting evidence
}
await control({op:'pause'});
await control({op:'save',slot:0});
await control({op:'step',frames:3,pad0:129,pad1:0}); // A + Right
await control({op:'load',slot:0});
await control({op:'trace',limit:128}); // arm; does not resume
await control({op:'step',frames:1});
await control({op:'watch',start:0,end:0,access:2}); // CPU write watch
await control({op:'step',frames:60}); // may stop early on watch hit
await control({op:'watch',start:0,end:0,access:0});
await control({op:'run'});
```

Step accepts 1–3600 frames; gamepad masks use A=1, B=2, Select=4, Start=8, Up=16, Down=32, Left=64, Right=128. Checkpoints use slots 0–15, require pause and are in memory. Scripted stepping requires the first port to be a gamepad and the second a gamepad or disconnected. Active movie playback/recording/TAS modes reject scripted input and checkpoint operations. Watch access is read=1, write=2, execute=4, combinable. Trace supports 1–2048 instructions. **Trace/watch stops occur at the next completed frame boundary**, and events after the first hit may be included. Check the returned message and frame, rather than assuming every requested step ran.

One control request runs at a time; Pause can interrupt a pending bounded step. A timeout is an unknown execution outcome, not an instruction to retry. Inspect state before deciding what to do next. Pausing or changing core settings manually during an AI experiment can invalidate reproducibility.

Save a note using POST /api/annotations with `{snapshot,kind:'hypothesis'|'observation',text}` and the token header. It writes `rea/session/annotations.json` and an immutable SHA-256-named JSON capture. The note is associated with the captured ROM identity; it does not claim automatic verification. The dashboard's Export button also saves full JSON through the browser.

## Transport and limits

Native wire format: little-endian u32 packet length, then little-endian u32 JSON-header length, UTF-8 JSON, then raw buffers in header order. `public/inspection.mjs` defines schema 1. Native connection authenticates with a fresh 64-character launch token before snapshots are accepted. Native and HTTP listeners bind loopback. Host/Origin checking and token-protected controls protect the local service from cross-origin web requests; this is not a multi-user remote authorization system.

Capture export is on demand, limited to two live requests per second across all viewers, plus explicit command/stopping captures. The dashboard starts frozen and does no live polling while frozen or hidden. Resume inspection enables live updates; freezing the browser does not pause the game. Canvas buffers are reused and unchanged diagnostic maps are cached. Native sessions use normal thread priority without CPU-0 pinning; memory hooks are installed only while a watch is armed. Builds use at most two MSBuild workers with compiler multiprocess fan-out disabled. Socket operations never block the emulator; output and history are bounded. Raster colors reflect FCEUX's renderer and palette settings; postprocessing filters are not captured. The bridge does not implement precise fetch-bank provenance, automatic collision discovery, disk checkpoint persistence, full CPU-bus mapping, a native MCP wrapper or an embedded conversational model. See the staged specification for those extensions.
