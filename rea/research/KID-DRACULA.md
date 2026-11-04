# Kid Dracula NES collision investigation

Local ROM: `Akumajou Special - Boku Dracula-kun (Japan).nes`, mapper 23, FCEUX ROM MD5 `96084e640ed9a02c644b39986c269662`. Findings apply to this revision. No ROM is included in the project. One FCEUX instance was used, paused between bounded experiments; browser inspection stayed frozen during discovery.

## Recovered fields and code

| Meaning | CPU RAM / PRG location |
| --- | --- |
| Main mode / substate | $18 / $19; playable stage uses 3 / 0 |
| Player screen origin | X $053C, Y $051E; off-screen page fields $0596 / $0578 |
| Player HP / maximum HP | $AA / $66 |
| Damage invulnerability countdown | $C0 |
| Object type / rendered image | $05C6+X / $050C+X, 18 slots |
| Object screen origin / pages | X $0548+X, Y $052A+X; pages $05A2+X / $0584+X |
| Object contact flags / row override | $07A6+X; low five bits override row |
| Terrain sample routine | fixed PRG bank 15:$E671 |
| Terrain offset tables | $E803 X, $E81B normal Y, $E833 inverted Y |
| Contact eligibility and dispatch | fixed bank 15:$E970–$E9BB |
| Player/object comparison | PRG bank 13:$BC96–$BD11 |
| Contact row selector | fixed bank 15:$E83E, indexed by type and stage; optional flag override |
| Four-byte contact rows | PRG bank 13:$BD12–$BD79 |
| Mark contact / decrement HP | bank 13:$BCF3 / fixed bank 14:$DD88 |

PRG banks here are zero-based 8 KiB banks. The game's $D5D8 routine sets the bank-pair shadow $2C and maps consecutive banks through $8FFF/$AFFF. Fixed banks 14 and 15 occupy $C000/$E000. The helper exports no speculative CPU bus contents.

Terrain collision uses sample points, not a single hardware box. Normal-form offsets 0–11 are `(4,16),(-5,16),(-8,13),(-8,0),(-8,-12),(7,13),(7,0),(7,-12),(4,-16),(-5,-16),(0,15),(0,16)`. The routine adds these signed offsets to the player position and resolves terrain/platform data. It uses a different Y table when $AD bit 7 is set. Live execute observations at $E671 confirmed foot indices 0 and 1 while standing; walking coordinate reads confirmed side indices 5, 6 and 7. The overlay shows potential probes and only marks them observed when the capture contains matching events. Other forms and special terrain paths need separate validation.

## Exact contact semantics

The enemy routine first checks visible pages, Y < $C0 and game/flag eligibility. A type lookup or flag override chooses four bytes. These encode a combined player/object comparison window. They do not uniquely identify independent player and enemy hurt rectangles.

For stage-0 enemy type $06, the lookup selects offset $10, row 4: unsigned bytes `F1 1C E4 39` (signed offsets -15 / -28; comparison limits 28 / 57). At player origin `(128,144)`, the accepted enemy-origin window is X 116–143 inclusive, Y 114–170 inclusive. The horizontal code divides both sides by two using SBC/ROR and LSR; odd origins share two-pixel buckets. A simple symmetric visual rectangle would lose that behavior. The helper preserves carries, wrap behavior, boundaries and the $B1/$AD ten-pixel trim.

At capture frame 3489, enemy slot 5 was tested at X=144: $BCC4 saw A=$FF and branched to the return at $BCDD. HP remained 3. At frame 3490 the same slot was tested at X=142, Y=144, against player X=128/Y=144: the horizontal result was 0, vertical result 26, with row offset $10. Execution reached $BCF3, marked $068C+X, and jumped from $BD0B to $DD88. A separate write watch recorded `$AA = 2` at PC $DD88; $C0 became 110. This is actual damage collision evidence.

Restoring the checkpoint before that frame and applying the same Right input reproduced identical RAM, composite pixels and CPU cycle. Compact register/event evidence and the RAM hash are in [collision-evidence.json](collision-evidence.json). Full local captures remain in ignored `rea/test-output/collision/`.

The helper's byte arithmetic was also checked against a small instruction interpreter executing the original local ROM's comparison opcodes for 5,000 bounded position/table/carry/state samples. Those checks are optional when the user's ROM is absent; no commercial opcode bytes are bundled in tests. Replay confidence is scoped to stage 0, type $06/row 4, normal orientation and the untrimmed comparison. The other recovered table rows are labeled code-derived. Special bosses, transformations and projectile-specific comparisons are not replay-certified.

End-of-frame RAM already includes movement and damage responses after comparisons. For example, the successful comparison read enemy X=142, while the capture later stored X=140. The live overlay evaluates the end-of-frame state and greys a window while invulnerability gates it. Use the recorded execution events to answer whether an earlier comparison in that frame actually hit.
