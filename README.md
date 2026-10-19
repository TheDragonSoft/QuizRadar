<div align="center">

<img src="static/icon.svg" width="112" height="112" alt="QuizRadar App Icon" />

# QuizRadar v3.0.0

**Never miss a quiz, lab assessment, or midterm buried in your university inbox, Microsoft Teams, Moodle, or Google Classroom.**

[![Latest Release](https://img.shields.io/badge/Release-v3.0.0-1a73e8?style=for-the-badge&logo=github&label=Release&color=1a73e8)](https://github.com/TheDragonSoft/QuizRadar/releases/latest)
[![Android Mobile App](https://img.shields.io/badge/Android-APK_v3.0.0-3ddc84?style=for-the-badge&logo=android&logoColor=white)](android/app/build/outputs/apk/debug/app-debug.apk)
[![100% Local Privacy](https://img.shields.io/badge/Privacy-100%25_Local_Data-0f9d58?style=for-the-badge&logo=shield&logoColor=white)](#-your-data-stays-100-local)
[![Gemini AI](https://img.shields.io/badge/Gemini_AI-Smart_Study_Planner-8e24aa?style=for-the-badge&logo=googlegemini&logoColor=white)](#-features-and-parity)
[![Google Calendar](https://img.shields.io/badge/Google_Calendar-Auto_Sync-1a73e8?style=for-the-badge&logo=googlecalendar&logoColor=white)](#-features-and-parity)

<p align="center">
  <a href="https://github.com/TheDragonSoft/QuizRadar/releases/latest"><strong>⬇ Download Desktop (v3.0.0)</strong></a> ·
  <a href="#-android-mobile-app"><strong>📱 Android App</strong></a> ·
  <a href="#-features-and-parity"><strong>✨ Features & Parity</strong></a> ·
  <a href="#-your-data-stays-100-local"><strong>🔒 Local Privacy</strong></a> ·
  <a href="#-quick-start"><strong>🚀 Quick Start</strong></a>
</p>

</div>

---

## 🎯 Overview

Professors and academic portals rarely give you an exact calendar date when announcing a quiz or assignment. Instead, you get announcements like:

> *"Dear Students, you will have Class Quiz 1 during your scheduled lecture next week (not this week). Bring a scientific calculator."*

Figuring out when that quiz actually happens means checking when the announcement was posted, cross-referencing your weekly lecture slot, finding the right hall/room number, and calculating the date by hand—across Gmail, Microsoft Teams, Moodle, and Google Classroom.

**QuizRadar 3.0** does all of that automatically on **both Desktop and Mobile**. It connects your university accounts, weekly timetable, and calendar into one clean, unified workspace—with **100% feature parity** and **complete local privacy**.

---

## 📱 Android Mobile App

QuizRadar 3.0 introduces a brand new native **Android Mobile Application** built for high performance and offline independence:

- **Complete Feature Parity**: Access all dashboard views, study task roadmaps, 7-day week calendar, Pomodoro focus timer, AI study plans, and account connections directly on your Android phone or tablet.
- **Autonomous On-Device Engine**: Runs 100% offline using a dedicated local storage and calculation engine. No background server connection required.
- **Dynamic Date & Day-of-Week Synchronization**: Real-time relative countdowns (`Today`, `Tomorrow`, `In X days`) that automatically update with your device clock.
- **Native Touch & Gestures**: Smooth pull-to-refresh to rescan university feeds on demand, swipe-to-scroll timetable, back-button handling, and tactile haptic feedback.
- **Accessible Light & Dark Theming**: Adaptive status bar and dynamic theme switching with Impeccable contrast standards.
- **Clean First-Run State**: Zero preloaded personal data or hardcoded subjects on clean install. Complete blank canvas with a guided 3-step setup wizard.

---

## ✨ Features & Desktop/Mobile Parity

| Feature | Desktop (Rust + Axum) | Android Mobile (Capacitor) |
|---|:---:|:---:|
| **Multi-Source Ingestion** (Gmail, Teams, Moodle, Classroom) | ✅ | ✅ |
| **Smart Academic Dashboard** with Urgent Deadlines | ✅ | ✅ |
| **"What Should I Study?" AI Roadmap** | ✅ | ✅ |
| **7-Day Interactive Week Calendar** (8 AM – 8 PM) | ✅ | ✅ |
| **Dynamic Date Synchronization** (Real-time Day Highlights) | ✅ | ✅ |
| **Pull-to-Refresh & Dedicated Sync Button** | ✅ | ✅ |
| **Autonomous On-Device Processing** | ✅ | ✅ |
| **Exam Overload & Clash Detection** | ✅ | ✅ |
| **1-Click Google Calendar Push & `.ics` Export** | ✅ | ✅ |
| **Impeccable Light & Dark Mode** | ✅ | ✅ |
| **Zero Server Tracking / 100% Local Privacy** | ✅ | ✅ |

---

## 🔒 Your Data Stays 100% Local

> [!IMPORTANT]
> **Zero Cloud Servers · Zero Tracking · Complete Local Ownership**
> QuizRadar stores your data strictly on your own hardware. Your coursework, schedules, and login tokens are never sent to external third-party tracking databases.

- **Direct University API Connection**: When connecting Microsoft Teams, Google Classroom, or Gmail, tokens remain stored on your local device.
- **Offline Ready**: Full timetable exploration, topic checklists, and calendar navigation function without internet access.

---

## 🚀 Quick Start

### Android Mobile App
1. Download **`app-debug.apk`** from the release assets or build from source:
   ```powershell
   npx cap sync android
   cd android
   $env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
   ./gradlew.bat assembleDebug
   ```
2. Install on your Android device or emulator:
   ```powershell
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```

### Desktop Application
1. Download **`QuizRadar-v3.0.0-win-x64.zip`** from **[GitHub Releases](https://github.com/TheDragonSoft/QuizRadar/releases/latest)**.
2. Run **`quizradar.exe`**.
3. Or build directly from source:
   ```powershell
   cargo build --release
   .\target\release\quizradar.exe
   ```

---

<p align="center">Made with ❤️ for students everywhere.</p>
