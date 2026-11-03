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
        // Release builds ship with `windows_subsystem = "windows"`: there is
        // no console, so the eprintln above is invisible and the user sees
        // only a dead process. A refusal like SchemaTooNew ("the local
        // database was written by a newer QuizRadar build …") must be
        // surfaced, not logged into %TEMP%.
        show_boot_error_windows(&msg);
        std::process::exit(1);
    }
}

/// Native message box for the boot-failure path (Windows only; other
/// platforms keep the console stderr). Dependency-free: PowerShell's
/// PresentationFramework MessageBox, spawned detached so a failure here can
/// never block the exit.
#[cfg(target_os = "windows")]
fn show_boot_error_windows(msg: &str) {
    let one_line = msg.replace('\'', "''").replace(['\n', '\r'], " ");
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command"])
        .arg(format!(
            "Add-Type -AssemblyName PresentationFramework; \
             [System.Windows.MessageBox]::Show('{one_line}', 'QuizRadar', 'OK', 'Error')"
        ))
        .spawn();
}

#[cfg(not(target_os = "windows"))]
fn show_boot_error_windows(_msg: &str) {}
