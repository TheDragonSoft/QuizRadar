param(
    [string]$Version = "2.0.0"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

try {
    Write-Host "==> Building QuizRadar v$Version (Release)..." -ForegroundColor Cyan
    cargo build --release

    $DistDir = Join-Path $RepoRoot "dist"
    $StageDir = Join-Path $DistDir "QuizRadar-v$Version-win-x64"

    if (Test-Path $StageDir) {
        Remove-Item -Recurse -Force $StageDir
    }
    New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "static") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "data") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "assets") | Out-Null

    Copy-Item "target\release\quizradar.exe" -Destination $StageDir
    Copy-Item "static\index.html" -Destination (Join-Path $StageDir "static")
    Copy-Item "static\app.js" -Destination (Join-Path $StageDir "static")
    Copy-Item "static\icon.svg" -Destination (Join-Path $StageDir "static")
    Copy-Item "assets\icon.ico" -Destination (Join-Path $StageDir "assets")
    Copy-Item "assets\icon.png" -Destination (Join-Path $StageDir "assets")
    Copy-Item "data\schedule.json" -Destination (Join-Path $StageDir "data")
    Copy-Item "README.md" -Destination $StageDir

    $ZipPath = Join-Path $DistDir "QuizRadar-Portable-v$Version-win-x64.zip"
    if (Test-Path $ZipPath) {
        Remove-Item -Force $ZipPath
    }
    Write-Host "==> Creating Portable ZIP: $ZipPath" -ForegroundColor Cyan
    Compress-Archive -Path "$StageDir\*" -DestinationPath $ZipPath -Force

    # Check for Inno Setup Compiler (ISCC.exe) to build the Windows Setup Installer
    $IsccCandidates = @(
        "iscc.exe",
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    )
    $IsccExe = $null
    foreach ($candidate in $IsccCandidates) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) {
            $IsccExe = $cmd.Source
            break
        }
    }

    if ($IsccExe) {
        Write-Host "==> Building Windows Setup Installer with Inno Setup ($IsccExe)..." -ForegroundColor Cyan
        & $IsccExe "/DMyAppVersion=$Version" "installer\QuizRadar.iss"
    } else {
        Write-Host "==> Note: Inno Setup (ISCC.exe) not found locally; Windows Setup .exe will be built by GitHub Actions." -ForegroundColor Yellow
    }

    Write-Host "==> Generating SHA256SUMS.txt..." -ForegroundColor Cyan
    $HashLines = @()
    Get-ChildItem $DistDir -File | Where-Object { $_.Name -ne "SHA256SUMS.txt" } | ForEach-Object {
        $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
        $HashLines += "$hash  $($_.Name)"
    }
    $HashLines | Set-Content -Path (Join-Path $DistDir "SHA256SUMS.txt") -Encoding UTF8

    Write-Host "==> Release artifacts ready in $DistDir" -ForegroundColor Green
    Get-ChildItem $DistDir -File | Select-Object Name, Length
} finally {
    Pop-Location
}
