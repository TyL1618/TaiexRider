# 把 repo 內 android/ 的最新原始碼同步覆蓋到 Android Studio 專案資料夾。
#
# 背景：android/app/src 與 android/app/build.gradle.kts 是唯一會變動、且需要
# 手動同步進 Android Studio 專案的部分（local.properties/.idea/.gradle/build/
# 是機器本地設定與建置快取，本來就沒有進版控，不會也不該被這支腳本碰）。
#
# 用法（在 repo 根目錄跑，或直接執行本檔案）：
#   1. 先 git pull，確保 repo 內 android/ 是最新的
#   2. pwsh scripts/sync-android-studio.ps1
#   3. 回 Android Studio 視窗，等它自動偵測到檔案變動跳出 Gradle Sync 提示，
#      或手動 File → Sync Project with Gradle Files

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceApp = Join-Path $repoRoot "android\app"
$targetApp = Join-Path $env:USERPROFILE "AndroidStudioProjects\TaiexRider\app"

if (-not (Test-Path $sourceApp)) {
    throw "找不到 repo 內的 android/app（$sourceApp），請確認在正確的 repo 目錄下執行。"
}
if (-not (Test-Path $targetApp)) {
    throw "找不到 Android Studio 專案（$targetApp），請確認路徑正確，或先手動建立過一次專案。"
}

Write-Host "來源：$sourceApp"
Write-Host "目標：$targetApp"
Write-Host ""

Write-Host "同步 app/src ..."
robocopy "$sourceApp\src" "$targetApp\src" /MIR /NFL /NDL /NJH /NJS
# robocopy 的成功結束碼是 0~7（含「刪除了目標多出來的檔案」這種正常情況），8 以上才算真的失敗
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -ge 8) {
    throw "robocopy 同步 app/src 失敗，結束碼 $robocopyExit"
}

Write-Host "同步 app/build.gradle.kts ..."
Copy-Item "$sourceApp\build.gradle.kts" "$targetApp\build.gradle.kts" -Force

Write-Host ""
Write-Host "完成。回 Android Studio 視窗做 Gradle Sync（右上角提示或 File > Sync Project with Gradle Files）。"
exit 0
