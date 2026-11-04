# Local validation

Validated on Windows x64 on 2026-11-04 with Visual Studio 18 / MSVC v145 and Node.js. Upstream base: `8cc753da0b8e6924089ed76ce6a2a93997492264`.

- **Native build:** `rea/Build-REA.ps1` completed with zero errors. One upstream DirectInput library section-attribute linker warning remains. Output is `rea/bin/fceux64.exe`, accompanied by the upstream 7-Zip and paired Lua DLLs.
- **Renderer/schema tests:** four passing tests cover packet/schema rejection, bitplane decoding, nametable attributes, transparency, OAM placement/8×16 addressing/flips, grayscale and emphasis.
- **Native integration:** the final packaged executable passed against the original generated NROM diagnostic. The test checks actual composite/background/sprite pixels, OAM position, nametable mirroring, RAM signature, bounded input, memory differences, checkpoint replay with equal RAM/screen/CPU cycle, 128 executed-opcode events, an NMI write watch, API bounds/origin/token rejection and durable evidence. Final run duration: approximately 13.4 seconds, including Windows frontend initialization.
- **Transport integration:** a passing test checks rejected producer authentication, fragmented/coalesced frames, bounded history, retained pins, expired IDs and long-poll delivery.
- **Source checks:** JavaScript syntax checks and `git -c core.whitespace=cr-at-eol diff --check` passed. Upstream source files use CRLF.
- **Browser:** completed in the Codex in-app browser after the PC restart, using one FCEUX process at a time. Pause/run, exact single-frame advance, checkpoint save/restore, all six pixel selections, memory domains/offsets/range errors, hardware bounds, 128-instruction tracing, NMI write-watch stops, empty-checkpoint error reporting, note persistence, evidence download, independent inspection freeze and a synchronized detached sprite tab passed. No browser console errors or warnings were observed.

## Completed browser validation

The final session also used the user's local `Akumajou Special - Boku Dracula-kun (Japan).nes` (FCEUX ROM MD5 `96084e640ed9a02c644b39986c269662`). Its title and opening sequence displayed distinct composite, background and evaluated-sprite rasters, plus diagnostic nametable/pattern/palette views. Frame stepping and checkpoint restore passed with this ROM. It remains local in the ignored `roms/` directory.

Three browser issues were found and corrected in `public/app.mjs`:

1. Memory offsets now refresh on input instead of relying only on the change event. The browser retest confirmed RAM offset $20 begins with `52 45 41 4E` for the diagnostic, and offset $800 reports an invalid range.
2. Selected-pixel details are recomputed when the displayed capture changes, including forced updates after frame stepping. The selected evidence ID now matches the displayed capture ID.
3. The notes panel filters by the current capture's ROM identity. Diagnostic notes no longer appear for the supplied game; a game-specific observation persisted across reload.

The downloaded diagnostic JSON contained all expected buffer lengths. Its stored annotation evidence passed SHA-256 verification. While inspection was frozen on capture `27752-540750-1-715`, native emulation advanced to frame 2940 without changing that displayed evidence. The detached sprite tab and main view both held capture `28032-782593-1-844` during the synchronization check.

Browser observations and the resolved initial memory failure are recorded in `rea/test-output/browser-checks.json`. The final screenshot is `rea/test-output/browser-interface.jpg`, showing the supplied game's title scene, hardware bounds, OAM memory and linked nametable selection at capture `28032-782593-3-1336` (frame 1685). These local test artifacts are ignored by Git.

The native file picker was unreliable through computer-use automation; the supplied ROM was therefore launched directly after closing and confirming exit of the prior FCEUX process. This did not introduce concurrent FCEUX instances. The user clarified that separate emulator types may run concurrently, with one instance of each. No other task's emulator was stopped. The final FCEUX process is paused for review.

Native startup was initially constrained by the shared desktop's foreground-window behavior and a test startup deadline that was too short. REA launches now show their initial window without requesting activation, and the integration test allows up to 60 seconds for Windows initialization. An optional `FCEUX_REA_STARTUP_LOG` path records initialization stages for diagnosis; it is unset in the normal launcher.

Generated evidence is in `rea/test-output/verified-capture.json`; the diagnostic source is `rea/make_test_rom.py`. Build products, test captures and analyst data are ignored by Git and are not automatically published.

The earlier native test closed its own instance. Following the original desktop recovery request, an explicit process check confirmed that this task had no remaining FCEUX instances. Browser testing resumed only after the user's later authorization.

These results cover the original NROM diagnostic, the supplied game's observed scenes and this Windows build. They do not certify all mappers, PAL/Dendy, new-PPU isolated layers, instruction-exact stops, automatic gameplay hitboxes, or sustained browser presentation rates. See SPEC.md for those boundaries.

## Capture performance and per-game helpers

The former bridge exported full snapshots every second emulated frame (approximately 30 Hz) and repeatedly allocated/rebuilt six canvas views. Read/write observation hooks also remained installed while idle, and the Windows frontend used elevated thread priority and CPU-0 affinity. Those paths imposed unnecessary transport, rendering, allocation and scheduling costs. This identifies avoidable work in this implementation; no system-wide trace was retained from the earlier desktop lockups.

The packaged native executable was rebuilt with demand-only exports, conditional memory hooks and normal scheduling without CPU-0 pinning. The service shares a two-per-second live-demand budget across viewers. The browser starts frozen, suspends live requests while frozen/hidden, reuses pixel buffers and caches unchanged diagnostic maps. Builds now limit worker fan-out. The native regression passed again after these changes.

With the supplied ROM, six views and game helper enabled, a 3.06-second live check recorded five live demands and seven captures including Run/Pause responses, 1,840,285 native bytes (0.573 MiB/s), about 13.8% of one CPU core for FCEUX, 29.9 MiB working set and Normal process priority. Browser draws settled at 2.5–3.2 ms after initial rendering (about 22 ms). During a separate two-second frozen check there were zero new captures, native bytes or demands. Measurements are short local observations, not a universal resource guarantee. Files: `test-output/final-capture-performance.json`, `final-frozen-performance.json` and `collision-helper-browser-checks.json`.

The final suite contains eleven passing checks: five helper tests, four renderer/schema tests, native integration, and transport integration. Native testing ran only after closing the research instance; all other helper/transport checks operate without launching an emulator. New coverage includes safe ROM/class definitions, invalid-expression rejection, observed terrain samples, exact contact boundaries, screen-edge/carry clipping, 5,000 comparisons against original local ROM instructions, shared demand throttling and authenticated helper persistence. The original ROM-dependent opcode check skips when that local ROM is absent. A separate live check confirmed Pause can interrupt a pending step and the launcher refuses a duplicate FCEUX before spawning it.

Actual game discovery and replay are documented in [research/KID-DRACULA.md](research/KID-DRACULA.md). The stage-0/type-$06 comparison rejected enemy X=144 and accepted X=142 on the next frame, reaching the real HP decrement. Checkpoint replay matched RAM, pixels and CPU cycle. The profile distinguishes verified contact windows, code-derived terrain probes and unvalidated special cases. No independent player/enemy hurt rectangles were inferred from sprite bounds.

In-app browser checks passed class filtering, overlay toggling, invalid JSON rejection without losing editor text, valid local save, persistence across reload, default frozen startup, bounded live rendering and a synchronized forced frame refresh. No browser console errors were reported. Screenshot: `test-output/collision-helper-browser.jpg`. The final review session keeps one FCEUX process paused, with inspection frozen and its helper overlay visible. Separate emulator types were left alone.
