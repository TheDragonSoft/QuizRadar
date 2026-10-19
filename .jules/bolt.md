## 2026-03-02 - Memoizing Regex Compilation in Hot Ingestion Paths

**Learning:** Constructing regexes via `Regex::new(...)` inside function bodies in Rust triggers NFA/DFA regex parsing and dynamic heap allocation on every single invocation. In hot email/iCal parsing paths invoked per message during sync, this creates significant per-item latency overhead.

**Action:** Wrap reusable regex patterns in static `std::sync::LazyLock<Regex>` instances to guarantee single-instance thread-safe initialization on first use.
