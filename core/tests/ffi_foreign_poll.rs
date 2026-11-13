//! UniFFI drives an exported `async fn` by POLLING its future from the
//! FOREIGN (JVM) side: `ffi_*_rust_future_poll_*` runs the poll on the
//! calling thread, and the shell polls again after the Rust side wakes it.
//!
//! `core/src/ffi.rs` exports two shapes:
//!
//! * PLAIN exports - every store accessor. The shell polls them ONCE and
//!   the future must already be settled. `Store::run` has a no-runtime path
//!   for exactly this case: UniFFI polls on a JVM thread that has no tokio
//!   reactor, so the store does the work inline instead of handing it to
//!   `spawn_blocking`.
//! * REACTOR-BACKED exports - the seven network-facing ones, marked
//!   `async_runtime = "tokio"`. The macro wraps the future in
//!   `async_compat::Compat`, so the FIRST poll answers "pending" and the
//!   compat runtime wakes the shell afterwards.
//!
//! The second shape only works when the shell resumes the woken
//! continuation OFF the wake thread: UniFFI invokes the continuation
//! callback while holding its scheduler lock (`RustFuture::wake` locks the
//! scheduler and calls the callback inside that lock), and a resume that
//! runs inline re-enters `RustFuture::poll`, which waits for that very
//! lock - a self-deadlock. The Android shell resumes on `Dispatchers.IO`,
//! which dispatches the resumption instead of running it inline.

// Test-code convention (shared with ics_fixtures/smoke/v4_backup_roundtrip):
// failing loudly IS the assertion mechanism here, so expect/unwrap/panic are
// allowed in this test crate only — production code stays deny-clean.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::future::Future;
use std::pin::Pin;
use std::sync::{mpsc, Arc};
use std::task::{Context, Poll, Wake, Waker};
use std::time::Duration;

use quizradar_core::ffi::{open_in_memory_native_store, NativeStore};

/// A waker that reports the wake back to the test thread, standing in for
/// the shell's continuation callback.
struct SignalWaker {
    signal: mpsc::Sender<()>,
}

impl Wake for SignalWaker {
    fn wake(self: Arc<Self>) {
        let _ = self.signal.send(());
    }
}

/// Polls the future once and reports whether it was already settled.
fn poll_once<F: Future + ?Sized>(mut future: Pin<&mut F>, context: &mut Context<'_>) -> bool {
    matches!(future.as_mut().poll(context), Poll::Ready(_))
}

/// Runs `build` on a foreign thread (no tokio runtime) and reports whether
/// the future it produced settled on the FIRST poll. The timeout turns a
/// hang into a failing test instead of a stuck suite.
fn settles_in_the_first_poll(
    build: impl FnOnce(Arc<NativeStore>) -> Pin<Box<dyn Future<Output = Result<bool, String>> + Send>>
        + Send
        + 'static,
) -> bool {
    let store: Arc<NativeStore> = open_in_memory_native_store()
        .unwrap_or_else(|error| panic!("in-memory store opens: {error}"));
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut future = build(store);
        // A waker that does nothing: the first poll is all this test needs.
        let waker = Waker::noop();
        let mut context = Context::from_waker(waker);
        let _ = tx.send(poll_once(future.as_mut(), &mut context));
    });
    rx.recv_timeout(Duration::from_secs(20))
        .unwrap_or_else(|error| panic!("the foreign-thread poll must settle: {error}"))
}

/// The plain store read the shell performs on a plain export.
fn plain_read(
    store: Arc<NativeStore>,
) -> Pin<Box<dyn Future<Output = Result<bool, String>> + Send>> {
    Box::pin(async move {
        store
            .get_config_bool("gemini_enabled".to_string(), false)
            .await
            .map_err(|e| e.to_string())
    })
}

/// The plain store write the shell performs on a plain export.
fn plain_write(
    store: Arc<NativeStore>,
) -> Pin<Box<dyn Future<Output = Result<bool, String>> + Send>> {
    Box::pin(async move {
        store
            .set_config_bool("gemini_enabled".to_string(), true)
            .await
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
}

#[test]
fn a_store_read_settles_in_the_first_foreign_thread_poll() {
    assert!(
        settles_in_the_first_poll(plain_read),
        "a config read polled from the foreign thread must settle in one poll, not hang the shell",
    );
}

#[test]
fn a_store_write_settles_in_the_first_foreign_thread_poll() {
    assert!(
        settles_in_the_first_poll(plain_write),
        "a config write polled from the foreign thread must settle in one poll, not hang the shell",
    );
}

#[test]
fn a_reactor_backed_export_settles_on_the_poll_after_its_wake() {
    // This is exactly what `async_runtime = "tokio"` generates: the macro
    // wraps the exported future in `async_compat::Compat`, and the foreign
    // side polls that wrapper until it is ready.
    let store: Arc<NativeStore> = open_in_memory_native_store()
        .unwrap_or_else(|error| panic!("in-memory store opens: {error}"));
    let (tx, rx) = mpsc::channel();
    let waker = Waker::from(Arc::new(SignalWaker { signal: tx }));
    let mut context = Context::from_waker(&waker);
    let mut future = Box::pin(async move {
        let inner = async move {
            store
                .get_config_bool("gemini_enabled".to_string(), false)
                .await
                .map_err(|e| e.to_string())
        };
        uniffi::deps::async_compat::Compat::new(inner).await
    });

    assert!(
        !poll_once(future.as_mut(), &mut context),
        "the compat wrapper hands the first poll to its own runtime, so the shell polls again after the wake",
    );
    rx.recv_timeout(Duration::from_secs(20))
        .unwrap_or_else(|error| panic!("the compat runtime must wake the shell: {error}"));
    assert!(
        poll_once(future.as_mut(), &mut context),
        "the poll after the wake must observe the finished work",
    );
}
