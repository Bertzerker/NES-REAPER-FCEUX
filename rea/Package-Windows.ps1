# SPDX-License-Identifier: GPL-2.0-or-later
param([ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version='0.3.0',[string]$NodeExe)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if((& git -C $root status --porcelain --untracked-files=normal)){throw 'Commit source changes before packaging so the source manifest identifies the complete release.'}
if(!$NodeExe){$NodeExe=(Get-Command node -ErrorAction Stop).Source}
$nodeVersion=(& $NodeExe -p 'process.version').Trim()
if($nodeVersion -notmatch '^v\d+\.\d+\.\d+$' -or (& $NodeExe -p 'process.arch').Trim() -ne 'x64' -or (& $NodeExe -p 'process.platform').Trim() -ne 'win32'){throw 'An official Windows x64 Node.js executable is required.'}
$cache=Join-Path $PSScriptRoot 'vendor-cache';$dist=Join-Path $root 'dist'
New-Item -ItemType Directory -Force $cache,$dist | Out-Null
$sums=Join-Path $cache "node-$nodeVersion-SHASUMS256.txt";$license=Join-Path $cache "node-$nodeVersion-LICENSE.txt"
if(!(Test-Path -LiteralPath $sums)){Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/SHASUMS256.txt" -UseBasicParsing -OutFile $sums}
if(!(Test-Path -LiteralPath $license)){Invoke-WebRequest "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -UseBasicParsing -OutFile $license}
$checksumLine=@(Get-Content -LiteralPath $sums | Where-Object {$_ -match '\s+win-x64/node\.exe$'})
if($checksumLine.Count -ne 1){throw 'Official Node checksum is missing.'}
$expected=($checksumLine[0] -split '\s+')[0];$actual=(Get-FileHash -LiteralPath $NodeExe -Algorithm SHA256).Hash.ToLowerInvariant()
if($actual -ne $expected){throw 'Node executable does not match its official SHA-256.'}
$archive=Join-Path $dist "NES-REAPER-FCEUX-v$Version-win-x64.zip"
if(Test-Path -LiteralPath $archive){throw "Archive already exists: $archive"}
$stage=Join-Path $dist ('staging-'+[guid]::NewGuid().ToString('N'));$package=Join-Path $stage 'NES-REAPER-FCEUX'
New-Item -ItemType Directory -Force (Join-Path $package 'runtime'),(Join-Path $package 'licenses'),(Join-Path $package 'rea/bin'),(Join-Path $package 'rea/public'),(Join-Path $package 'rea/helpers'),(Join-Path $package 'rea/research') | Out-Null
function Copy-ReleaseFile([string]$from,[string]$to){Copy-Item -LiteralPath (Join-Path $root $from) -Destination (Join-Path $package $to)}
foreach($name in @('fceux64.exe','lua51.dll','lua5.1.dll','7z_64.dll')){Copy-ReleaseFile "rea/bin/$name" "rea/bin/$name"}
foreach($name in @('server.mjs','annotations.mjs','evidence.mjs','bundle.mjs','package.json','Start-REA.ps1','README.md','SPEC.md','HELPERS.md','MOVIES.md','WORKBENCH.md','VALIDATION.md')){Copy-ReleaseFile "rea/$name" "rea/$name"}
foreach($name in @('app.mjs','workbench.mjs','comments.mjs','helpers.mjs','inspection.mjs','index.html','style.css')){Copy-ReleaseFile "rea/public/$name" "rea/public/$name"}
New-Item -ItemType Directory -Force (Join-Path $package 'rea/public/vendor') | Out-Null
foreach($name in @('markup.mjs','mermaid.mjs','LICENSES.txt')){Copy-ReleaseFile "rea/public/vendor/$name" "rea/public/vendor/$name"}
foreach($item in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'helpers') -Filter '*.json' -File){Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $package 'rea/helpers')}
Copy-ReleaseFile 'rea/research/KID-DRACULA.md' 'rea/research/KID-DRACULA.md'
Copy-ReleaseFile 'rea/research/collision-evidence.json' 'rea/research/collision-evidence.json'
foreach($name in @('Launch-NES-REAPER.cmd','Launch-NES-REAPER.ps1','Open-REA-Interface.url')){Copy-ReleaseFile "rea/windows/$name" $name}
$readme=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows/README-WINDOWS.txt') -Raw).Replace('v0.1.0',"v$Version")
Set-Content -LiteralPath (Join-Path $package 'README-WINDOWS.txt') -Value $readme -Encoding UTF8
Copy-ReleaseFile 'COPYING' 'COPYING'
Copy-ReleaseFile 'src/lua/COPYRIGHT' 'licenses/Lua-COPYRIGHT.txt'
Copy-ReleaseFile 'src/drivers/win/7zip/readme.txt' 'licenses/7-Zip-upstream-readme.txt'
Copy-ReleaseFile 'rea/windows/THIRD-PARTY-NOTICES.txt' 'licenses/THIRD-PARTY-NOTICES.txt'
Copy-ReleaseFile 'rea/windows/7-Zip-License.txt' 'licenses/7-Zip-License.txt'
Copy-ReleaseFile 'rea/windows/7-Zip-LGPL.txt' 'licenses/7-Zip-LGPL.txt'
Copy-ReleaseFile 'rea/windows/7-Zip-unRAR.txt' 'licenses/7-Zip-unRAR.txt'
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $package 'runtime/node.exe')
Copy-Item -LiteralPath $license -Destination (Join-Path $package 'licenses/Node-LICENSE.txt')
Copy-Item -LiteralPath $sums -Destination (Join-Path $package 'licenses/Node-SHASUMS256.txt')
# Only upstream distributed resources: never copy the working bin directory.
foreach($resource in (& git -C $root ls-files -- output/luaScripts output/palettes output/tools)){
 $relative='rea/bin/'+$resource.Substring(7);$parent=Split-Path (Join-Path $package $relative) -Parent
 New-Item -ItemType Directory -Force $parent | Out-Null;Copy-ReleaseFile $resource $relative
}
foreach($name in @('fceux.chm','taseditor.chm')){Copy-ReleaseFile "output/$name" "rea/bin/$name"}
$files=@(Get-ChildItem -LiteralPath $package -File -Recurse | Sort-Object FullName | ForEach-Object {[ordered]@{path=$_.FullName.Substring($package.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}})
if(@($files | Where-Object {$_.path -match '(?i)(^|/)(session|roms|sav|fcs|snaps|movies|cheats)/|\.(nes|fds|sav|fcs|fm2|cfg|pdb|log)$'}).Count){throw 'Unexpected ROM, user data or build artifact in package.'}
$manifest=[ordered]@{project='NES REAPER - FCEUX';release='NES REAPER - FCEUX';version=$Version;platform='windows-x64';repository='https://github.com/Bertzerker/NES-REAPER-FCEUX';upstream='https://github.com/TASEmulators/fceux';sourceCommit=(& git -C $root rev-parse HEAD).Trim();nodeVersion=$nodeVersion;nodeSha256=$actual;files=$files}
[IO.File]::WriteAllText((Join-Path $package 'release-manifest.json'),($manifest | ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
Write-Host "Package: $archive"
Write-Host "Stage: $package"
Get-FileHash -LiteralPath $archive -Algorithm SHA256
