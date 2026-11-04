param([Parameter(Mandatory=$true)][string]$Rom,[ValidateRange(1024,65534)][int]$Port=8775,[string]$NodeExe)
$ErrorActionPreference='Stop'
$romPath=(Resolve-Path -LiteralPath $Rom).Path
if(!$NodeExe){$portableNode=Join-Path $PSScriptRoot '../runtime/node.exe';if(Test-Path -LiteralPath $portableNode){$NodeExe=(Resolve-Path -LiteralPath $portableNode).Path}else{$NodeExe=(Get-Command node -ErrorAction Stop).Source}}
if(!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'bin/fceux64.exe'))) { throw 'Build first with ./rea/Build-REA.ps1 from the fceux directory.' }
$oldPort=$env:PORT
try { $env:PORT="$Port"; & $NodeExe (Join-Path $PSScriptRoot 'server.mjs') $romPath; if($LASTEXITCODE -ne 0){throw "Inspector exited with code $LASTEXITCODE"} }
finally { $env:PORT=$oldPort }
