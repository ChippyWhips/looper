//! PCM and peak encodings shared with the frontend. These must stay byte-compatible with
//! `src/lib/separation/types.ts` (`toInt16`, `rmsDb`) and `src/lib/storage/peaks-codec.ts`.

/// Float → 16-bit with clipping, rounding like `Math.round(v * 32767)`.
pub fn to_i16(x: &[f32]) -> Vec<i16> {
    x.iter()
        .map(|&v| {
            let c = v.clamp(-1.0, 1.0) as f64 * 32767.0;
            // Math.round rounds halves towards +∞.
            (c + 0.5).floor() as i16
        })
        .collect()
}

/// RMS over all channels of 16-bit PCM, in dBFS (−200 for silence).
pub fn rms_db(channels: &[Vec<i16>]) -> f64 {
    let mut s = 0.0f64;
    let mut n = 0usize;
    for ch in channels {
        for &v in ch {
            let f = v as f64 / 32768.0;
            s += f * f;
        }
        n += ch.len();
    }
    if n == 0 {
        return f64::NEG_INFINITY;
    }
    10.0 * (s / n as f64 + 1e-20).log10()
}

pub const BASE_BUCKET: usize = 32;
const MAGIC: u32 = 0x504b_5331; // "PKS1"

/// Levels so the coarsest bucket spans under 1 px at fit-to-width (as `levelCount` in peaks.ts).
pub fn level_count(length: usize, width: usize) -> usize {
    let fit = length as f64 / width as f64;
    let mut n = 1;
    while (BASE_BUCKET as f64) * 2f64.powi(n as i32) < fit {
        n += 1;
    }
    n
}

/// Multi-resolution min/max over all channels, scaled to ±1, encoded like `encodePeaks`.
pub fn encode_peaks(channels: &[Vec<i16>], width: usize) -> Vec<u8> {
    let length = channels.first().map_or(0, |c| c.len());
    let n_levels = level_count(length, width);
    let mut levels: Vec<(usize, Vec<f32>)> = Vec::with_capacity(n_levels);
    let buckets = length.div_ceil(BASE_BUCKET);
    let mut base = Vec::with_capacity(buckets * 2);
    for b in 0..buckets {
        let a = b * BASE_BUCKET;
        let e = (a + BASE_BUCKET).min(length);
        let (mut lo, mut hi) = (i16::MAX, i16::MIN);
        for ch in channels {
            for &v in &ch[a..e] {
                lo = lo.min(v);
                hi = hi.max(v);
            }
        }
        base.push(lo as f32 / 32768.0);
        base.push(hi as f32 / 32768.0);
    }
    levels.push((BASE_BUCKET, base));
    while levels.len() < n_levels {
        let (size, prev) = levels.last().unwrap();
        let n = prev.len() / 2;
        let m = n.div_ceil(2);
        let mut d = Vec::with_capacity(m * 2);
        for b in 0..m {
            let i = b * 4;
            if i + 2 < prev.len() {
                d.push(prev[i].min(prev[i + 2]));
                d.push(prev[i + 1].max(prev[i + 3]));
            } else {
                d.push(prev[i]);
                d.push(prev[i + 1]);
            }
        }
        levels.push((size * 2, d));
    }
    let head = 3 + levels.len() * 2;
    let floats: usize = levels.iter().map(|(_, d)| d.len()).sum();
    let mut out = Vec::with_capacity((head + floats) * 4);
    out.extend_from_slice(&MAGIC.to_le_bytes());
    out.extend_from_slice(&(length as u32).to_le_bytes());
    out.extend_from_slice(&(levels.len() as u32).to_le_bytes());
    for (size, d) in &levels {
        out.extend_from_slice(&(*size as u32).to_le_bytes());
        out.extend_from_slice(&(d.len() as u32).to_le_bytes());
    }
    for (_, d) in &levels {
        for v in d {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out
}

/// Planar little-endian 16-bit: all of channel 0, then channel 1 (as `saveStems` writes).
pub fn encode_planar(channels: &[Vec<i16>]) -> Vec<u8> {
    let mut out = Vec::with_capacity(channels.iter().map(|c| c.len() * 2).sum());
    for ch in channels {
        for v in ch {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn int16_matches_the_frontend() {
        assert_eq!(to_i16(&[0.0, 1.0, -1.0, 2.0, 0.5]), vec![0, 32767, -32767, 32767, 16384]);
    }

    #[test]
    fn rms_of_silence_and_full_scale() {
        assert!(rms_db(&[vec![0; 100]]) < -150.0);
        let full = rms_db(&[vec![32767; 100], vec![-32767; 100]]);
        assert!(full.abs() < 0.01);
    }

    #[test]
    fn peaks_layout_and_values() {
        let n = 10_000;
        let l: Vec<i16> = (0..n).map(|i| ((i * 37 % 2001) as i32 - 1000) as i16).collect();
        let r: Vec<i16> = l.iter().map(|v| -v / 2).collect();
        let bytes = encode_peaks(&[l.clone(), r.clone()], 64);
        let u = |o: usize| u32::from_le_bytes(bytes[o..o + 4].try_into().unwrap()) as usize;
        assert_eq!(u(0), MAGIC as usize);
        assert_eq!(u(4), n);
        let levels = u(8);
        assert_eq!(levels, level_count(n, 64));
        let head = 3 + levels * 2;
        assert_eq!(u(12), 32);
        let count0 = u(16);
        assert_eq!(count0, n.div_ceil(32) * 2);
        // First bucket of level 0 equals brute-force min/max over both channels.
        let f = |o: usize| f32::from_le_bytes(bytes[o..o + 4].try_into().unwrap());
        let lo = l[..32].iter().chain(&r[..32]).min().copied().unwrap();
        let hi = l[..32].iter().chain(&r[..32]).max().copied().unwrap();
        assert_eq!(f(head * 4), lo as f32 / 32768.0);
        assert_eq!(f(head * 4 + 4), hi as f32 / 32768.0);
        // Coarser levels double the bucket size.
        for k in 1..levels {
            assert_eq!(u(12 + k * 8), 32 << k);
        }
    }
}
