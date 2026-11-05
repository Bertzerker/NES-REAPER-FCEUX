# Independent FCEUX fork

NES REAPER - FCEUX (Windows package: NES REAPER - FCEUX) is an independent modification of [TASEmulators/fceux](https://github.com/TASEmulators/fceux), based on commit `8cc753da0b8e6924089ed76ce6a2a93997492264`. It is not an official FCEUX release. All upstream copyright and attribution notices are retained. FCEUX and the REA additions are GPL-2.0-or-later; see COPYING.

Changes dated 2026-11-04 add `src/rea.cpp` / `src/rea.h`, input/CPU/PPU/frame capture hooks, Windows startup/scheduling adjustments and build registration. The `rea/` directory contains the shared local inspection API, browser views, controls, collision helpers, validation, portable launcher and release tooling. The Lua core is rebuilt from the existing `src/lua/src` sources with a static C runtime; the upstream Lua shim is retained. Inherited workflow builds are restricted to the upstream repository to keep their release automation separate from this fork's packages. Original README content is preserved under `documentation/`.

GitHub's fork relationship and upstream history are preserved. Releases include complete corresponding emulator/REA source, the unchanged 7-Zip DLL's corresponding source and separate third-party notices. ROMs, user saves, captures, settings and credentials are excluded.
