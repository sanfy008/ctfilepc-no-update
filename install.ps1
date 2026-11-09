[CmdletBinding()]
param(
    [string]$ClientDir = "D:\Program Files\城通网盘客户端",
    [switch]$Restore
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcDir    = Join-Path $ScriptDir "src"
$HtmlDir   = Join-Path $ClientDir "html"
$ComDir    = Join-Path $HtmlDir "com"
$BackupDir = Join-Path $ComDir "backup_orig"

function Read-Text($path) {
    return [System.IO.File]::ReadAllText($path)
}

function Write-Text($path, $text) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $text, $utf8)
}

function Assert-Client {
    foreach ($f in @("login.js", "main.js")) {
        $p = Join-Path $ComDir $f
        if (!(Test-Path $p)) {
            throw "未找到 $p。请用 -ClientDir 指定城通网盘客户端目录（包含 html\com\login.js 的那一层）。"
        }
    }
    foreach ($f in @("login.html", "index.html")) {
        $p = Join-Path $HtmlDir $f
        if (!(Test-Path $p)) {
            throw "未找到 $p，客户端目录可能不正确。"
        }
    }
}

function Backup-Originals {
    if (!(Test-Path $BackupDir)) {
        New-Item -ItemType Directory -Path $BackupDir | Out-Null
    }
    $map = @{
        (Join-Path $ComDir "login.js")   = Join-Path $BackupDir "login.js"
        (Join-Path $ComDir "main.js")    = Join-Path $BackupDir "main.js"
        (Join-Path $HtmlDir "login.html") = Join-Path $BackupDir "login.html"
        (Join-Path $HtmlDir "index.html") = Join-Path $BackupDir "index.html"
    }
    foreach ($src in $map.Keys) {
        $dst = $map[$src]
        if (!(Test-Path $dst)) {
            Copy-Item -LiteralPath $src -Destination $dst -Force
        }
    }
}

function Ensure-ScriptTag($path, $anchor, $tag) {
    $text = Read-Text $path
    if ($text.Contains($tag)) { return $false }
    if (!$text.Contains($anchor)) {
        throw "在 $path 中找不到插入点：$anchor"
    }
    $replacement = $anchor + "`r`n  " + $tag
    Write-Text $path ($text.Replace($anchor, $replacement))
    return $true
}

function Patch-Version($path) {
    $text = Read-Text $path
    $dynamic = 'return (typeof window !== "undefined" && window.__ctfileClientVersion) || "3.60.0";'
    if ($text.Contains('__ctfileClientVersion')) { return $false }
    if ($text.Contains('return "3.60.0";')) {
        Write-Text $path ($text.Replace('return "3.60.0";', $dynamic))
        return $true
    }
    $new = [regex]::Replace($text, 'return[^;\r\n]*0\.3500000000000001\s*;', { param($m) $dynamic })
    if ($new -eq $text) {
        throw "未能在 $path 中找到客户端版本返回语句，该客户端版本可能不受支持。"
    }
    Write-Text $path $new
    return $true
}

Assert-Client

if ($Restore) {
    if (!(Test-Path $BackupDir)) {
        throw "未找到备份目录 $BackupDir，无法恢复。"
    }
    foreach ($f in @("login.js", "main.js")) {
        $b = Join-Path $BackupDir $f
        if (Test-Path $b) { Copy-Item -LiteralPath $b -Destination (Join-Path $ComDir $f) -Force }
    }
    foreach ($f in @("login.html", "index.html")) {
        $b = Join-Path $BackupDir $f
        if (Test-Path $b) { Copy-Item -LiteralPath $b -Destination (Join-Path $HtmlDir $f) -Force }
    }
    Remove-Item -LiteralPath (Join-Path $ComDir "altcha-login.js") -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $ComDir "no-upgrade.js") -Force -ErrorAction SilentlyContinue
    Write-Host "已恢复原始文件，补丁脚本已删除。" -ForegroundColor Green
    Write-Host "如需完全清理，可手动删除 $BackupDir。"
    exit 0
}

Backup-Originals

Copy-Item -LiteralPath (Join-Path $SrcDir "altcha-login.js") -Destination (Join-Path $ComDir "altcha-login.js") -Force
Copy-Item -LiteralPath (Join-Path $SrcDir "no-upgrade.js") -Destination (Join-Path $ComDir "no-upgrade.js") -Force

$v1 = Patch-Version (Join-Path $ComDir "login.js")
$v2 = Patch-Version (Join-Path $ComDir "main.js")
$t1 = Ensure-ScriptTag (Join-Path $HtmlDir "login.html") '  <script src="com/login.js"></script>' '<script src="com/altcha-login.js"></script>'
$t2 = Ensure-ScriptTag (Join-Path $HtmlDir "index.html") '  <script src="com/main.js"></script>' '<script src="com/no-upgrade.js"></script>'

Write-Host "补丁安装完成：" -ForegroundColor Green
Write-Host ("  版本号伪装    login.js={0}  main.js={1}" -f $v1, $v2)
Write-Host ("  登录脚本注入  login.html={0}" -f $t1)
Write-Host ("  升级屏蔽注入  index.html={0}" -f $t2)
Write-Host ("  原始文件备份  {0}" -f $BackupDir)
Write-Host "请重新启动客户端。"
