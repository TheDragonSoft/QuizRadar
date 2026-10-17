fn main() {
    #[cfg(windows)]
    {
        println!("cargo:rerun-if-changed=assets/icon.ico");
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/icon.ico");
        res.set("ProductName", "QuizRadar");
        res.set("FileDescription", "QuizRadar — Academic Dashboard & Smart Exam Calendar");
        res.set("CompanyName", "TheDragonSoft");
        let _ = res.compile();
    }
}
