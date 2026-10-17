@echo off
cd /d "%~dp0"
if exist "target\release\quizradar.exe" (
    start "" "target\release\quizradar.exe"
    exit /b 0
)
if exist "quizradar.exe" (
    start "" "quizradar.exe"
    exit /b 0
)
cargo build --release
start "" "target\release\quizradar.exe"
