[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$safe = $root.Replace('\', '/')
& git -c "safe.directory=$safe" -C $root diff --check
if ($LASTEXITCODE -ne 0) { throw 'Git 差異格式檢查失敗。' }
$pattern = '(?i)(api[_-]?key|secret|access[_-]?token|password)\s*[:=]\s*["''][^"'']{8,}'
$files = @(& git -c "safe.directory=$safe" -C $root ls-files --cached --others --exclude-standard)
foreach ($file in $files) {
    if ($file -match '(^|/)\.env(\.|$)|\.(png|jpe?g|gif|zip|db|ico)$') { continue }
    try { if (Select-String -LiteralPath (Join-Path $root $file) -Pattern $pattern -Quiet -Encoding UTF8 -ErrorAction Stop) { throw "疑似敏感值：$file" } } catch [System.ArgumentException] { }
}
Write-Output '共用 QA 通過；請再依 README 執行本專案專屬測試。'