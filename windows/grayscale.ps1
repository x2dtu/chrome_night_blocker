<#
.SYNOPSIS
  Turns the Windows grayscale color filter on or off, or sets it from a schedule.

.DESCRIPTION
  Windows keeps the color filter setting in HKCU\Software\Microsoft\ColorFiltering, but writing
  it there only takes effect after signing out. What works immediately is the built-in
  Win + Ctrl + C shortcut, so this script checks the current state and presses the shortcut only
  when it's in the wrong state (it can never flip the wrong way).

  Needs "Allow the shortcut key to toggle filter on or off" turned on in
  Settings > Ease of Access (Windows 11: Accessibility) > Color filters.

.EXAMPLE
  .\grayscale.ps1 -Mode On
.EXAMPLE
  .\grayscale.ps1 -Mode Auto -Start 23:30 -End 08:00 -Days Sun,Mon,Tue,Wed,Thu
#>
param(
    [ValidateSet("On", "Off", "Auto", "Status")]
    [string]$Mode = "Status",
    # Auto mode: the grayscale window. If End is at or before Start, it runs overnight.
    [string]$Start = "23:30",
    [string]$End = "08:00",
    # Days the window *starts* on. Default: every day.
    [string[]]$Days = @("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# "-Days Sun,Mon" arrives as one string when run with -File: split it.
$Days = @($Days | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

$RegPath = "HKCU:\Software\Microsoft\ColorFiltering"
$Grayscale = 0  # FilterType: 0 grayscale, 1 inverted, 2 grayscale inverted, 3-5 color blindness filters
$LogFile = Join-Path $env:LOCALAPPDATA "NightBlocker\grayscale.log"

function Write-Log([string]$Message) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Output $line
    try {
        $dir = Split-Path $LogFile
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
        Add-Content -Path $LogFile -Value $line
        # Keep the log short.
        $lines = @(Get-Content -Path $LogFile)
        if ($lines.Count -gt 300) { $lines[-200..-1] | Set-Content -Path $LogFile }
    } catch { }
}

function Get-Filter {
    $values = Get-ItemProperty -Path $RegPath -ErrorAction SilentlyContinue
    $active = $false
    $type = -1
    $hotkey = $false
    if ($values) {
        if ($values.PSObject.Properties.Name -contains "Active") { $active = ($values.Active -eq 1) }
        if ($values.PSObject.Properties.Name -contains "FilterType") { $type = [int]$values.FilterType }
        if ($values.PSObject.Properties.Name -contains "HotkeyEnabled") { $hotkey = ($values.HotkeyEnabled -eq 1) }
    }
    [pscustomobject]@{ Active = $active; FilterType = $type; HotkeyEnabled = $hotkey }
}

function Test-Locked {
    # The lock screen (and the sign-in screen) runs as LogonUI; keypresses don't reach the desktop then.
    return [bool](Get-Process -Name LogonUI -ErrorAction SilentlyContinue)
}

Add-Type -Namespace NightBlocker -Name Keys -MemberDefinition @'
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@

function Send-ColorFilterHotkey {
    $KEYUP = 0x2
    $LWIN = 0x5B; $CTRL = 0x11; $C = 0x43
    [NightBlocker.Keys]::keybd_event($LWIN, 0, 0, [UIntPtr]::Zero)
    [NightBlocker.Keys]::keybd_event($CTRL, 0, 0, [UIntPtr]::Zero)
    [NightBlocker.Keys]::keybd_event($C, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 50
    [NightBlocker.Keys]::keybd_event($C, 0, $KEYUP, [UIntPtr]::Zero)
    [NightBlocker.Keys]::keybd_event($CTRL, 0, $KEYUP, [UIntPtr]::Zero)
    [NightBlocker.Keys]::keybd_event($LWIN, 0, $KEYUP, [UIntPtr]::Zero)
}

function Get-Minutes([string]$Time) {
    $t = [datetime]::ParseExact($Time, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
    return $t.Hour * 60 + $t.Minute
}

function Test-InWindow([datetime]$Now) {
    $s = Get-Minutes $Start
    $e = Get-Minutes $End
    $m = $Now.Hour * 60 + $Now.Minute
    $today = $Now.DayOfWeek.ToString().Substring(0, 3)
    $yesterday = $Now.AddDays(-1).DayOfWeek.ToString().Substring(0, 3)
    if ($s -eq $e) { return ($Days -contains $today) }               # all day
    if ($e -gt $s) { return (($Days -contains $today) -and $m -ge $s -and $m -lt $e) }
    # Overnight: from Start on a listed day until End the next morning.
    return ((($Days -contains $today) -and $m -ge $s) -or (($Days -contains $yesterday) -and $m -lt $e))
}

function Set-Grayscale([bool]$On) {
    $f = Get-Filter
    $isGray = $f.Active -and $f.FilterType -eq $Grayscale
    if ($isGray -eq $On) {
        Write-Log ("Grayscale already {0}" -f $(if ($On) { "on" } else { "off" }))
        return
    }
    if (Test-Locked) {
        Write-Log "Screen is locked; will try again when it's unlocked"
        return
    }
    if (-not $f.HotkeyEnabled) {
        Write-Log "The color filter shortcut is off. Turn on 'Allow the shortcut key to toggle filter on or off' in Settings > Color filters."
        return
    }
    if ($On -and $f.FilterType -ne $Grayscale) {
        # Make the shortcut switch to grayscale rather than another filter.
        if ($f.Active) {
            Send-ColorFilterHotkey   # turn the other filter off first
            Start-Sleep -Milliseconds 500
        }
        Set-ItemProperty -Path $RegPath -Name FilterType -Value $Grayscale -Type DWord
    }
    Send-ColorFilterHotkey
    Start-Sleep -Milliseconds 800
    $after = Get-Filter
    if ($after.Active -ne $On) {
        # Windows normally records the new state itself; if it didn't, record it so the next run
        # doesn't toggle again.
        Set-ItemProperty -Path $RegPath -Name Active -Value ([int]$On) -Type DWord
        Write-Log ("Pressed Win+Ctrl+C; Windows didn't record the change, so recorded Active={0}" -f [int]$On)
    }
    Write-Log ("Grayscale turned {0}" -f $(if ($On) { "on" } else { "off" }))
}

if (-not (Test-Path $RegPath)) { New-Item -Path $RegPath -Force | Out-Null }

switch ($Mode) {
    "On" { Set-Grayscale $true }
    "Off" { Set-Grayscale $false }
    "Auto" {
        $want = Test-InWindow (Get-Date)
        Write-Log ("Auto ({0}-{1}, {2}): should be {3}" -f $Start, $End, ($Days -join ","), $(if ($want) { "on" } else { "off" }))
        Set-Grayscale $want
    }
    "Status" {
        $f = Get-Filter
        Write-Output ("Color filter active: {0}; filter type: {1} (0 = grayscale); shortcut enabled: {2}" -f $f.Active, $f.FilterType, $f.HotkeyEnabled)
    }
}
