<#
.SYNOPSIS
  Installs a scheduled task that keeps grayscale on during a nightly window.

.DESCRIPTION
  Copies grayscale.ps1 to %LOCALAPPDATA%\NightBlocker and creates the task "Night Blocker
  Grayscale" for the current user (no admin needed). It runs at the window's start and end, and
  also when you sign in, unlock, or the laptop wakes - so it catches up if the laptop was asleep
  or off at the switch-over time. Run it again with new times to change the schedule.

.EXAMPLE
  .\install.ps1 -Start 23:30 -End 08:00
.EXAMPLE
  .\install.ps1 -Start 22:00 -End 07:00 -Days Sun,Mon,Tue,Wed,Thu
#>
param(
    [string]$Start = "23:30",
    [string]$End = "08:00",
    [string[]]$Days = @("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# "-Days Sun,Mon" arrives as one string when run with -File: split and check it.
$Days = @($Days | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$valid = @("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
foreach ($d in $Days) {
    if ($valid -notcontains $d) { throw "Unknown day '$d'. Use Sun, Mon, Tue, Wed, Thu, Fri, Sat." }
}
if ($Days.Count -eq 0) { throw "Give at least one day." }

foreach ($t in @($Start, $End)) {
    try { [void][datetime]::ParseExact($t, "HH:mm", [Globalization.CultureInfo]::InvariantCulture) }
    catch { throw "Times must be 24-hour HH:mm, e.g. 23:30 (got '$t')" }
}

$TaskName = "Night Blocker Grayscale"
$Dir = Join-Path $env:LOCALAPPDATA "NightBlocker"
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir | Out-Null }
$Script = Join-Path $Dir "grayscale.ps1"
Copy-Item -Path (Join-Path $PSScriptRoot "grayscale.ps1") -Destination $Script -Force

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$dayList = $Days -join ","
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Script`" -Mode Auto -Start $Start -End $End -Days $dayList"
$today = (Get-Date).ToString("yyyy-MM-dd")
$esc = [Security.SecurityElement]

# Task XML: the cmdlets can't create unlock / wake triggers.
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Night Blocker: grayscale from $Start to $End ($dayList).</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$($today)T$($Start):00</StartBoundary>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
    <CalendarTrigger>
      <StartBoundary>$($today)T$($End):00</StartBoundary>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
    <LogonTrigger>
      <UserId>$($esc::Escape($user))</UserId>
      <Delay>PT10S</Delay>
    </LogonTrigger>
    <SessionStateChangeTrigger>
      <UserId>$($esc::Escape($user))</UserId>
      <StateChange>SessionUnlock</StateChange>
      <Delay>PT5S</Delay>
    </SessionStateChangeTrigger>
    <EventTrigger>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="System"&gt;&lt;Select Path="System"&gt;*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
      <Delay>PT5S</Delay>
    </EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$($esc::Escape($user))</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>$($esc::Escape($arguments))</Arguments>
    </Exec>
  </Actions>
</Task>
"@

Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
Write-Output "Installed '$TaskName': grayscale $Start-$End ($dayList)."

$settings = Get-ItemProperty -Path "HKCU:\Software\Microsoft\ColorFiltering" -ErrorAction SilentlyContinue
if (-not $settings -or -not ($settings.PSObject.Properties.Name -contains "HotkeyEnabled") -or $settings.HotkeyEnabled -ne 1) {
    Write-Warning "Turn on 'Allow the shortcut key to toggle filter on or off' in Settings > Color filters, or the task can't switch grayscale."
}

# Apply the right state now.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script -Mode Auto -Start $Start -End $End -Days $dayList
