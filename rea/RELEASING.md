# Windows releases

GitHub repository: `Bertzerker/MEGA-REAPER-FCEUX`, an actual fork of `TASEmulators/fceux`. Product name for its NES Windows package: **NES REAPER - FCEUX**. REA modifications live on the fork's `main` branch; upstream `master` and ancestry are preserved.

Build and test on Windows x64 before packaging. Keep at most one FCEUX process open; close an existing instance before the native tests. `Build-REA.ps1` builds the emulator and a static-CRT Lua 5.1.4 core from the bundled source. The upstream Lua compatibility shim is retained, including its six internal debugger/bytecode exports in `lua-portable.def`, avoiding a dependency on the legacy VC2005 runtime. MSBuild/compilation worker limits remain in place.

```powershell
./rea/Build-REA.ps1
node --test rea/test/helpers.test.mjs rea/test/inspection.test.mjs
# With no other FCEUX open:
$env:REA_NATIVE_TEST='1'
node --test --test-concurrency=1 rea/test/native.test.mjs rea/test/protocol.test.mjs
Remove-Item Env:REA_NATIVE_TEST
./rea/Package-Windows.ps1 -Version 0.1.0
```

The portable packager pins the installed Windows x64 Node version, verifies its executable against the official `nodejs.org/dist/VERSION/SHASUMS256.txt`, and includes the full matching license. It needs network access on the first packaging run for those small files; they are cached in ignored `rea/vendor-cache/`. It creates a fresh staging directory and refuses to overwrite an existing versioned archive.

The archive contains a root CMD/PowerShell launcher, URL shortcut, portable Node, the modified emulator, Lua/archive DLLs, UI/service, helper definitions, instructions and licenses. It copies an explicit allowlist plus tracked upstream resources. It rejects ROMs, saves, sessions, logs, configuration and debug artifacts in the package. The launcher supports a ROM argument, drag-and-drop, or a local Windows file picker. It prints the interface URL; it does not choose or launch a browser for the user.

`release-manifest.json` records the source commit, Node version/hash and every shipped file's SHA-256. Test an extracted ZIP with `rea/test/package-smoke.mjs`; it uses the bundled Node through the launcher, verifies native/API/checkpoint behavior and duplicate-instance rejection, then closes only its own FCEUX. Also run `rea/test/portable_lua.py EXTRACTED_PACKAGE` with an installed Python interpreter: it verifies the manifest, loads the actual Lua shim/core through the OS loader and executes a Lua assertion. Startup alone does not exercise delayed Lua DLL imports. No supplied commercial ROM is included. Use the original generated diagnostic for the native package test.

Publish together:

- `NES-REAPER-FCEUX-vVERSION-win-x64.zip`
- `MEGA-REAPER-FCEUX-vVERSION-source.zip`, created by `git archive` from the exact release commit
- `7z1900-src.7z`, the official corresponding source for the unchanged 7-Zip 19.00 DLL
- `SHA256SUMS.txt`

Preserve `COPYING`, upstream credits and the source tree. The inherited Qt/macOS/Linux workflow build jobs are scoped to the upstream repository so they do not publish unrelated upstream-style artifacts into this fork's Windows releases. Do not upload `roms/`, `rea/session/`, `rea/test-output/`, build caches, personal configuration or credentials.
