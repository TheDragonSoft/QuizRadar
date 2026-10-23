// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(err) = quizradar_desktop_lib::run() {
        // Last-resort boot failure: the window was never up, so there is no UI
        // surface to show it in. Print to stderr and exit loudly (honesty
        // doctrine — never fail silently).
        #[allow(clippy::print_stderr)]
        {
            eprintln!("QuizRadar desktop failed to start: {err}");
        }
        std::process::exit(1);
    }
}
