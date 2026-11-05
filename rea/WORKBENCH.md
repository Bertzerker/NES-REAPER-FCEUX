# NES REAPER workbench

The compact REA page uses one **Play / Pause / Step frame / Speed** toolbar for the live machine. Movies, comments, sixteen checkpoints, execution, collision helpers and performance live in the lower tabbed drawer. Inspector labels are at least 12 px, body text is 14 px and keyboard focus is visible. At narrow widths the page starts with focused Composite; the view selector exposes the other captures and diagnostics. Fit, 1× and 2× scaling preserve nearest-neighbor source pixels; Fit can use fractional scaling.

## Machine and evidence are independent

The **Live machine** label follows native FCEUX, including TAS Editor mode and recording. **Evidence: LIVE / FROZEN / SAVED** identifies the capture driving graphics, pixel details, registers, memory, helpers and captured execution events. The capture ID, frame, age and render validity remain visible. Older evidence may have no capture timestamp; its age is explicitly unknown. Producer loss marks held evidence stale. Saving or inspecting evidence does not restore the machine.

Click a pixel, use canvas arrow keys, or enter View/X/Y and choose **Inspect pixel** to freeze and pin one evidence context. Failed pinning remains visible. **Return to live** explicitly leaves archived review. A saved comment reopens its evidence after streaming/pinned history eviction. Live command outcomes and archived execution events have separate labels.

Controls explain why they are unavailable when disconnected, busy, recording, incompatible or waiting for a rendered frame. Pause can interrupt a bounded step. Timeouts have an unknown outcome: no automatic control retry occurs; status requery or Pause resolves the machine state. `/api/session` reports producer connection, pending commands, unknown state, launch token, native state and bounds. A status request does not copy render/memory buffers.

## Checkpoints, comparisons and execution

The Checkpoints drawer lists slots 0–15 with empty/occupied state and captured frame. They are in-memory machine states in one native process, cleared by reset/ROM change or exit. Restore requires pause, no movie/TAS mode, and the same PPU core/region. These are separate from native disk save states and non-restorable inspection exports.

**Pin baseline** retains a named explicit capture. Memory comparison shows both IDs, changed byte values and the domain-relative addresses. Switching memory domains keeps the same comparison pair. Different ROMs/native sessions are rejected. The browser holds copied baseline bytes; pinning checks server evidence before selecting a live baseline.

Execution exposes 1–3600 frames, both gamepad masks, a 1–2048 instruction trace budget and inclusive CPU watch ranges with Read/Write/Execute combinations. Actual requested/completed frames and the stop reason are reported by the native bridge. Stops occur at a **completed-frame boundary**, not exactly at the observed instruction. Events are bounded to 2,048; the UI identifies dropped events and its last-80-event display limit.

## Comments and investigation bundles

Comments support local per-tab draft recovery, explicit discard and recovery of a copy from another local draft. An edit sends the saved numeric text `revision`. A stale edit returns HTTP 409 with the latest comment; its draft and immutable evidence stay intact. The editor offers loading the latest text or keeping the draft as a new comment. Other tabs are notified without overwriting their editor.

Each note has Markdown, JSON+memory, PNG and **Evidence bundle** exports. Newly verified FM2 captures archive the exact original movie bytes by SHA-256. Movie bundles include all comments for that verified input revision, original and annotated FM2, full copied evidence JSON, PNGs, Markdown and `manifest.json` with file sizes/hashes. They survive inspector restart and source-path changes. The ZIP contains no ROM and is bounded to 64 MiB. Older pre-archive notes can use the unchanged original file; recapture a supported saved movie to gain path-independent archival. Native TAS/recording notes keep sidecar evidence rather than claiming a verified saved movie.

`POST /api/annotations/ID` now requires `{revision, kind, format, text}`. `GET /api/annotations/ID/bundle` downloads the ZIP. Existing read routes remain available. See [MOVIES.md](MOVIES.md).

## Native tools and focused windows

Movies contains recording/TAS guidance plus whitelisted open/focus requests for TAS Editor, debugger, PPU viewer, nametable viewer and hex editor. These pause the live machine. Native tools inspect their own live state, not a frozen browser capture. `POST /api/control` accepts `{op:"native-tool",tool:"tas-editor"}` (also `debugger`, `ppu`, `nametables`, `hex`). `movie-stop` stops FM2 playback while paused; recording and TAS projects must be finished/closed through native FCEUX.

A `?view=composite` popout has one graphics card and relevant evidence/memory inspection controls. It owns an independent live/frozen context, explicitly labeled; it does not silently follow the main tab. The investigation drawer, including collision editing, is hidden there.

## Performance and limits

The observer remains demand-driven at **maximum 2 live captures/s shared across viewers**. Frozen/hidden views issue no live graphics requests. Visible status requests are shared at most once per second and carry small metadata; hidden pages skip them. Preview libraries load only when used. Performance separates sampled machine frames/s, native capture rate, displayed unique evidence rate, native bytes and draw cost. These figures do not imply 60 Hz browser presentation.

Diagnostic nametables/CHR/palettes remain end-of-frame memory reconstructions. Isolated raster layers require the old PPU and a valid render. ROM/class collision profiles retain their confidence and evidence; hardware sprite bounds do not become verified gameplay hitboxes.
