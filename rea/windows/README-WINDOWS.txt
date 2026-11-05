NES REAPER - FCEUX
Windows x64 portable release of NES REAPER - FCEUX
https://github.com/Bertzerker/NES-REAPER-FCEUX

This project is a fork of TASEmulators/fceux:
https://github.com/TASEmulators/fceux

GET STARTED
1. Extract the ENTIRE ZIP into a writable folder. Do not run inside the ZIP.
2. Double-click Launch-NES-REAPER.cmd and choose your own local ROM.
   You can also drag a ROM onto that launcher.
3. Open http://127.0.0.1:8775/ in your browser. Open-REA-Interface.url
   is a shortcut to that address. In Codex, use the in-app browser.
4. The game starts paused; use Play / Step frame in the interface.
   Resume inspection enables live updates, capped at two per second.
5. Close FCEUX to stop the inspector. Only one FCEUX instance is allowed.

Windows 10/11 x64 is required. Node.js and the emulator dependencies are
included; no npm install, Python, compiler, model key or administrator
installation is needed. No ROMs, BIOS images, saves or user captures are included.
The FDS system may require your own BIOS image. ZIP/7z support is included.

COMMAND LINE / CUSTOM PORT
powershell -NoProfile -File .\Launch-NES-REAPER.ps1 -Rom 'C:\Games\game.nes' -Port 8890
For a custom port, open the address printed by the console.

WHAT IS INCLUDED
- Modified FCEUX Windows x64 emulator and Lua/archive DLLs.
- Portable Node.js runtime with the official license and checksum metadata.
- Local REA service, browser interface and ROM/class collision helpers.
- Documentation, upstream GPL license, third-party notices and source link.
- release-manifest.json records the source commit and shipped file hashes.

The service binds loopback only. ROM and memory data stay local. Exported
notes/helper overrides are stored under rea/session; emulator settings and
saves are stored under rea/bin. Keep the extracted folder writable.

COLLISIONS
The Kid Dracula Japan helper shows recovered terrain probes and exact combined
player/enemy contact windows. Stage-0 type-$06 contact was replay verified.
Other forms and special bosses need further validation. OAM bounds are separate
hardware rectangles. See rea/HELPERS.md and rea/research/KID-DRACULA.md.

MOVIES AND FRAME COMMENTS
Open an FM2 with the matching ROM, then use Play, Pause, Movie frame,
Restart movie and 25-200% speed. Pause & capture current frame saves the
render and copied memory with the movie frame/revision. Use Markdown,
JSON and Mermaid, preview, edit and export. Review snapshot leaves the
movie playhead unchanged. Annotated FM2 copies preserve original inputs;
TAS editing/recording remains in native FCEUX. See rea/MOVIES.md and rea/WORKBENCH.md.

SOURCE AND LICENSE
FCEUX and the REA modifications: GPL-2.0-or-later; see COPYING.
Complete corresponding source is available in the same GitHub release as
NES-REAPER-FCEUX-v0.1.0-source.zip and at the release tag in the repository.
Build instructions: rea/README.md and rea/Build-REA.ps1.
Lua, 7-Zip and Node.js retain their separate notices under licenses/.
Offline comment renderer notices: rea/public/vendor/LICENSES.txt.
