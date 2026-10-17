@echo off
title QuizRadar v2.0 - Standalone Rust Academic Dashboard & Calendar
echo ====================================================================
echo   Starting QuizRadar v2.0 (Pure Standalone Rust Application)
echo   AI Engine: Gemini Schedule-Aware Email & Timetable Analyzer
echo   Features : Onboarding Wizard + Study Dashboard + Week Calendar
echo ====================================================================
echo.
if exist target\release\quizradar.exe (
    target\release\quizradar.exe
) else (
    cargo run --release
)
pause
