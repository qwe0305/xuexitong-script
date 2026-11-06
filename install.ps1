# 学习通刷课脚本 —— 一键安装（Windows）
# 用法：在 PowerShell 里执行
#   irm https://raw.githubusercontent.com/qwe0305/xuexitong-script/main/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$repo   = 'qwe0305/xuexitong-script'
$branch = 'main'
$dest   = Join-Path $env:USERPROFILE 'WorkBuddy\xuexitong-script'

function Info($m) { Write-Host "[..] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m"  -ForegroundColor Yellow }
function Fail($m) { Write-Host "[x] $m"  -ForegroundColor Red }

Write-Host ''
Write-Host '  =========================================='
Write-Host '   学习通刷课脚本 - 一键安装'
Write-Host '  =========================================='
Write-Host ''

# ---------- 1. 检查 Node ----------
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Warn '没有检测到 Node.js，已为你打开下载页。'
    Warn '请安装 Node.js 22 或更高版本（LTS，一路下一步），装完重新运行本命令。'
    Start-Process 'https://nodejs.org/zh-cn/download'
    return
}
$ver = (& node -v).Trim() -replace '^v', ''
$major = 0
[void][int]::TryParse(($ver -split '\.')[0], [ref]$major)
if ($major -lt 22) {
    Warn "Node 版本过低（$ver），需要 22 及以上。已打开下载页，装完重新运行本命令。"
    Start-Process 'https://nodejs.org/zh-cn/download'
    return
}
Ok "Node $ver"

# ---------- 2. 下载源码 ----------
$tmpRoot = Join-Path $env:TEMP ('xxt-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$zip     = Join-Path $tmpRoot 'src.zip'
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null

$url = "https://github.com/$repo/archive/refs/heads/$branch.zip"
Info "下载源码：$url"
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 120
} catch {
    Fail "下载失败：$($_.Exception.Message)"
    Warn "请检查网络，或改用 git clone https://github.com/$repo.git"
    return
}
Ok ("下载完成（{0:N1} MB）" -f ((Get-Item $zip).Length / 1MB))

# ---------- 3. 解压安装 ----------
Info "解压到 $dest"
try {
    Expand-Archive -Path $zip -DestinationPath $tmpRoot -Force
} catch {
    Fail "解压失败：$($_.Exception.Message)"
    return
}
$inner = Get-ChildItem $tmpRoot -Directory | Where-Object { $_.Name -like 'xuexitong-script*' } | Select-Object -First 1
if (-not $inner) { Fail '压缩包结构异常，找不到源码目录。'; return }

if (Test-Path $dest) {
    Info '检测到旧版本，备份为 .bak'
    $bak = "$dest.bak"
    if (Test-Path $bak) { Remove-Item $bak -Recurse -Force -ErrorAction SilentlyContinue }
    try { Move-Item $dest $bak -Force } catch { Remove-Item $dest -Recurse -Force }
}
New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
Move-Item $inner.FullName $dest
Remove-Item $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
Ok "已安装到 $dest"

# ---------- 4. 启动 ----------
Write-Host ''
Write-Host '  安装完成，正在启动……' -ForegroundColor Green
Write-Host '  接下来请在弹出的浏览器里：'
Write-Host '    1. 登录学习通'
Write-Host '    2. 点进任意一门课程'
Write-Host '    3. 脚本会自动接管，窗口可以最小化'
Write-Host ''

Set-Location $dest
if (Test-Path 'start.cmd') {
    & cmd.exe /c 'start.cmd'
} else {
    Fail '没有找到 start.cmd，请手动进入目录运行。'
}
