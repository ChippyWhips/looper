//! Native stem separation: demucs-rs on Metal in a background thread.
//!
//! The frontend sends the decoded PCM it is already playing (so stems line up with the mix to
//! the frame), gets a job id back at once, and hears `separation` events. Finished stems are
//! written straight into the track's `stems/` directory in the frontend's format; only metadata
//! crosses IPC on the way back.

use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use burn::backend::wgpu::{graphics::AutoGraphicsApi, init_setup, RuntimeOptions};
use cubecl::config::{autotune::AutotuneConfig, cache::CacheConfig, GlobalConfig};
use demucs_core::listener::{ForwardEvent, ForwardListener};
use demucs_core::model::metadata::{ModelInfo, ALL_MODELS, HTDEMUCS_6S_ID, HTDEMUCS_FT_ID};
use demucs_core::{Demucs, ModelOptions};
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::{models, pcm, store};

type B = burn::backend::wgpu::Wgpu;

/// Bucket width used for stem peaks (matches the frontend's minimum window width).
const PEAKS_WIDTH: usize = 1280;
/// Display order for stems, as the frontend's STEM_ORDER.
const ORDER: [&str; 6] = ["vocals", "guitar", "bass", "drums", "piano", "other"];

#[derive(Default)]
pub struct Separation {
    next: AtomicU64,
    jobs: Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>>,
    /// The last loaded model, reused across jobs; also serialises GPU work.
    engine: Arc<Mutex<Engine>>,
}

#[derive(Default)]
struct Engine {
    gpu_ready: bool,
    loaded: Option<(String, Demucs<B>)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    track_id: String,
    model: String,
    sample_rate: u32,
    length: usize,
    channels: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StemInfo {
    name: String,
    rms_db: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StemMeta {
    model: String,
    sample_rate: u32,
    length: usize,
    channels: usize,
    stems: Vec<StemInfo>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Event {
    Progress { job: u64, fraction: f64, stage: &'static str },
    Done { job: u64, meta: StemMeta, ms: u128 },
    Error { job: u64, message: String },
    Cancelled { job: u64 },
}

struct Listener<'a, F: FnMut(f64)> {
    cancelled: &'a AtomicBool,
    progress: F,
}

impl<F: FnMut(f64)> ForwardListener for Listener<'_, F> {
    fn on_event(&mut self, event: ForwardEvent) {
        if let ForwardEvent::ChunkDone { index, total } = event {
            (self.progress)((index + 1) as f64 / total as f64);
        }
    }
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }
}

fn model_info(id: &str) -> Result<&'static ModelInfo, String> {
    ALL_MODELS.iter().find(|m| m.id == id).copied().ok_or_else(|| format!("unknown model {id}"))
}

fn options(info: &ModelInfo) -> ModelOptions {
    match info.id {
        HTDEMUCS_FT_ID => ModelOptions::FineTuned(info.stems.to_vec()),
        HTDEMUCS_6S_ID => ModelOptions::SixStem,
        _ => ModelOptions::FourStem,
    }
}

/// Start a job. Body: planar little-endian f32 PCM; `x-meta` header: JSON `Meta`.
#[tauri::command]
pub async fn separate_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Separation>,
    request: Request<'_>,
) -> Result<u64, String> {
    let meta: Meta = serde_json::from_str(
        request.headers().get("x-meta").ok_or("missing x-meta")?.to_str().map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a binary body".into());
    };
    if bytes.len() != meta.length * meta.channels * 4 || meta.channels == 0 {
        return Err("PCM size does not match x-meta".into());
    }
    let floats: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
    let left = floats[..meta.length].to_vec();
    let right = if meta.channels > 1 { floats[meta.length..2 * meta.length].to_vec() } else { left.clone() };
    drop(floats);

    let job = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    let cancelled = Arc::new(AtomicBool::new(false));
    state.jobs.lock().unwrap().insert(job, cancelled.clone());
    let engine = state.engine.clone();
    let jobs = state.jobs.clone();
    let app2 = app.clone();
    thread::Builder::new()
        .name(format!("separation-{job}"))
        .spawn(move || {
            let t0 = Instant::now();
            let ev = match run(&app2, &engine, job, &meta, left, right, &cancelled) {
                Ok(m) => Event::Done { job, meta: m, ms: t0.elapsed().as_millis() },
                Err(_) if cancelled.load(Ordering::Relaxed) => Event::Cancelled { job },
                Err(message) => Event::Error { job, message },
            };
            jobs.lock().unwrap().remove(&job);
            let _ = app2.emit("separation", ev);
        })
        .map_err(|e| e.to_string())?;
    Ok(job)
}

#[tauri::command]
pub fn separate_cancel(state: State<'_, Separation>, job: u64) {
    if let Some(flag) = state.jobs.lock().unwrap().remove(&job) {
        flag.store(true, Ordering::Relaxed);
    }
}

fn run<R: Runtime>(
    app: &AppHandle<R>,
    engine: &Mutex<Engine>,
    job: u64,
    meta: &Meta,
    left: Vec<f32>,
    right: Vec<f32>,
    cancelled: &AtomicBool,
) -> Result<StemMeta, String> {
    let emit = |fraction: f64, stage: &'static str| {
        let _ = app.emit("separation", Event::Progress { job, fraction, stage });
    };
    let info = model_info(&meta.model)?;
    // One job on the GPU at a time; a cancelled job still finishing its chunk holds this.
    let mut eng = engine.lock().map_err(|_| "separation engine poisoned")?;
    if cancelled.load(Ordering::Relaxed) {
        return Err("Cancelled".into());
    }

    if !matches!(&eng.loaded, Some((id, _)) if id == info.id) {
        eng.loaded = None;
        let bytes = models::load(app, info, cancelled, |f| emit(f * 0.08, "model"))?;
        emit(0.08, "load");
        let device = Default::default();
        if !eng.gpu_ready {
            GlobalConfig::set(GlobalConfig {
                autotune: AutotuneConfig { cache: CacheConfig::Global, ..Default::default() },
                ..Default::default()
            });
            init_setup::<AutoGraphicsApi>(&device, RuntimeOptions { tasks_max: 128, ..Default::default() });
            eng.gpu_ready = true;
        }
        let model = Demucs::<B>::from_bytes(options(info), &bytes, device).map_err(|e| e.to_string())?;
        let autotune_dir = CacheConfig::Global.root().join("autotune");
        let tuned = autotune_dir.is_dir() && fs::read_dir(&autotune_dir).is_ok_and(|mut d| d.next().is_some());
        if !tuned {
            pollster::block_on(model.warmup());
        }
        eng.loaded = Some((info.id.to_string(), model));
    }
    let (_, model) = eng.loaded.as_ref().unwrap();
    emit(0.1, "separate");

    let mut listener = Listener { cancelled, progress: |f: f64| emit(0.1 + 0.85 * f, "separate") };
    let stems = pollster::block_on(model.separate_with_listener(&left, &right, meta.sample_rate, &mut listener))
        .map_err(|e| e.to_string())?;
    if cancelled.load(Ordering::Relaxed) {
        return Err("Cancelled".into());
    }
    emit(0.95, "encode");
    drop(eng);

    let root = store::root(app)?;
    let dir = store::resolve(&root, &["tracks".into(), meta.track_id.clone(), "stems".into()])?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut out: Vec<(usize, StemInfo)> = Vec::new();
    for stem in stems {
        let name = stem.id.as_str();
        if !info.stems.contains(&stem.id) {
            continue;
        }
        // Output length can differ by a few frames after internal resampling; fit to the input.
        let fit = |x: &[f32]| {
            let mut v = vec![0f32; meta.length];
            let n = x.len().min(meta.length);
            v[..n].copy_from_slice(&x[..n]);
            pcm::to_i16(&v)
        };
        let channels = vec![fit(&stem.left), fit(&stem.right)];
        let rms = pcm::rms_db(&channels);
        store::write_file(&dir.join(format!("{name}.pcm")), &pcm::encode_planar(&channels))?;
        store::write_file(&dir.join(format!("{name}.peaks")), &pcm::encode_peaks(&channels, PEAKS_WIDTH))?;
        let rank = ORDER.iter().position(|o| *o == name).unwrap_or(ORDER.len());
        out.push((rank, StemInfo { name: name.to_string(), rms_db: if rms.is_finite() { rms } else { -200.0 } }));
    }
    out.sort_by_key(|(r, _)| *r);
    let meta_out = StemMeta {
        model: info.id.to_string(),
        sample_rate: meta.sample_rate,
        length: meta.length,
        channels: 2,
        stems: out.into_iter().map(|(_, s)| s).collect(),
    };
    // Written last, so a half-written set is never treated as complete.
    store::write_file(&dir.join("meta.json"), &serde_json::to_vec(&meta_out).map_err(|e| e.to_string())?)?;
    emit(1.0, "encode");
    Ok(meta_out)
}
