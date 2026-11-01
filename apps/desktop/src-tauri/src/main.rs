// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let log_path = std::env::temp_dir().join("quizradar-boot.log");
    let _ = std::fs::write(
        &log_path,
        format!(
            "QuizRadar starting at {:?}...\n",
            std::time::SystemTime::now()
        ),
    );

    let log_path_clone = log_path.clone();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!("PANIC: {}\n", info);
        let _ = std::fs::write(&log_path_clone, msg);
    }));

    if let Err(err) = quizradar_desktop_lib::run() {
        let msg = format!("QuizRadar desktop failed to start: {err}\n");
        let _ = std::fs::write(&log_path, &msg);
        #[allow(clippy::print_stderr)]
        {
            eprintln!("{msg}");
        }
        std::process::exit(1);
    }
}
