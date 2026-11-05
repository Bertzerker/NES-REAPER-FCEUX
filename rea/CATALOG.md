# Sprite and tile catalog

The catalog is separate from the per-game collision profiles. A catalog entry describes a sprite pattern, a group of nearby sprite pieces, or mapped background tiles. The catalog stores local JSON under `rea/session/catalogs/`, scoped to the FCEUX ROM MD5, region and PPU core. Use the same ROM and core when reusing an entry.

## Build a catalog

1. Open **Sprite & tile catalog**. For raster sprites on the old PPU, select **Enable admitted sprite capture**, then render a frame with **Step frame** or **Play**.
2. Click a pixel in **Sprites** or **Composite**, or use **Inspect pixel** with coordinates. The selection pins the exact capture. In Composite, sprite selection uses the sprite layer at those coordinates. Choose **OAM / mapped CHR diagnostic** to inspect copied OAM, optionally narrowing the pick to a slot.
3. For tiles, pick a **Nametables** cell. A **CHR patterns** pick can also seed a mapped tile selector with any palette. The result is shown in the 512×480 logical nametable atlas with table aliases, even if a mapper maps multiple tables to the same storage.
4. For groups, use **Add picked piece to group** on each piece in the same capture. Pick the anchor first and review the group before saving. Give the entry a name and select **Add to catalog**. As you encounter an animation variant, select the entry, pick the new frame or group, then select **Append animation selector**.
5. Search by name, label or notes. **Evidence selectors** shows the stored pattern fingerprints, logical CHR addresses, palette constraints and relative positions. **Reload catalog** picks up local edits. **Catalog JSON** exports the current definition to a text field and imports a scoped replacement. A stale write is rejected, with a prompt to reload.

## Isolate and attach

**Show all matches** displays the matching samples in native sprite coordinates or logical tile cells. Choose a match from the list and select **Follow instance**, or click an isolated match. Select **Resume inspection** or **Return to live** to update the follow as the machine plays. For sprite matches, a gap of up to 60 frames is allowed, with a motion window of 4 pixels plus 2 per elapsed frame, capped at 40 pixels on each axis. A single nearby candidate must retain its native group locators. A tile follows its selected logical nametable cell. A missing or ambiguous sample, a changed locator, a reset, a loaded state, a playback restart or another discontinuity requires an explicit re-pick.

With a matched occurrence selected, use **Attach to comment**. The editor opens against that capture even if the live game or FM2 advances. Save a Markdown, JSON or Mermaid comment with the render and copied memory. **Review snapshot** reopens the saved frame and original entry revision, including its label, selector definition and matched bounds. The live playhead can continue independently. JSON and investigation ZIP exports include the immutable observation. The ZIP lists its SHA-256 alongside the saved evidence. A verified read-only FM2 export keeps its input rows byte-for-byte and adds the attachment hash to the annotated header.

## Evidence and limits

- The old PPU observer records the sprite rows actually admitted by FCEUX and the low and high pattern bytes it fetched. Isolated colors come from the captured sprite raster. The view attributes winning sprite-layer pixels for stable, completely sampled sprites. It excludes partially covered samples and does not resolve sprite-versus-background ownership in Composite. Coverage overflow or inconsistencies make the raster result unavailable.
- The old PPU observer is opt-in and uses a fixed 19,440-byte capture field. The shared live request cap remains 2 Hz. Raster sample collection stops on native disconnect. New PPU captures can use the labeled OAM and mapped CHR diagnostics.
- OAM, nametables and CHR diagnostics use copied mapped memory at the frame boundary. Their addresses are logical PPU addresses. A pattern fingerprint checks content at a logical address. It cannot identify a physical mapper bank when the fetched content is identical. Nametable positions are atlas cells. Native sprite slots can be reused, and identical content at the same position between captures cannot establish software entity continuity or gameplay collision bounds.
- Catalog selectors do not issue controller input or modify ROM data, movie inputs or savestates. Catalog attachments do not create a full CPU-bus dump or a restorable snapshot.

## Local validation

Generate the original diagnostic with the installed Python interpreter and `rea/make_test_rom.py --catalog`. Build with `./rea/Build-REA.ps1`. With no FCEUX process open, run `REA_NATIVE_TEST=1` (set `$env:REA_NATIVE_TEST='1'` in PowerShell) and `node --test --test-concurrency=1 rea/test/catalog-native.test.mjs`. The test uses one isolated native instance. Optional `REA_TEST_WINDOW_X` and `REA_TEST_WINDOW_Y` values set its startup position. Results are written to the ignored `rea/test-output/catalog-native-validation.json`.
