# One-click setup of receipt printing on this PC: installs the print bridge, shares every real printer under a short name,
# and, if a USB thermal printer is plugged in but has no printer in Windows, adds it with the built-in "Generic / Text Only"
# driver (the bridge sends raw ESC/POS bytes, so no maker driver is needed).
# Run by double-clicking setup-printer.cmd. Asks Windows for administrator rights once (sharing a printer needs them).
param([switch]$Elevated, [switch]$DryRun)
$ErrorActionPreference = 'Stop'

if (-not $Elevated -and -not $DryRun) {
  # the bridge installs for this user without admin rights; only sharing a printer needs them, so ask for those next
  & (Join-Path $PSScriptRoot 'install.ps1')
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
  exit
}

function Say($text) { Write-Host $text }
$virtual = 'Microsoft|OneNote|Fax|PDF|XPS|AnyDesk|Send To|Snagit|Virtual|Root Print'

# 2. A USB thermal printer that Windows knows as a port but has no printer on: add it with the generic driver.
$printers = @(Get-Printer | Where-Object { $_.Name -notmatch $virtual })
$usedPorts = @($printers | ForEach-Object { $_.PortName })
$freeUsb = @(Get-PrinterPort | Where-Object { $_.Name -like 'USB*' -and $usedPorts -notcontains $_.Name })
if ($printers.Count -eq 0 -and $freeUsb.Count -ge 1) {
  Say "Adding the USB printer on $($freeUsb[0].Name) with the generic driver..."
  if (-not $DryRun) {
    Add-Printer -Name 'Receipt Printer' -DriverName 'Generic / Text Only' -PortName $freeUsb[0].Name
  }
  $printers = @(Get-Printer | Where-Object { $_.Name -notmatch $virtual })
}

# 3. Share every real printer under a short name (letters and digits), the name the app lists and uses.
$names = @()
foreach ($p in $printers) {
  $share = if ($p.ShareName) { $p.ShareName } else { ($p.Name -replace '[^A-Za-z0-9]', '') }
  if ($share.Length -gt 20) { $share = $share.Substring(0, 20) }
  if ($share -eq '') { $share = 'Receipt' }
  if (-not $p.Shared -or -not $p.ShareName) {
    Say "Sharing '$($p.Name)' as $share"
    if (-not $DryRun) { Set-Printer -Name $p.Name -Shared $true -ShareName $share }
  }
  $names += $share
}

Say ''
if ($names.Count -eq 0) {
  Say 'No printer found. Plug in the printer and switch it on, then run this file again.'
} else {
  Say 'Ready. In the app open Settings, "Receipt printer", pick it from the list and press Save:'
  $names | ForEach-Object { Say "  $_" }
}
if (-not $DryRun) { Read-Host 'Press Enter to close' | Out-Null }
