# Where these patterns came from

Every example records its own provenance in a `source` field. This file
explains the two categories and why the distinction matters.

## Sourced (GPL-3.0)

`house/house-classic.json`, `dnb/dnb-classic.json`, `jungle/amen-break.json`

Drum grids taken verbatim from Strudel's
[`drum_patterns.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/website/src/repl/drum_patterns.mjs),
which credits [lvm/tidal-drum-patterns](https://github.com/lvm/tidal-drum-patterns)
under **GPL-3.0**.

This repository is AGPL-3.0-or-later. Combining GPLv3 work into an AGPLv3
project is explicitly permitted by AGPLv3 §13, so this is a compatible
use — but the attribution above is required and must stay.

## Hand-written (AGPL-3.0-or-later, this repository)

`techno/techno-driving.json`, `trap/trap-modern.json`,
`ambient/ambient-pad.json`, `jazz/jazz-ii-v-i.json`

There is no licensed source for these genres. Strudel's drum corpus has
no techno, trap, ambient or jazz entries — the closest are song-derived
names like `Autobahn` and `BlueMonday`, and `Blues`/`Bossa`/`Ballad`,
none of which are what we need. Every community collection found
(eefano, awesome-strudel, switchangel, and the gists) carries **no
licence at all**, and several are covers of copyrighted songs.

Strudel's own flagship tunes — caverave, flatrave, amensister — are
**CC BY-NC-SA 4.0**. The NonCommercial clause is incompatible with
AGPL, so they are unavailable to us. They are the best material out
there and we cannot have it.

## Why each file states its key and progression

The audio analysis work in #320, #321 and #352 needs a corpus to check
against. The previous 18 examples could not serve that purpose: they
were `PatternGenerator` output, so grading the analyzer against them
compared the analyzer to its own generator (#353).

Hand-writing replacements creates the same risk one step removed — if
we write patterns *and* tune the analyzer against them, it is a closed
loop with extra steps. So each hand-written file states its key and
progression explicitly, and `ExampleHarmony.test.ts` checks that the
stated progression is diatonic to the stated key using plain interval
arithmetic, with no project code involved.

That gives an independent reference: the analyzer can be wrong about
these files, and the test will still pass.
