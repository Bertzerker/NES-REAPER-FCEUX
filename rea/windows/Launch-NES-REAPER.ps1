# SPDX-License-Identifier: GPL-2.0-or-later
param([string]$Rom,[ValidateRange(1024,65534)][int]$Port=8775)
$ErrorActionPreference='Stop'
try {
 if(@(Get-Process -Name fceux,fceux64 -ErrorAction SilentlyContinue).Count -gt 0){throw 'FCEUX is already running. Close it before starting NES REAPER; only one instance is allowed.'}
 if(!$Rom){
  Add-Type -AssemblyName System.Windows.Forms
  $dialog=New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title='NES REAPER - FCEUX: choose your local ROM'
  $dialog.Filter='NES games (*.nes;*.fds;*.unf;*.unif;*.zip;*.7z)|*.nes;*.fds;*.unf;*.unif;*.zip;*.7z|All files (*.*)|*.*'
  if($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK){exit 0}
  $Rom=$dialog.FileName;$dialog.Dispose()
 }
 Write-Host 'NES REAPER - FCEUX / MEGA REAPER - FCEUX' -ForegroundColor Cyan
 Write-Host "REA interface: http://127.0.0.1:$Port/"
 Write-Host 'Open that address in your browser (or use Open-REA-Interface.url for port 8775).'
 Write-Host 'The game and inspection start paused. Keep this console open; close FCEUX to stop.'
 & (Join-Path $PSScriptRoot 'rea/Start-REA.ps1') -Rom $Rom -Port $Port
}catch{Write-Host $_.Exception.Message -ForegroundColor Red;exit 1}
