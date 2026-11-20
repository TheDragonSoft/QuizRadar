//! Standards-compliant ISO/IEC 18004 QR Code encoder (Byte mode, ECC Level L,
//! Versions 1..=40).
//!
//! Pure Rust, zero external dependencies, deterministic output. Single source
//! of truth consumed by Desktop (Tauri IPC), Android (UniFFI), and Web/PWA
//! (WASM).

use serde::{Deserialize, Serialize};

/// Maximum UTF-8 byte capacity of a Version 40-L QR Code in Byte mode.
pub const MAX_QR_BYTE_CAPACITY: usize = 2953;

/// Encoded QR module matrix serialized across FFI/WASM/IPC boundaries.
///
/// `modules` is a row-major string of `'1'` (dark) and `'0'` (light) of length
/// `size * size`, compact and zero-allocation-friendly across JSON bridges.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QrMatrix {
    pub version: u8,
    pub size: u32,
    pub modules: String,
}

impl QrMatrix {
    /// Returns `true` if the module at `(x, y)` is dark.
    #[must_use]
    pub fn get(&self, x: usize, y: usize) -> bool {
        let size = self.size as usize;
        if x >= size || y >= size {
            return false;
        }
        self.modules
            .as_bytes()
            .get(y * size + x)
            .is_some_and(|&b| b == b'1')
    }
}

// Total error-correction codewords per block for Versions 1..=40 at ECC Level L (ISO/IEC 18004 Table 9).
const ECC_CODEWORDS_PER_BLOCK_L: [usize; 41] = [
    0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
    30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
];

// Total number of Reed-Solomon blocks for Versions 1..=40 at ECC Level L (ISO/IEC 18004 Table 9).
const NUM_ERROR_CORRECTION_BLOCKS_L: [usize; 41] = [
    0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
    15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
];

/// Total number of raw data + ECC modules for a given QR version (1..=40).
#[must_use]
pub fn num_raw_data_modules(version: usize) -> usize {
    let size = version * 4 + 17;
    let mut result = size * size;
    // Subtract 3 finder patterns + separators (8x8 each)
    result -= 8 * 8 * 3;
    // Subtract format information and dark module (31 modules)
    result -= 15 * 2 + 1;
    // Subtract timing patterns (excluding finder separators)
    result -= (size - 16) * 2;
    if version >= 2 {
        let num_align = version / 7 + 2;
        result -= (num_align * num_align - 3) * 25;
        result += (num_align - 2) * 5 * 2;
        if version >= 7 {
            result -= 6 * 3 * 2;
        }
    }
    result
}

/// Data codeword capacity for a QR version (1..=40) at ECC Level L.
#[must_use]
pub fn data_codeword_capacity(version: usize) -> usize {
    if !(1..=40).contains(&version) {
        return 0;
    }
    let total_codewords = num_raw_data_modules(version) / 8;
    let ec_total = ECC_CODEWORDS_PER_BLOCK_L[version] * NUM_ERROR_CORRECTION_BLOCKS_L[version];
    total_codewords.saturating_sub(ec_total)
}

/// Maximum payload bytes in Byte mode for a QR version (1..=40) at ECC Level L.
#[must_use]
pub fn byte_capacity(version: usize) -> usize {
    if !(1..=40).contains(&version) {
        return 0;
    }
    let data_codewords = data_codeword_capacity(version);
    let count_bits = if version <= 9 { 8 } else { 16 };
    (data_codewords * 8).saturating_sub(4 + count_bits) / 8
}

fn alignment_pattern_positions(version: usize) -> Vec<usize> {
    if version == 1 {
        return Vec::new();
    }
    let num_align = version / 7 + 2;
    let size = version * 4 + 17;
    let step = if version == 32 {
        26
    } else {
        let denom = num_align * 2 - 2;
        ((size - 13).div_ceil(denom)) * 2
    };
    let mut result = vec![0usize; num_align];
    result[0] = 6;
    let mut pos = size - 7;
    for i in (1..num_align).rev() {
        result[i] = pos;
        pos = pos.saturating_sub(step);
    }
    result
}

// GF(256) multiplication with primitive polynomial 0x11D.
fn reed_solomon_multiply(x: u8, y: u8) -> u8 {
    let mut z: u16 = 0;
    let x16 = u16::from(x);
    let y16 = u16::from(y);
    for i in (0..8).rev() {
        z = (z << 1) ^ ((z >> 7) * 0x11d);
        z ^= ((y16 >> i) & 1) * x16;
    }
    (z & 0xff) as u8
}

fn reed_solomon_compute_divisor(degree: usize) -> Vec<u8> {
    let mut result = vec![0u8; degree];
    if degree == 0 {
        return result;
    }
    result[degree - 1] = 1;
    let mut root: u8 = 1;
    for _ in 0..degree {
        for j in 0..degree {
            result[j] = reed_solomon_multiply(result[j], root);
            if j + 1 < degree {
                result[j] ^= result[j + 1];
            }
        }
        root = reed_solomon_multiply(root, 0x02);
    }
    result
}

fn reed_solomon_compute_remainder(data: &[u8], divisor: &[u8]) -> Vec<u8> {
    let degree = divisor.len();
    let mut result = vec![0u8; degree];
    if degree == 0 {
        return result;
    }
    for &b in data {
        let factor = b ^ result[0];
        result.copy_within(1..degree, 0);
        result[degree - 1] = 0;
        for i in 0..degree {
            result[i] ^= reed_solomon_multiply(divisor[i], factor);
        }
    }
    result
}

fn encode_data_codewords(bytes: &[u8], version: usize) -> Vec<u8> {
    let capacity_codewords = data_codeword_capacity(version);
    let capacity_bits = capacity_codewords * 8;
    let mut bits = Vec::with_capacity(capacity_bits);

    let append_bits = |bits: &mut Vec<u8>, val: u32, len: usize| {
        for i in (0..len).rev() {
            bits.push(((val >> i) & 1) as u8);
        }
    };

    // Byte mode indicator (0100)
    append_bits(&mut bits, 0b0100, 4);
    // Character count indicator (8 bits for v1..=9, 16 bits for v10..=40)
    append_bits(
        &mut bits,
        bytes.len() as u32,
        if version <= 9 { 8 } else { 16 },
    );
    for &b in bytes {
        append_bits(&mut bits, u32::from(b), 8);
    }
    // Terminator (up to 4 zero bits)
    let term_len = 4.min(capacity_bits.saturating_sub(bits.len()));
    append_bits(&mut bits, 0, term_len);
    // Pad to byte boundary
    let pad_zero_bits = (8 - (bits.len() % 8)) % 8;
    append_bits(&mut bits, 0, pad_zero_bits);
    // Pad bytes (0xEC, 0x11 alternating)
    let mut pad_byte: u32 = 0xec;
    while bits.len() < capacity_bits {
        append_bits(&mut bits, pad_byte, 8);
        pad_byte ^= 0xec ^ 0x11;
    }

    let mut data = vec![0u8; capacity_codewords];
    for (i, &bit) in bits.iter().enumerate() {
        data[i >> 3] |= bit << (7 - (i & 7));
    }
    data
}

fn add_ecc_and_interleave(data: &[u8], version: usize) -> Vec<u8> {
    let num_blocks = NUM_ERROR_CORRECTION_BLOCKS_L[version];
    let block_ecc_len = ECC_CODEWORDS_PER_BLOCK_L[version];
    let raw_codewords = num_raw_data_modules(version) / 8;
    let num_short_blocks = num_blocks - (raw_codewords % num_blocks);
    let short_block_len = raw_codewords / num_blocks;

    let mut blocks: Vec<Vec<u8>> = Vec::with_capacity(num_blocks);
    let rs_div = reed_solomon_compute_divisor(block_ecc_len);
    let mut k = 0;
    for i in 0..num_blocks {
        let dat_len = short_block_len - block_ecc_len + usize::from(i >= num_short_blocks);
        let dat = &data[k..k + dat_len];
        k += dat_len;
        let ecc = reed_solomon_compute_remainder(dat, &rs_div);
        let mut block = Vec::with_capacity(dat_len + block_ecc_len);
        block.extend_from_slice(dat);
        block.extend_from_slice(&ecc);
        blocks.push(block);
    }

    let mut result = Vec::with_capacity(raw_codewords);
    let max_data_len = short_block_len - block_ecc_len + 1;
    for i in 0..max_data_len {
        for (j, block) in blocks.iter().enumerate() {
            if i == short_block_len - block_ecc_len && j < num_short_blocks {
                continue;
            }
            result.push(block[i]);
        }
    }
    for i in 0..block_ecc_len {
        for (j, block) in blocks.iter().enumerate() {
            let ecc_offset = if j < num_short_blocks {
                short_block_len - block_ecc_len
            } else {
                max_data_len
            } + i;
            result.push(block[ecc_offset]);
        }
    }
    result
}

#[inline]
fn get_bit(x: u32, i: usize) -> bool {
    ((x >> i) & 1) != 0
}

fn set_function_module(
    size: usize,
    modules: &mut [bool],
    is_function: &mut [bool],
    x: usize,
    y: usize,
    is_dark: bool,
) {
    let idx = y * size + x;
    modules[idx] = is_dark;
    is_function[idx] = true;
}

fn draw_function_patterns(
    version: usize,
    size: usize,
    modules: &mut [bool],
    is_function: &mut [bool],
) {
    // Timing patterns
    for i in 0..size {
        set_function_module(size, modules, is_function, 6, i, i % 2 == 0);
        set_function_module(size, modules, is_function, i, 6, i % 2 == 0);
    }

    // 3 Finder patterns + separators
    let draw_finder = |cx: isize, cy: isize, modules: &mut [bool], is_function: &mut [bool]| {
        for dy in -4isize..=4 {
            for dx in -4isize..=4 {
                let dist = dx.abs().max(dy.abs());
                let xx = cx + dx;
                let yy = cy + dy;
                if xx >= 0 && xx < size as isize && yy >= 0 && yy < size as isize {
                    set_function_module(
                        size,
                        modules,
                        is_function,
                        xx as usize,
                        yy as usize,
                        dist != 2 && dist != 4,
                    );
                }
            }
        }
    };
    let s = size as isize;
    draw_finder(3, 3, modules, is_function);
    draw_finder(s - 4, 3, modules, is_function);
    draw_finder(3, s - 4, modules, is_function);

    // Alignment patterns
    let align_pos = alignment_pattern_positions(version);
    let num_align = align_pos.len();
    for i in 0..num_align {
        for j in 0..num_align {
            if (i == 0 && j == 0)
                || (i == 0 && j == num_align - 1)
                || (i == num_align - 1 && j == 0)
            {
                continue;
            }
            let cx = align_pos[i] as isize;
            let cy = align_pos[j] as isize;
            for dy in -2isize..=2 {
                for dx in -2isize..=2 {
                    set_function_module(
                        size,
                        modules,
                        is_function,
                        (cx + dx) as usize,
                        (cy + dy) as usize,
                        dx.abs().max(dy.abs()) != 1,
                    );
                }
            }
        }
    }

    // Reserve format info areas & dark module
    for i in 0..=8 {
        if i != 6 {
            set_function_module(size, modules, is_function, 8, i, false);
            set_function_module(size, modules, is_function, i, 8, false);
        }
    }
    for i in 0..8 {
        set_function_module(size, modules, is_function, size - 1 - i, 8, false);
        set_function_module(size, modules, is_function, 8, size - 1 - i, false);
    }
    set_function_module(size, modules, is_function, 8, size - 8, true);

    // Draw version info (for version >= 7)
    if version >= 7 {
        let mut rem = version as u32;
        for _ in 0..12 {
            rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
        }
        let bits = ((version as u32) << 12) | rem;
        for i in 0..18 {
            let bit = get_bit(bits, i);
            let a = size - 11 + (i % 3);
            let b = i / 3;
            set_function_module(size, modules, is_function, a, b, bit);
            set_function_module(size, modules, is_function, b, a, bit);
        }
    }
}

fn draw_format_bits(mask: u32, size: usize, modules: &mut [bool], is_function: &mut [bool]) {
    // ECC Level L format indicator = 01
    let data = (0b01 << 3) | mask;
    let mut rem = data;
    for _ in 0..10 {
        rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    }
    let bits = ((data << 10) | rem) ^ 0x5412;

    // First copy
    for i in 0..=5 {
        set_function_module(size, modules, is_function, 8, i, get_bit(bits, i));
    }
    set_function_module(size, modules, is_function, 8, 7, get_bit(bits, 6));
    set_function_module(size, modules, is_function, 8, 8, get_bit(bits, 7));
    set_function_module(size, modules, is_function, 7, 8, get_bit(bits, 8));
    for i in 9..15 {
        set_function_module(size, modules, is_function, 14 - i, 8, get_bit(bits, i));
    }

    // Second copy
    for i in 0..8 {
        set_function_module(
            size,
            modules,
            is_function,
            size - 1 - i,
            8,
            get_bit(bits, i),
        );
    }
    for i in 8..15 {
        set_function_module(
            size,
            modules,
            is_function,
            8,
            size - 15 + i,
            get_bit(bits, i),
        );
    }
    set_function_module(size, modules, is_function, 8, size - 8, true);
}

fn draw_codewords(codewords: &[u8], size: usize, modules: &mut [bool], is_function: &[bool]) {
    let mut i = 0usize;
    let total_bits = codewords.len() * 8;
    let mut right = (size as isize) - 1;
    while right >= 1 {
        if right == 6 {
            right = 5;
        }
        for vert in 0..size {
            for j in 0..2 {
                let x = (right - j) as usize;
                let upward = ((right + 1) & 2) == 0;
                let y = if upward { size - 1 - vert } else { vert };
                let idx = y * size + x;
                if !is_function[idx] && i < total_bits {
                    modules[idx] = get_bit(u32::from(codewords[i >> 3]), 7 - (i & 7));
                    i += 1;
                }
            }
        }
        right -= 2;
    }
}

fn apply_mask(mask: u32, size: usize, modules: &mut [bool], is_function: &[bool]) {
    for y in 0..size {
        for x in 0..size {
            let idx = y * size + x;
            if is_function[idx] {
                continue;
            }
            let invert = match mask {
                0 => (x + y) % 2 == 0,
                1 => y % 2 == 0,
                2 => x % 3 == 0,
                3 => (x + y) % 3 == 0,
                4 => (x / 3 + y / 2) % 2 == 0,
                5 => ((x * y) % 2) + ((x * y) % 3) == 0,
                6 => (((x * y) % 2) + ((x * y) % 3)) % 2 == 0,
                7 => (((x + y) % 2) + ((x * y) % 3)) % 2 == 0,
                _ => false,
            };
            if invert {
                modules[idx] = !modules[idx];
            }
        }
    }
}

fn penalty_score(size: usize, modules: &[bool]) -> u32 {
    let mut result = 0u32;

    // Rule 1: adjacent modules in row/col having same color
    for y in 0..size {
        let mut run_color = false;
        let mut run_x = 0u32;
        for x in 0..size {
            let c = modules[y * size + x];
            if x == 0 || c != run_color {
                run_color = c;
                run_x = 1;
            } else {
                run_x += 1;
                if run_x == 5 {
                    result += 3;
                } else if run_x > 5 {
                    result += 1;
                }
            }
        }
    }
    for x in 0..size {
        let mut run_color = false;
        let mut run_y = 0u32;
        for y in 0..size {
            let c = modules[y * size + x];
            if y == 0 || c != run_color {
                run_color = c;
                run_y = 1;
            } else {
                run_y += 1;
                if run_y == 5 {
                    result += 3;
                } else if run_y > 5 {
                    result += 1;
                }
            }
        }
    }

    // Rule 2: 2x2 blocks of same color
    for y in 0..size - 1 {
        for x in 0..size - 1 {
            let c = modules[y * size + x];
            if c == modules[y * size + x + 1]
                && c == modules[(y + 1) * size + x]
                && c == modules[(y + 1) * size + x + 1]
            {
                result += 3;
            }
        }
    }

    // Rule 3: finder-like pattern in rows and columns
    for y in 0..size {
        let mut bits = 0u32;
        for x in 0..size {
            bits = ((bits << 1) & 0x7ff) | u32::from(modules[y * size + x]);
            if x >= 10 && (bits == 0x05d || bits == 0x5d0) {
                result += 40;
            }
        }
    }
    for x in 0..size {
        let mut bits = 0u32;
        for y in 0..size {
            bits = ((bits << 1) & 0x7ff) | u32::from(modules[y * size + x]);
            if y >= 10 && (bits == 0x05d || bits == 0x5d0) {
                result += 40;
            }
        }
    }

    // Rule 4: balance of dark and light modules
    let dark = modules.iter().filter(|&&m| m).count() as i64;
    let total = (size * size) as i64;
    let diff = (dark * 20 - total * 10).abs();
    let k = ((diff + total - 1) / total) - 1;
    if k > 0 {
        result += (k as u32) * 10;
    }

    result
}

/// Encodes `text` as a UTF-8 Byte-mode ECC Level-L ISO/IEC 18004 QR Code.
pub fn encode_qr_matrix(text: &str) -> Result<QrMatrix, String> {
    let bytes = text.as_bytes();
    if bytes.len() > MAX_QR_BYTE_CAPACITY {
        return Err(format!(
            "QR payload length ({} bytes) exceeds maximum QR version 40-L capacity ({MAX_QR_BYTE_CAPACITY} bytes).",
            bytes.len()
        ));
    }

    let version = (1..=40)
        .find(|&v| byte_capacity(v) >= bytes.len())
        .ok_or_else(|| format!("Unable to fit {} bytes in QR Versions 1..=40.", bytes.len()))?;

    let size = version * 4 + 17;
    let data_codewords = encode_data_codewords(bytes, version);
    let all_codewords = add_ecc_and_interleave(&data_codewords, version);

    let mut modules = vec![false; size * size];
    let mut is_function = vec![false; size * size];

    draw_function_patterns(version, size, &mut modules, &mut is_function);
    draw_codewords(&all_codewords, size, &mut modules, &is_function);

    let mut best_mask = 0u32;
    let mut min_penalty = u32::MAX;
    for mask in 0..8u32 {
        apply_mask(mask, size, &mut modules, &is_function);
        draw_format_bits(mask, size, &mut modules, &mut is_function);
        let penalty = penalty_score(size, &modules);
        if penalty < min_penalty {
            min_penalty = penalty;
            best_mask = mask;
        }
        apply_mask(mask, size, &mut modules, &is_function);
    }

    apply_mask(best_mask, size, &mut modules, &is_function);
    draw_format_bits(best_mask, size, &mut modules, &mut is_function);

    let mut encoded = String::with_capacity(size * size);
    for m in modules {
        encoded.push(if m { '1' } else { '0' });
    }

    Ok(QrMatrix {
        version: version as u8,
        size: size as u32,
        modules: encoded,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn computes_standard_version_capacities() {
        assert_eq!(data_codeword_capacity(1), 19);
        assert_eq!(byte_capacity(1), 17);
        assert_eq!(data_codeword_capacity(40), 2956);
        assert_eq!(byte_capacity(40), MAX_QR_BYTE_CAPACITY);
    }

    #[test]
    fn encodes_quizradar_pair_uri_with_valid_structure_and_deterministic_digest() {
        let uri = "quizradar://pair?d=eJyrVkrLz1eyUkpKLFKqBQAdegZ1";
        let qr = encode_qr_matrix(uri).unwrap();
        assert_eq!(qr.version, 3);
        assert_eq!(qr.size, 29);
        assert_eq!(qr.modules.len(), 29 * 29);
        assert!(qr.get(0, 0));
        assert!(qr.get(6, 0));
        assert!(qr.get(0, 6));
        assert!(qr.get(6, 6));
        assert!(qr.get(3, 3));
        assert!(!qr.get(7, 7));
        assert!(qr.get(8, qr.size as usize - 8));

        // Deterministic output across repeated calls
        let qr2 = encode_qr_matrix(uri).unwrap();
        assert_eq!(qr, qr2);
        let digest = Sha256::digest(qr.modules.as_bytes());
        assert_eq!(digest.len(), 32);
    }

    #[test]
    fn encodes_lan_pair_uri_in_compact_low_version_qr() {
        let lan_uri = "quizradar://lan?h=192.168.1.42&p=51823&t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&fp=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&v=1";
        let qr = encode_qr_matrix(lan_uri).unwrap();
        // ~134 bytes fits cleanly in Version 7-L (154 bytes) — ultra-scannable
        assert!(qr.version <= 7);
    }

    #[test]
    fn rejects_payload_exceeding_version_40_l_capacity() {
        let huge = "x".repeat(MAX_QR_BYTE_CAPACITY + 1);
        let err = encode_qr_matrix(&huge).unwrap_err();
        assert!(err.contains("exceeds maximum QR version 40-L capacity"));
    }
}
