param(
    [Parameter(Mandatory = $true)][string]$TestFile,
    [string]$Filter = "",
    [int]$TimeoutMs = 30000,
    [string]$BunCommand = "bun",
    [switch]$UseNode
)

$ErrorActionPreference = "Stop"
if ($UseNode) {
    $command = "node"
    $arguments = @("--import", "tsx", "--test", $TestFile)
} else {
    $command = $BunCommand
    $arguments = @("test", $TestFile, "--timeout", "$TimeoutMs")
    if ($Filter) { $arguments += @("-t", $Filter) }
}
$temporaryBase = Join-Path ([System.IO.Path]::GetTempPath()) ("nanami-ci-test-" + [guid]::NewGuid().ToString("N"))
$stdout = "$temporaryBase.out"
$stderr = "$temporaryBase.err"
try {
    $executable = (Get-Command $command -CommandType Application -ErrorAction Stop).Source
    $process = Start-Process -FilePath $executable -ArgumentList $arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $status = $process.ExitCode
    $output = @((Get-Content -LiteralPath $stdout -Encoding UTF8), (Get-Content -LiteralPath $stderr -Encoding UTF8)) | ForEach-Object { $_ }
} finally {
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
}
foreach ($line in $output) { Write-Host "$line" }

if ($status -ne 0) {
    $diagnostics = @($output | ForEach-Object { "$_" } | Where-Object {
        $_ -match '(?i)(error:|error\]|exception:|cannot find module|\(fail\)|assertionerror|ERR_[A-Z_]+)'
    } | Select-Object -First 5)
    if ($diagnostics.Count -eq 0) { $diagnostics = @("Test failed; see the job log.") }
    foreach ($line in $diagnostics) {
        $safe = $line -replace '\x1b\[[0-9;]*m', '' -replace 'nmn_[A-Za-z0-9_-]+', '[redacted]'
        $safe = $safe -replace '(?i)(token|secret|password|api.?key)\s*[:=]\s*[^\s,}]+', '$1=[redacted]'
        $safe = $safe.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
        if ($safe.Length -gt 500) { $safe = $safe.Substring(0, 500) }
        Write-Host "::error::$safe"
    }
}
exit $status
