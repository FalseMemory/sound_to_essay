use chrono::Local;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use hound::WavSpec;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

const PREFERRED_RATE: u32 = 16000;
const TARGET_CHANNELS: u16 = 1;
/// Audio is flushed to disk continuously rather than only on stop, so an
/// abnormal exit (crash, power loss, kill) still leaves a recoverable file.
const CHANNEL_CAPACITY: usize = 256;
const PCM_SUFFIX: &str = ".recording.pcm";
const META_SUFFIX: &str = ".recording.json";

#[allow(dead_code)]
struct StreamLeak(Option<std::mem::ManuallyDrop<cpal::Stream>>);
unsafe impl Send for StreamLeak {}
unsafe impl Sync for StreamLeak {}

static LEAKED_STREAM: Mutex<Option<StreamLeak>> = Mutex::new(None);

/// Sidecar metadata for a partially written recording. The frame count is not
/// stored: it is derived from the PCM file length, so the sidecar never goes
/// stale while recording is in progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMeta {
    pub id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub started_at: String,
    pub format: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizedRecording {
    pub audio_path: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
}

/// A recording that was salvaged after an abnormal exit. The caller is expected
/// to register it (memory + audio asset + transcription task) so the salvaged
/// audio is visible and can be transcribed later.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredRecording {
    pub audio_path: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
    pub started_at: String,
    pub partial_id: String,
}

struct ActiveRecording {
    id: String,
    pcm_path: PathBuf,
    meta_path: PathBuf,
    sample_rate: u32,
}

pub struct Recorder {
    recording: Arc<AtomicBool>,
    audio_dir: PathBuf,
    actual_sample_rate: Arc<Mutex<u32>>,
    /// Shared with the audio callback. Taking the sender out of this slot is how
    /// `stop` signals the writer thread to finish, because the callback itself
    /// only holds the `Arc`, never a copy of the sender.
    sender: Arc<Mutex<Option<SyncSender<Vec<f32>>>>>,
    writer: Option<JoinHandle<u64>>,
    active: Option<ActiveRecording>,
}

impl Recorder {
    pub fn new(audio_dir: PathBuf) -> Self {
        fs::create_dir_all(&audio_dir).ok();
        Recorder {
            recording: Arc::new(AtomicBool::new(false)),
            audio_dir,
            actual_sample_rate: Arc::new(Mutex::new(PREFERRED_RATE)),
            sender: Arc::new(Mutex::new(None)),
            writer: None,
            active: None,
        }
    }

    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::SeqCst)
    }

    pub fn start(&mut self) -> Result<(), String> {
        if self.recording.load(Ordering::SeqCst) {
            return Err("已经在录音中".to_string());
        }
        // A previous session may have ended abnormally; make sure no writer
        // thread is still holding the old file open.
        self.abandon_active();

        *LEAKED_STREAM.lock().map_err(|e| e.to_string())? = None;

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "未找到麦克风输入设备".to_string())?;

        let dev_name = device.name().unwrap_or_default();
        let default_cfg = device
            .default_input_config()
            .map_err(|e| format!("无法获取默认输入配置: {}", e))?;
        let fmt = default_cfg.sample_format();

        log::info!("录音设备: {} | 默认: {}ch {}Hz {:?}",
            dev_name, default_cfg.channels(), default_cfg.sample_rate().0, fmt);

        // Use the device's native configuration to avoid unsupported stream
        // configurations. Multi-channel input is downmixed to mono in the
        // callback, and the actual sample rate is used when writing the WAV.
        let channels = default_cfg.channels();
        let sample_rate = default_cfg.sample_rate().0;
        let config: StreamConfig = default_cfg.config();

        // 1) Create the partial audio file and its sidecar BEFORE the stream
        //    starts, so the very first flushed chunk is already recoverable.
        let id = uuid::Uuid::new_v4().to_string();
        let started_at = Local::now().to_rfc3339();
        let pcm_path = self.audio_dir.join(format!("{}{}", id, PCM_SUFFIX));
        let meta_path = self.audio_dir.join(format!("{}{}", id, META_SUFFIX));
        let meta = RecordingMeta {
            id: id.clone(),
            sample_rate,
            channels,
            started_at: started_at.clone(),
            format: "pcm_s16le".to_string(),
            version: 1,
        };
        write_meta(&meta_path, &meta)?;
        let file = File::create(&pcm_path).map_err(|e| format!("无法创建录音临时文件: {}", e))?;

        // 2) A dedicated writer thread keeps disk I/O off the real-time audio
        //    callback thread; the callback only performs a non-blocking send.
        let (tx, rx) = sync_channel::<Vec<f32>>(CHANNEL_CAPACITY);
        let writer = std::thread::Builder::new()
            .name("rec-writer".to_string())
            .spawn(move || write_pcm_loop(rx, file))
            .map_err(|e| format!("无法启动录音写入线程: {}", e))?;

        *self.sender.lock().map_err(|e| e.to_string())? = Some(tx);
        self.writer = Some(writer);
        *self.actual_sample_rate.lock().map_err(|e| e.to_string())? = sample_rate;
        self.recording.store(true, Ordering::SeqCst);

        let recording = self.recording.clone();
        let sender = self.sender.clone();
        let ch = channels as usize;

        let build_result = match fmt {
            SampleFormat::F32 => Self::build_f32(&device, &config, ch, recording.clone(), sender.clone()),
            SampleFormat::I16 => Self::build_i16(&device, &config, ch, recording.clone(), sender.clone()),
            SampleFormat::U16 => Self::build_u16(&device, &config, ch, recording.clone(), sender.clone()),
            _ => Err(format!("不支持的音频格式: {:?}", fmt)),
        };

        let stream = match build_result {
            Ok(stream) => stream,
            Err(error) => {
                // Roll back: stop the writer, drop the empty partial files.
                self.recording.store(false, Ordering::SeqCst);
                self.finish_writer();
                remove_quietly(&pcm_path);
                remove_quietly(&meta_path);
                return Err(error);
            }
        };
        if let Err(error) = stream.play() {
            self.recording.store(false, Ordering::SeqCst);
            self.finish_writer();
            remove_quietly(&pcm_path);
            remove_quietly(&meta_path);
            return Err(format!("无法开始录音: {}", error));
        }

        *LEAKED_STREAM.lock().map_err(|e| e.to_string())? =
            Some(StreamLeak(Some(std::mem::ManuallyDrop::new(stream))));

        self.active = Some(ActiveRecording {
            id,
            pcm_path,
            meta_path,
            sample_rate,
        });

        log::info!("录音已开始: {}Hz {}ch {:?} (分段落盘)", sample_rate, channels, fmt);
        Ok(())
    }

    pub fn stop(&mut self) -> Result<FinalizedRecording, String> {
        if !self.recording.load(Ordering::SeqCst) {
            return Err("当前没有在录音".to_string());
        }
        self.recording.store(false, Ordering::SeqCst);

        let active = self
            .active
            .take()
            .ok_or_else(|| "录音状态丢失".to_string())?;
        let frames = self.finish_writer();

        if frames == 0 {
            remove_quietly(&active.pcm_path);
            remove_quietly(&active.meta_path);
            return Err("没有录制到音频".to_string());
        }

        let wav_path = self.audio_dir.join(format!("{}.wav", active.id));
        finalize_pcm_to_wav(&active.pcm_path, &wav_path, active.sample_rate)?;

        // Only once the WAV is complete do we remove the partial files, so a
        // failure here still leaves recoverable audio behind.
        // Keep recovery files until database registration succeeds.

        let duration = frames as f64 / active.sample_rate as f64;
        log::info!("录音已保存: {:?} ({:.1}s)", wav_path, duration);
        Ok(FinalizedRecording {
            audio_path: wav_path.to_string_lossy().to_string(),
            duration_secs: duration,
            sample_rate: active.sample_rate,
        })
    }

    /// Drops the writer without producing a WAV (used when starting a new
    /// recording or when never started). Partial files are left on disk so the
    /// startup recovery pass can salvage them.
    fn abandon_active(&mut self) {
        self.recording.store(false, Ordering::SeqCst);
        self.finish_writer();
        self.active = None;
    }

    /// Signals the writer thread to finish and returns the flushed frame count.
    fn finish_writer(&mut self) -> u64 {
        if let Ok(mut slot) = self.sender.lock() {
            *slot = None;
        }
        match self.writer.take() {
            Some(handle) => handle.join().unwrap_or(0),
            None => 0,
        }
    }

    fn build_f32(
        device: &cpal::Device, config: &StreamConfig, ch: usize,
        recording: Arc<AtomicBool>, sender: Arc<Mutex<Option<SyncSender<Vec<f32>>>>>,
    ) -> Result<cpal::Stream, String> {
        device.build_input_stream::<f32, _, _>(
            config,
            move |data, _| Self::audio_callback(data, ch, &recording, &sender),
            |e| log::error!("录音错误: {}", e), None,
        ).map_err(|e| format!("f32 音频流创建失败: {}", e))
    }

    fn build_i16(
        device: &cpal::Device, config: &StreamConfig, ch: usize,
        recording: Arc<AtomicBool>, sender: Arc<Mutex<Option<SyncSender<Vec<f32>>>>>,
    ) -> Result<cpal::Stream, String> {
        device.build_input_stream::<i16, _, _>(
            config,
            move |data, _| {
                // Convert i16 to f32
                let float_data: Vec<f32> = data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                Self::audio_callback(&float_data, ch, &recording, &sender);
            },
            |e| log::error!("录音错误: {}", e), None,
        ).map_err(|e| format!("i16 音频流创建失败: {}", e))
    }

    fn build_u16(
        device: &cpal::Device, config: &StreamConfig, ch: usize,
        recording: Arc<AtomicBool>, sender: Arc<Mutex<Option<SyncSender<Vec<f32>>>>>,
    ) -> Result<cpal::Stream, String> {
        device.build_input_stream::<u16, _, _>(
            config,
            move |data, _| {
                let float_data: Vec<f32> = data.iter().map(|&s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0).collect();
                Self::audio_callback(&float_data, ch, &recording, &sender);
            },
            |e| log::error!("录音错误: {}", e), None,
        ).map_err(|e| format!("u16 音频流创建失败: {}", e))
    }

    /// Runs on the real-time audio thread: downmix to mono and hand the chunk to
    /// the writer thread without blocking. A full queue drops the chunk instead
    /// of stalling audio capture; the frame count keeps the file honest.
    fn audio_callback(
        data: &[f32], ch: usize,
        recording: &Arc<AtomicBool>,
        sender: &Arc<Mutex<Option<SyncSender<Vec<f32>>>>>,
    ) {
        if !recording.load(Ordering::SeqCst) { return; }

        let mut chunk = Vec::with_capacity(data.len() / ch.max(1));
        for frame in data.chunks(ch) {
            let mono = frame.iter().sum::<f32>() / frame.len() as f32;
            chunk.push(mono);
        }
        if chunk.is_empty() { return; }

        if let Ok(slot) = sender.lock() {
            if let Some(tx) = slot.as_ref() {
                match tx.try_send(chunk) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => {
                        log::warn!("录音写入队列已满，丢弃一个音频分块（磁盘写入过慢）");
                    }
                    Err(TrySendError::Disconnected(_)) => {}
                }
            }
        }
    }
}

/// Drains audio chunks into the partial PCM file. The file is flushed after
/// every chunk so a crash recovers everything written so far.
fn write_pcm_loop(rx: std::sync::mpsc::Receiver<Vec<f32>>, file: File) -> u64 {
    let mut writer = BufWriter::new(file);
    let mut frames: u64 = 0;
    while let Ok(chunk) = rx.recv() {
        let mut bytes = Vec::with_capacity(chunk.len() * 2);
        for &sample in &chunk {
            let clamped = sample.clamp(-1.0, 1.0);
            let value = (clamped * i16::MAX as f32) as i16;
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        if let Err(error) = writer.write_all(&bytes) {
            log::error!("写入录音分块失败: {}", error);
            break;
        }
        if let Err(error) = writer.flush() {
            log::error!("刷新录音分块失败: {}", error);
            break;
        }
        frames += chunk.len() as u64;
    }
    if let Err(error) = writer.into_inner().map_err(|e| e.into_error()).and_then(|file| file.sync_all()) {
        log::error!("录音文件落盘失败: {}", error);
    }
    frames
}

fn write_meta(path: &Path, meta: &RecordingMeta) -> Result<(), String> {
    let content = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| format!("无法写入录音元数据: {}", e))
}

fn remove_quietly(path: &Path) {
    if path.exists() {
        if let Err(error) = fs::remove_file(path) {
            log::warn!("无法删除临时文件 {:?}: {}", path, error);
        }
    }
}

/// Number of 16-bit mono frames currently present in a partial PCM file.
fn pcm_frames(pcm_path: &Path) -> u64 {
    fs::metadata(pcm_path).map(|meta| meta.len() / 2).unwrap_or(0)
}

/// Streams a partial PCM file into a finished 16-bit mono WAV.
fn finalize_pcm_to_wav(pcm_path: &Path, wav_path: &Path, sample_rate: u32) -> Result<(), String> {
    let mut reader = File::open(pcm_path).map_err(|e| format!("无法读取录音临时文件: {}", e))?;
    let spec = WavSpec {
        channels: TARGET_CHANNELS,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(wav_path, spec)
        .map_err(|e| format!("无法创建 WAV 文件: {}", e))?;

    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer).map_err(|e| format!("读取录音失败: {}", e))?;
        if read == 0 { break; }
        // Only complete 16-bit samples are written; a trailing odd byte from a
        // crash mid-write is ignored rather than corrupting the WAV.
        for pair in buffer[..read - (read % 2)].chunks_exact(2) {
            let sample = i16::from_le_bytes([pair[0], pair[1]]);
            writer.write_sample(sample).map_err(|e| format!("写入 WAV 失败: {}", e))?;
        }
    }
    writer.finalize().map_err(|e| format!("WAV 完成失败: {}", e))
}

/// Salvages recordings left behind by an abnormal exit. Any partial file with
/// at least one complete sample is turned into a playable WAV; the partial
/// files are only removed after the WAV is written successfully.
pub fn recover_partial_recordings(audio_dir: &Path) -> Vec<RecoveredRecording> {
    let mut recovered = Vec::new();
    let entries = match fs::read_dir(audio_dir) {
        Ok(entries) => entries,
        Err(_) => return recovered,
    };

    for entry in entries.flatten() {
        let meta_path = entry.path();
        let name = match meta_path.file_name().and_then(|value| value.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        if !name.ends_with(META_SUFFIX) { continue; }

        let meta = match fs::read_to_string(&meta_path)
            .map_err(|e| e.to_string())
            .and_then(|content| serde_json::from_str::<RecordingMeta>(&content).map_err(|e| e.to_string()))
        {
            Ok(meta) => meta,
            Err(error) => {
                log::warn!("跳过无法解析的录音元数据 {:?}: {}", meta_path, error);
                continue;
            }
        };

        let pcm_path = audio_dir.join(format!("{}{}", meta.id, PCM_SUFFIX));
        if !pcm_path.exists() {
            remove_quietly(&meta_path);
            continue;
        }
        let frames = pcm_frames(&pcm_path);
        if frames == 0 {
            remove_quietly(&pcm_path);
            remove_quietly(&meta_path);
            continue;
        }
        if meta.sample_rate == 0 {
            log::warn!("跳过采样率无效的录音片段 {:?}", pcm_path);
            continue;
        }

        let wav_path = audio_dir.join(format!("{}.wav", meta.id));
        match finalize_pcm_to_wav(&pcm_path, &wav_path, meta.sample_rate) {
            Ok(()) => {
                // The caller acknowledges only after durable database registration.
                let duration = frames as f64 / meta.sample_rate as f64;
                log::info!("已恢复中断录音: {:?} ({:.1}s)", wav_path, duration);
                recovered.push(RecoveredRecording {
                    audio_path: wav_path.to_string_lossy().to_string(),
                    duration_secs: duration,
                    sample_rate: meta.sample_rate,
                    started_at: meta.started_at,
                    partial_id: meta.id,
                });
            }
            Err(error) => {
                // Keep the partial files so a later attempt can still salvage it.
                log::error!("恢复中断录音失败 {:?}: {}", pcm_path, error);
            }
        }
    }

    recovered
}

/// Partial files that belong to a recording session that is currently in
/// progress: these must never be treated as unreferenced by the cleanup pass.
pub fn active_partial_files(audio_dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(audio_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_partial = path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|name| name.ends_with(PCM_SUFFIX) || name.ends_with(META_SUFFIX))
                .unwrap_or(false);
            if is_partial {
                if let Some(stem) = path.file_name().and_then(|n| n.to_str()).and_then(|n| n.strip_suffix(META_SUFFIX)) {
                    files.push(audio_dir.join(format!("{}.wav", stem)));
                }
                files.push(path);
            }
        }
    }
    files
}

pub fn acknowledge_recording(audio_path: &Path) {
    if let (Some(parent), Some(stem)) = (audio_path.parent(), audio_path.file_stem().and_then(|s| s.to_str())) {
        if uuid::Uuid::parse_str(stem).is_ok() {
            remove_quietly(&parent.join(format!("{stem}{PCM_SUFFIX}")));
            remove_quietly(&parent.join(format!("{stem}{META_SUFFIX}")));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sound-to-essay-rec-{}-{}", tag, uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finalize_writes_playable_wav_from_partial() {
        let dir = temp_dir("finalize");
        let pcm = dir.join(format!("test{}", PCM_SUFFIX));
        // 800 frames of a rising ramp at 16 kHz = 0.05s
        let mut bytes = Vec::new();
        for i in 0..800i16 {
            bytes.extend_from_slice(&i.to_le_bytes());
        }
        fs::write(&pcm, &bytes).unwrap();

        let wav = dir.join("test.wav");
        finalize_pcm_to_wav(&pcm, &wav, 16000).unwrap();

        let reader = hound::WavReader::open(&wav).unwrap();
        assert_eq!(reader.spec().sample_rate, 16000);
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.len(), 800);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn recovery_salvages_partial_and_removes_partial_files() {
        let dir = temp_dir("recover");
        let id = "abc-123".to_string();
        let pcm = dir.join(format!("{}{}", id, PCM_SUFFIX));
        let meta_path = dir.join(format!("{}{}", id, META_SUFFIX));
        let mut bytes = Vec::new();
        for _ in 0..320i16 {
            bytes.extend_from_slice(&1000i16.to_le_bytes());
        }
        fs::write(&pcm, &bytes).unwrap();
        write_meta(&meta_path, &RecordingMeta {
            id: id.clone(),
            sample_rate: 16000,
            channels: 1,
            started_at: "2026-01-01T00:00:00+08:00".to_string(),
            format: "pcm_s16le".to_string(),
            version: 1,
        }).unwrap();

        let recovered = recover_partial_recordings(&dir);
        assert_eq!(recovered.len(), 1);
        let item = &recovered[0];
        assert!((item.duration_secs - 0.02).abs() < 1e-6, "duration was {}", item.duration_secs);
        assert!(Path::new(&item.audio_path).exists());
        assert!(pcm.exists(), "partial PCM survives until registration");
        assert!(meta_path.exists(), "sidecar survives until registration");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn recovery_ignores_empty_partial_and_odd_trailing_byte() {
        let dir = temp_dir("empty");
        let id = "empty-1".to_string();
        let pcm = dir.join(format!("{}{}", id, PCM_SUFFIX));
        let meta_path = dir.join(format!("{}{}", id, META_SUFFIX));
        fs::write(&pcm, Vec::<u8>::new()).unwrap();
        write_meta(&meta_path, &RecordingMeta {
            id: id.clone(), sample_rate: 16000, channels: 1,
            started_at: "2026-01-01T00:00:00+08:00".to_string(),
            format: "pcm_s16le".to_string(), version: 1,
        }).unwrap();

        let recovered = recover_partial_recordings(&dir);
        assert!(recovered.is_empty());
        assert!(!pcm.exists());

        // A partial write that ends mid-sample must not produce a broken WAV.
        let pcm2 = dir.join(format!("odd{}", PCM_SUFFIX));
        fs::write(&pcm2, vec![1u8, 2u8, 3u8]).unwrap();
        let wav2 = dir.join("odd.wav");
        finalize_pcm_to_wav(&pcm2, &wav2, 16000).unwrap();
        let reader = hound::WavReader::open(&wav2).unwrap();
        assert_eq!(reader.len(), 1);
        fs::remove_dir_all(&dir).ok();
    }
}
