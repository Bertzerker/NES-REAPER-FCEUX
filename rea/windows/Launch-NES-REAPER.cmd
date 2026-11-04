@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0Launch-NES-REAPER.ps1" %*
if errorlevel 1 pause
