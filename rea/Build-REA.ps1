param([string]$MSBuild,[string]$Toolset='v145')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if(!$MSBuild) {
 $vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
 if(!(Test-Path -LiteralPath $vswhere)){throw 'Pass -MSBuild with the path to MSBuild.exe.'}
 $MSBuild=(& $vswhere -latest -products '*' -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1)
}
Push-Location $root
try {
 & $MSBuild 'vc/vc14_fceux.vcxproj' /m:2 /p:Configuration=Release /p:Platform=x64 /p:MultiProcessorCompilation=false "/p:PlatformToolset=$Toolset" '/p:OutDir=..\rea\bin\' '/p:IntDir=..\rea\obj\' /v:minimal /fl '/flp:logfile=rea/build.log'
 if($LASTEXITCODE -ne 0){throw 'FCEUX build failed. See rea/build.log.'}
 Copy-Item -LiteralPath 'src/drivers/win/lua/x64/lua51.dll','src/drivers/win/lua/x64/lua5.1.dll' -Destination 'rea/bin/'
 # The legacy Lua core imports MSVCR80.dll. Build the same bundled Lua 5.1.4
 # sources with the static CRT so extracted releases need no VC2005 install.
 & $MSBuild 'rea/lua-portable.vcxproj' /m:1 /p:Configuration=Release /p:Platform=x64 "/p:PlatformToolset=$Toolset" /v:minimal
 if($LASTEXITCODE -ne 0){throw 'Portable Lua build failed.'}
 Write-Host 'Built rea/bin/fceux64.exe. Start with ./rea/Start-REA.ps1 -Rom C:/path/to/game.nes'
} finally {Pop-Location}
