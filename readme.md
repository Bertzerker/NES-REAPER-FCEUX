# MEGA REAPER - FCEUX

**An independent fork of [TASEmulators/fceux](https://github.com/TASEmulators/fceux), with an AI-ready NES reverse-engineering workspace.** FCEUX's authors retain their credits and copyrights. This fork adds the REA inspection service, browser interface, deterministic controls and game-specific collision helpers. It is not an official FCEUX release.

## Download NES REAPER - FCEUX for Windows

Get **NES-REAPER-FCEUX-v0.1.0-win-x64.zip** from [GitHub Releases](https://github.com/Bertzerker/MEGA-REAPER-FCEUX/releases/latest). The portable Windows 10/11 x64 package includes the modified emulator, Node runtime, REA web interface, launcher, required DLLs and licenses. No compiler, Python or npm installation is needed to run it.

1. Extract the entire ZIP to a writable folder.
2. Double-click **Launch-NES-REAPER.cmd** and select your own ROM, or drag a ROM onto the launcher.
3. Open **http://127.0.0.1:8775/** in your browser. Use Codex's in-app browser when working in Codex.
4. The game starts paused. Use **Run** / **Step frame**; **Resume inspection** enables live views capped at two updates per second.

Only one FCEUX instance is allowed. Close FCEUX to stop the local inspector. No commercial ROMs, saves or user captures are distributed.

## What this fork adds

- One NES execution with synchronized composite, background and sprite captures; diagnostic nametables, CHR patterns, palettes, OAM and memory.
- Shared local HTTP API for human and AI inspection, immutable snapshot IDs, memory differences and pixel provenance.
- Pause, bounded gamepad stepping, checkpoint replay, instruction traces, memory watches and local evidence notes.
- Editable per-ROM / object-class collision definitions and a composite overlay. The Kid Dracula Japan profile includes recovered terrain probes and replay-verified normal enemy contact; special forms and bosses need further validation.
- Demand-driven capture, normal scheduling and bounded buffers. Frozen or hidden inspection stops live polling.

[Specification](rea/SPEC.md) · [Run, build and API guide](rea/README.md) · [Game helpers](rea/HELPERS.md) · [Validation](rea/VALIDATION.md) · [Original upstream README](documentation/FCEUX-UPSTREAM.md) · [Upstream SDL build guide](documentation/README-SDL-upstream.txt)

## Build and package

From a Visual Studio C++ build-tools environment with a Windows SDK and Node.js:

```powershell
./rea/Build-REA.ps1
./rea/Start-REA.ps1 -Rom 'C:/path/to/game.nes'
./rea/Package-Windows.ps1 -Version 0.1.0
```

The build defaults to MSVC v145; pass `-Toolset v143` and `-MSBuild` as appropriate. Worker counts are capped. The packager verifies the local Windows x64 Node executable against its official checksum and includes its license. It copies only the release allowlist and tracked upstream resources, never the working saves/configuration directory. See [release packaging](rea/RELEASING.md).

## Upstream and license

Upstream base: `TASEmulators/fceux` commit `8cc753da0b8e6924089ed76ce6a2a93997492264`. Upstream history remains in this GitHub fork. FCEUX and these modifications are **GPL-2.0-or-later**; see [COPYING](COPYING). Lua, 7-Zip and Node.js retain their own licenses and notices. Releases include corresponding emulator source and the official 7-Zip source archive. Existing FCEUX functionality and credits remain available in the native application and source.
