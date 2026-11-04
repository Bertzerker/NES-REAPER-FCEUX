# Per-game collision helpers

Helpers are local JSON definitions bound to exact FCEUX ROM MD5 values. They read the same copied 2 KiB RAM as the graphics capture, with no bus reads, game writes or executable profile scripts. Bundled profiles live in `rea/helpers/`; edits saved through the browser override them in `rea/session/helpers/`.

In **Game collision helper**, leave the profile on automatic ROM matching, choose an object class, and toggle the composite overlay. Expand **Edit per-game / class definition** to edit and save. **New game helper** supplies an explicitly unverified template. Replace its fields and validity conditions before using it. The editor validates before saving, reports errors and retains your text on failure.

The supplied Kid Dracula helper shows cyan terrain sample points, pink enemy origins, and orange player contact windows for the enemy classes currently present. Grey windows show that the game currently gates contact, for example during damage invulnerability. Solid geometry is code-derived or replay-verified; hypotheses are dashed. The result panel gives exact coordinates, table rows and confidence. These windows combine the player and counterpart dimensions. They are the actual region of enemy origins accepted by the comparison, rather than an inferred independent player hurt rectangle. See [the investigation](research/KID-DRACULA.md).

## Definition format

Top-level fields: `version: 1`, safe lowercase `id`, `title`, `romMd5` array, `notes`, `classes` and optional `contactRules`. Each class has `id`, `label`, `count` (1–32), `active`, `x`, `y` and `shapes`. Coordinates are NES screen pixels: use expressions to subtract camera offsets if the game's object coordinates are in world space. Use validity predicates to avoid reused RAM, off-screen pages, menus and inactive objects.

A field expression is a number, a RAM read such as `{"ram":1340}`, or an operation. RAM reads support `stride` (multiplied by the class instance index), `width` (1 or 2, little-endian) and `signed` (two's complement). Addresses refer to physical $0000–$07FF storage. Expressions use `{"op":"add","args":[...]}`; supported operations are `add`, `sub`, `mul`, `div` (floor), `mod`, bitwise `and`, `eq`, `ne`, `lt`, `gte`, `all`, `any`, lazy `select`, and `table` (literal integer array and index). These support state-dependent sizes, types, camera transforms and lookup tables without eval.

Shapes have `kind` (`point` or `rect`), `label`, relative `x` / `y` (default 0), `color` (`#RRGGBB`), `confidence` (`hypothesis`, `code-derived`, `replay-verified`), `evidence` and optional `when`. Rectangles also require `width` and `height`. Point shapes may declare `observedPc` and `probeIndex`: a matching captured execute event marks that probe observed in the event set. This does not arm a watch automatically.

```json
{
  "version": 1,
  "id": "example-game",
  "title": "Example — replace with your game",
  "romMd5": ["00000000000000000000000000000000"],
  "classes": [{
    "id": "player", "label": "Player", "count": 1,
    "active": {"op":"eq","args":[{"ram":24},3]},
    "x": {"ram":1340}, "y": {"ram":1310},
    "shapes": [{
      "kind":"rect", "label":"Unverified example",
      "x":-4, "y":-8, "width":8, "height":16,
      "color":"#ffbf69", "confidence":"hypothesis",
      "evidence":"Example only; recover the actual comparison before promoting."
    }]
  }]
}
```

The specialized, opt-in `6502-contact-window-v1` contact rule reproduces the recovered Kid Dracula comparison: a four-byte row, carry-sensitive SBC/ROR horizontal rounding, vertical SBC and optional ten-pixel trim. It is not a general NES hardware rule. `playerClass` and `targetClass` identify class entries; `row`, `carry`, `enabled`, `trimEnabled` and `trimInverted` are expressions evaluated for each target. `rows` contains raw unsigned byte tuples. `verifiedRows` plus `verifiedWhen` scope replay confidence. Unsupported lookup rows produce warnings and no fabricated geometry. Other games normally use declarative rectangle/point shapes, or require another documented pure algorithm if their collision representation cannot be described by these expressions.

Definitions are bounded to 60 KB, 16 classes, 32 shapes per class, eight contact rules and expression depth 12. Invalid memory fields, unsafe IDs, bad colors, unknown operators and oversized geometry are rejected or reported. Runtime divide-by-zero / out-of-table errors produce warnings. Custom confidence is an analyst assertion, not automatic proof.

## Shared API

- `GET /api/helpers`: full definitions; optional `?id=...` selects one.
- `POST /api/helpers`: validated JSON definition, with `X-REA-Token`; stores an override under its safe ID. No caller-chosen file path.
- `GET /api/overlays?snapshot=ID`: evaluates the matching profile against that immutable capture.
- Optional `profile=ID` and `class=player` select explicitly. A ROM mismatch returns `matched:false` with no geometry.

The browser and server use the same evaluator in `public/helpers.mjs`. Responses include the snapshot, profile, class/instance origins, shapes, confidence, source evidence and warnings. The overlay describes copied end-of-frame positions; collision code may have tested earlier positions during that frame. Instruction events and checkpoint replay supply the corresponding historical evidence. Helpers never add continuous instruction or memory tracing.
