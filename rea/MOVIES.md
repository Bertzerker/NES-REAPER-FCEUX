# Movies, TAS playback and frame comments

The REA page has a movie toolbar with **Play**, **Pause**, **Movie frame →**, **Restart movie** and speed selection from **25% to 200%** in 25% steps. Open a local FM2 after launching its matching ROM. Uploads go only to the local inspector; the original file stays unchanged. The interface loads a read-only working copy. FM2 version 3, standard gamepads / Four Score and files up to 16 MiB are supported by this loader. Other movie devices and FM3 projects can be opened through native FCEUX; verified FM2 export is limited to supported saved movies.

Native TAS Editor playback is exposed through the same controls. Browser play/step refuses recording modes, including TAS Editor recording. Use native FCEUX to edit inputs, manage TAS projects or record. Browser movie stepping consumes recorded inputs and never injects a replacement controller mask. Browser checkpoint save/restore is disabled while a movie is active. Playback stops at the end of the recorded movie. Speed sets FCEUX's throttle and turns off turbo/no-throttle; it does not change the movie inputs.

## Capture and comment

1. Play or step to the event of interest.
2. Choose **Pause & comment current frame** to stop at a completed frame and save its evidence. **Comment displayed capture** instead anchors the currently inspected capture, leaving the movie playhead alone.
3. Write an observation or hypothesis in Markdown, JSON or Mermaid. Markdown can combine prose with fenced `json` and `mermaid` blocks; insertion buttons provide templates. Use **Preview comment** to render them.
4. Save the comment. Editing its text later preserves the original evidence and frame anchor.

Each capture stores the unfiltered 256 × 240 composite PNG plus the complete exported inspection snapshot: registers, render buffers, 2 KiB internal RAM, CHR, nametables, OAM and palette. This is the existing copied inspection memory, not a full CPU-bus dump or restorable savestate. Evidence and PNG bytes have SHA-256 identities. Captures with no valid render require advancing a frame first.

The anchor records ROM identity, movie name/path/GUID, mode, input length, rerecord revision, input digest and frame. At completed frame **N**, FCEUX has consumed zero-based FM2 input record **N−1**. Frame 0 has no consumed input (`inputFrame: -1`). An explicit current-frame capture computes the in-memory input MD5; lightweight status polling does not repeatedly hash or copy the movie. Visible pages poll this small status once per second even while paused to follow native TAS controls. Frozen or hidden pages make no live render/memory capture demands; hidden pages also skip playback status requests.

**Review snapshot** freezes the graphics and memory on saved evidence without seeking the actual movie. The toolbar continues to show the actual playhead. Notes survive inspector restarts and streaming-history eviction. Filter the list to the current movie or all comments for the ROM. Up to 256 comments are stored per session; text is limited to 16,000 characters. Cancelled drafts may leave their already captured evidence on disk.

## Export and movie provenance

Each saved comment offers Markdown, JSON with copied memory and a PNG. A supported saved movie also offers **Annotated FM2 copy** when its on-disk ROM/GUID/revision/length and canonical input digest match the captured in-memory movie. The original file must still match its saved SHA-256 at export time.

The FM2 copy adds `comment REA {…}` header records containing the frame, input index, comment and evidence hashes. Every original input byte is preserved. These records document the frame without writing controller input or overwriting the source. Native TAS/recording captures remain sidecar comments because editable input revisions may not match a saved file. Save/export the TAS project as FM2 and open that saved movie read-only to obtain a verified copy export. The PNG and full memory evidence remain separate exports; FM2 comment markers contain their hashes, not their bytes. Bundle those exports when sharing evidence with another machine.

Markdown and Mermaid render locally using bundled libraries, loaded only when requested. Raw HTML is sanitized, external images are disabled, and Mermaid runs in strict mode with configuration directives disabled, at most four diagrams and 8,000 characters per diagram. JSON mode validates before saving. Rendering is separate from the live capture loop.

## API

All mutations require the session's `X-REA-Token`. Existing Host/Origin and loopback restrictions apply.

| Endpoint | Contract |
| --- | --- |
| `GET /api/playback` | Small native pause/speed/movie/frame status; shared at most once per second, no render/memory export |
| `POST /api/movie?name=example.fm2` | FM2 bytes, matching current ROM; returns paused capture ID |
| `POST /api/control` | `movie-play`, `pause`, `movie-step` with frames 1–3600, `movie-restart`, or `speed` with percent 25–200 in steps of 25 |
| `POST /api/annotations/capture` | `{}` pauses and captures current frame; `{snapshot: ID}` captures retained evidence; `{evidenceSha256: HASH}` reuses durable evidence |
| `POST /api/annotations` | `{kind, format, text, snapshot, evidenceSha256}` saves a comment against a capture |
| `POST /api/annotations/ID` | `{kind, format, text}` edits content while retaining its evidence |
| `GET /api/annotations` | Saved comments and anchors |
| `GET /api/annotations/ID/snapshot` | Full stored snapshot JSON with hex buffers |
| `GET /api/annotations/ID/json` | Comment plus full snapshot |
| `GET /api/annotations/ID/markdown` | Frame metadata and formatted comment |
| `GET /api/annotations/ID/fm2` | Annotated copy of a verified, unchanged source movie |
| `GET /api/evidence/HASH.json` or `.png` | Persisted, checksum-verified evidence |

JSON examples:

```json
{"op":"movie-step","frames":1}
```

```json
{"kind":"hypothesis","format":"markdown","text":"## Collision check\n\nInspect RAM $20 at this frame.","snapshot":"CAPTURE_ID","evidenceSha256":"CAPTURE_HASH"}
```

## Build the bundled renderers

Runtime use needs no npm install or CDN. The checked-in browser bundles and license notices are generated from the exact dependency lockfile:

```powershell
npm ci --prefix rea/vendor-build
$env:GOMAXPROCS='2'
node rea/Build-Renderers.mjs
Remove-Item Env:GOMAXPROCS
```

See `public/vendor/LICENSES.txt` for bundled dependency notices. The original NROM movie regression checks canonical input matching, PNG hashes, authoritative recorded inputs and replay of an annotated FM2 with equal RAM, pixels and CPU cycle. This does not certify every mapper, peripheral or TAS editing workflow.
