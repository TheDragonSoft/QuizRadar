# 🎯 QuizRadar — Native Rust Academic Calendar & Quiz Assistant

<p align="center">
  <b>A blazing-fast, native Rust desktop calendar application replicating Google Calendar's UI to track university schedules and upcoming quizzes scanned directly from Gmail.</b>
</p>

---

## 🌟 Key Features

- **🦀 Native Rust Engine**:
  - Built with **Rust**, **Axum**, and **Tokio** for memory safety, instant launch times, and minimal resource usage.
  - Generates standalone, zero-dependency release binary (`target/release/quizradar.exe`).

- **📅 Google Calendar UI Experience**:
  - Pixel-perfect Google Calendar week grid layout (Sunday to Saturday, 8 AM – 8 PM).
  - Left navigation sidebar with interactive mini-calendar month picker and "+ Create" button.
  - "My Calendars" course selector with checkboxes to toggle individual courses dynamically.
  - Exact time slots, rooms, and lecture/lab/tutorial groups matching your university schedule.

- **⚡ Smart Quiz Radar & Timeline**:
  - Quizzes are automatically integrated directly into their actual scheduled lecture periods.
  - Glowing **`⚡ QUIZ 1 TODAY`** alert badges on class blocks.
  - Full details on click: covered topics checklist, instructor notes, strict navigation/template warnings.

- **🔔 1-Click Google Calendar Reminders**:
  - Click **"Add to Google Calendar"** on any quiz to open Google Calendar with pre-populated course title, room, times, topics, and alert reminders.
  - Direct RFC 5545 `.ics` file generation for offline imports or calendar subscription.

- **📬 University Gmail Sync**:
  - Automatically queries official university Moodle announcement emails (`@msa.edu.eg`) for newly announced quizzes and exams.

---

## 📚 Enrolled Courses (Fall 2026 — Semester 91)

| Course ID | Course Name | Room(s) | Schedule Slots |
| :--- | :--- | :--- | :--- |
| **GSE211** | **Mathematical Analysis and Numerical Methods** | C212 O, G202 B | Sun 8:00–10:00 AM (Lecture), Tue 1:00–3:00 PM (Tutorial) |
| **CSE263** | **Machine Learning and Pattern Recognition** | C203 O, D203 O | Mon 1:00–3:30 PM (Lecture), Wed 8:00–9:30 AM (Lab) |
| **CSE261** | **Algorithms and Data Structures** | D114 O, D202 O, D222 O | Wed 9:30 AM–12:30 PM (Lab), Wed 2:00–3:30 PM (Lecture), Thu 2:00–3:00 PM (Tutorial) |
| **CSE241** | **Electronic Design Automation** | D202 O, L102 O | Sun 2:00–3:30 PM (Lab), Mon 11:30 AM–1:00 PM (Lecture) |
| **CSE252** | **Embedded Systems Design** | D203 O, L102 O | Sun 11:00 AM–12:30 PM (Lab), Wed 4:00–5:00 PM (Tutorial), Thu 11:00 AM–1:00 PM (Lecture) |
| **CSE262** | **Software Engineering** | D113 O, D322 B | Mon 8:00–10:30 AM (Lecture), Mon 4:00–5:00 PM (Tutorial) |

---

## 🚨 Active Quizzes On Radar

- **GSE211 (Math Analysis & Numerical Methods)**:
  - **Class Quiz 1**: Sunday, 18 October 2026 (08:00 – 10:00 AM, Room C212 O)
  - Topics: *Trapezoidal Rule, Simpson’s 1/3 Rule, Numerical Integration Methods*
- **CSE263 (Machine Learning & Pattern Recognition)**:
  - **Quiz 1**: Monday, 19 October 2026 (1:00 – 3:30 PM, Room C203 O)
  - ⚠️ **Must bring printed Quiz Template!** Topics: *Intro, Regression, k-NN, Naïve Bayes*
- **CSE261 (Algorithms and Data Structures)**:
  - **Quiz 1**: Wednesday, 21 October 2026 (2:00 – 3:30 PM, Room D114 O)
  - ⚠️ **Strict Non-Backtracking!** Topics: *Algorithm Efficiency, Recursion*
- **CSE252 (Embedded Systems Design)**:
  - **Quiz 1**: Thursday, 22 October 2026 (11:00 AM – 1:00 PM, Room L102 O)
  - Format: *15-minute MCQ + Explain & Discuss*
- **University Midterms**:
  - **Fall 2026 Midterm Exams**: Saturday, 7 November 2026

---

## 🛠️ Building & Running

### Requirements
- [Rust](https://www.rust-lang.org/) (Cargo 1.80+)
- Windows, macOS, or Linux

### Quick Start
```bash
# Clone the repository
git clone https://github.com/TheDragonSoft/QuizRadar.git
cd QuizRadar

# Run the native application
cargo run --release
```

Or on Windows, simply double-click **`start.bat`**.
The app will automatically launch and open `http://127.0.0.1:5000` in your default browser.
