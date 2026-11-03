# Lap lich chay `backup-local.mjs` moi ngay mot lan.
#
# Vi sao chay duoi tai khoan dang dang nhap chu khong phai SYSTEM: khoa niem
# duoc cat bang DPAPI theo TAI KHOAN NGUOI DUNG. Chay bang SYSTEM se khong mo
# noi khoa do, va loi chi lo ra khi can den ban sao luu nhat.
#
# Chay (PowerShell thuong, khong can quyen quan tri):
#   powershell -ExecutionPolicy Bypass -File scripts\setup-daily-backup.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\setup-daily-backup.ps1 -At 21:00
#   powershell -ExecutionPolicy Bypass -File scripts\setup-daily-backup.ps1 -Remove

param(
  [string]$At   = "12:30",
  [string]$Repo = "D:\Lwcifer\LW\FWBB",
  [string]$Dir  = "D:\FWBB-Backups",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$TaskName = "FWBB sao luu hang ngay"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Da go lich: $TaskName"
  exit 0
}

$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path $Repo))               { throw "Khong thay thu muc du an: $Repo" }
if (-not (Test-Path "$Repo\scripts\backup-local.mjs")) { throw "Khong thay scripts\backup-local.mjs trong $Repo" }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

$log = Join-Path $Dir "run.log"

# Goi qua cmd de gom ca stdout lan stderr vao mot file log, va de ghi them
# chu khong de. Mot lich chay am tham that bai la kieu hong te nhat o day.
$action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"`"$node`" scripts\backup-local.mjs --dir=`"$Dir`" >> `"$log`" 2>&1`"" `
  -WorkingDirectory $Repo

$trigger = New-ScheduledTaskTrigger -Daily -At $At

# StartWhenAvailable: may tat dung gio hen thi chay bu khi bat len, khong bo
# luon mot ngay. RunOnlyIfNetworkAvailable: khong co mang thi khoi chay cho
# that bai roi ghi mot dong loi vo nghia vao log.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Sao luu database FWBB ve may, da niem phong. Ghi phan chenh moi ngay, tu ghi lai ban day du khi chuoi da dai." `
  -Force | Out-Null

Write-Output "Da lap lich '$TaskName', chay moi ngay luc $At."
Write-Output "  Thu muc sao luu: $Dir"
Write-Output "  Log moi lan chay: $log"
Write-Output ""
Write-Output "Chay thu ngay bay gio:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "Xem lan chay gan nhat:  Get-ScheduledTaskInfo -TaskName '$TaskName'"
