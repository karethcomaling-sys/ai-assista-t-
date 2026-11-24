import { CheckCircle2, Mic, Play, Square, Volume2, X, AlertCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { computeRmsLevel } from '../utils/audioPcm';

interface MicTestModalProps {
  isOpen: boolean;
  selectedMicId: string;
  onSelectMic: (deviceId: string) => void;
  onClose: () => void;
}

export function MicTestModal({
  isOpen,
  selectedMicId,
  onSelectMic,
  onClose,
}: MicTestModalProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [recordingSample, setRecordingSample] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [liveLevel, setLiveLevel] = useState(0);
  const [peakLevel, setPeakLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const stopTest = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setTesting(false);
    setRecordingSample(false);
    setLiveLevel(0);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'audioinput'));
    } catch {
      // Ignore enumeration errors before permission
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      refreshDevices();
    } else {
      stopTest();
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(null);
      }
    }
  }, [isOpen, recordedUrl, refreshDevices, stopTest]);

  useEffect(() => {
    return () => {
      stopTest();
    };
  }, [stopTest]);

  const startLiveMeter = async () => {
    setError(null);
    setPeakLevel(0);
    try {
      const constraint: MediaTrackConstraints =
        selectedMicId && selectedMicId !== 'default'
          ? { deviceId: { exact: selectedMicId } }
          : {};
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraint });
      streamRef.current = stream;
      await refreshDevices();

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);
      setTesting(true);

      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
        const level = computeRmsLevel(buffer);
        setLiveLevel(level);
        setPeakLevel((prev) => Math.max(prev, level));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Unable to access microphone: ${err.message}`
          : 'Microphone access denied. Check Windows 11 Privacy > Microphone settings.'
      );
      stopTest();
    }
  };

  const recordTwoSecondSample = async () => {
    setError(null);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }
    try {
      let activeStream = streamRef.current;
      if (!activeStream) {
        await startLiveMeter();
        activeStream = streamRef.current;
      }
      if (!activeStream) return;

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(activeStream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
        setRecordingSample(false);
      };

      setRecordingSample(true);
      recorder.start();
      window.setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 2500);
    } catch (err) {
      setRecordingSample(false);
      setError(err instanceof Error ? err.message : 'Sample recording failed.');
    }
  };

  if (!isOpen) return null;

  const levelPercent = Math.round(liveLevel * 100);
  const peakPercent = Math.round(peakLevel * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mic-test-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#121826] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400">
              <Mic className="h-5 w-5" />
            </div>
            <div>
              <h2 id="mic-test-title" className="text-base font-semibold text-slate-100">
                Microphone Hardware Test
              </h2>
              <p className="text-xs text-slate-400">
                Verify Windows 11 audio input levels and playback quality
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-blue-500"
            aria-label="Close microphone test"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <div>
            <label
              htmlFor="mic-device-select"
              className="block text-xs font-medium text-slate-300"
            >
              Input Device
            </label>
            <select
              id="mic-device-select"
              value={selectedMicId}
              onChange={(e) => onSelectMic(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="default">System Default Microphone</option>
              {devices.map((device, index) => (
                <option key={device.deviceId || index} value={device.deviceId}>
                  {device.label || `Microphone ${index + 1}`}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0B0F17] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Live Input Level</span>
              <span className="font-mono tabular-nums text-slate-200">
                Current {levelPercent}% · Peak {peakPercent}%
              </span>
            </div>
            <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all duration-75 ${
                  levelPercent > 75
                    ? 'bg-emerald-400'
                    : levelPercent > 15
                      ? 'bg-blue-500'
                      : 'bg-slate-600'
                }`}
                style={{ width: `${Math.max(2, levelPercent)}%` }}
              />
            </div>
            <p className="mt-2.5 text-xs text-slate-400">
              {testing
                ? 'Speak normally (e.g., "Hey Assistant, what time is it?"). Watch the meter respond.'
                : 'Click Start Level Check to stream live microphone input.'}
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {recordedUrl && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-emerald-200">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>2.5s sample captured</span>
              </div>
              <audio controls src={recordedUrl} className="h-8 max-w-[230px]" />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2.5">
              {!testing ? (
                <button
                  type="button"
                  onClick={startLiveMeter}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 whitespace-nowrap shrink-0"
                >
                  <Volume2 className="h-4 w-4" />
                  Start Level Check
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopTest}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-white/10 whitespace-nowrap shrink-0"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop Check
                </button>
              )}

              <button
                type="button"
                onClick={recordTwoSecondSample}
                disabled={recordingSample}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#0B0F17] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/5 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Play className="h-3.5 w-3.5 text-blue-400" />
                {recordingSample ? 'Recording 2.5s...' : 'Record & Playback'}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100 whitespace-nowrap shrink-0"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
