<#
.SYNOPSIS
  Removes the "Night Blocker Grayscale" task and turns grayscale off.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TaskName = "Night Blocker Grayscale"
$Dir = Join-Path $env:LOCALAPPDATA "NightBlocker"
$Script = Join-Path $Dir "grayscale.ps1"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Removed '$TaskName'."
} else {
    Write-Output "'$TaskName' wasn't installed."
}
if (Test-Path $Script) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script -Mode Off
    Remove-Item -Path $Script -Force
}
Write-Output "The log stays at $Dir\grayscale.log (delete the folder if you like)."
