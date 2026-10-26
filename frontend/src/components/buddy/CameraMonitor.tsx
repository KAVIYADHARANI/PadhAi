/**
 * Camera Monitor & Privacy UI Component.
 *
 * Provides:
 * 1. Always-visible privacy status indicator badge with 1-click turn-off.
 * 2. Opt-in dialog with clear privacy disclosure (frames never leave device).
 * 3. Study mode selection (Screen, Book/notes, Presence-only, Camera Off).
 * 4. Real-time telemetry inspector (eye closure, jaw drop, pitch/yaw, quality).
 * 5. Offline time-series recorder controls for calibration.
 */

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  Eye,
  Play,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { signalRecorder } from "../../buddy/recorder";
import { signalManager } from "../../buddy/signalManager";
import { CameraState, CameraStudyMode, FaceSignalsPayload } from "../../buddy/types";

interface CameraMonitorProps {
  className?: string;
}

export const CameraMonitor: React.FC<CameraMonitorProps> = ({ className = "" }) => {
  const [cameraState, setCameraState] = useState<CameraState>(signalManager.getState());
  const [signals, setSignals] = useState<FaceSignalsPayload | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [isRecording, setIsRecording] = useState(signalRecorder.isActive());
  const [recordedCount, setRecordedCount] = useState(0);

  useEffect(() => {
    const unsubState = signalManager.subscribeState((st) => setCameraState(st));
    const unsubSignals = signalManager.subscribeSignals((sig) => {
      setSignals(sig);
      if (signalRecorder.isActive()) {
        setRecordedCount(signalRecorder.getSamples().length);
      }
    });

    return () => {
      unsubState();
      unsubSignals();
    };
  }, []);

  const handleToggleCamera = async () => {
    if (cameraState.isEnabled) {
      signalManager.stop();
    } else {
      await signalManager.start();
    }
  };

  const handleModeChange = (mode: CameraStudyMode) => {
    signalManager.setMode(mode);
  };

  const handleStartRecording = () => {
    signalRecorder.start();
    setIsRecording(true);
    setRecordedCount(0);
  };

  const handleStopAndDownload = () => {
    const session = signalRecorder.stop();
    setIsRecording(false);
    if (session && session.sample_count > 0) {
      signalRecorder.downloadJson();
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Always-visible privacy badge indicator */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className={`group flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
            !cameraState.isEnabled
              ? "bg-slate-800/80 text-slate-400 border-slate-700/80 hover:bg-slate-800 hover:text-slate-200"
              : cameraState.isLowQuality
              ? "bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20"
              : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20"
          }`}
          title="Study Buddy Focus Sensor Settings & Privacy Status"
        >
          {!cameraState.isEnabled ? (
            <>
              <CameraOff className="w-3.5 h-3.5 text-slate-400" />
              <span>Camera Off</span>
            </>
          ) : cameraState.isLowQuality ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              <span className="truncate max-w-[120px]">Low Light (Presence)</span>
            </>
          ) : (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>Sensor Active</span>
            </>
          )}

          <ShieldCheck className="w-3.5 h-3.5 ml-0.5 text-slate-400 group-hover:text-white" />
        </button>

        {/* Quick turn-off button when active */}
        {cameraState.isEnabled && (
          <button
            type="button"
            onClick={handleToggleCamera}
            className="p-1.5 rounded-xl bg-slate-800/80 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-slate-700/60 transition"
            title="Turn camera sensor off instantly"
          >
            <CameraOff className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Opt-in & Privacy Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="glass-panel max-w-md w-full rounded-3xl border border-slate-700 bg-slate-900/95 p-6 shadow-2xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-brand-500/20 text-brand-400 flex items-center justify-center">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Focus & Drowsiness Sensor</h3>
                  <p className="text-[11px] text-slate-400">MediaPipe client-side privacy architecture</p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Privacy Guarantee Pledge */}
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Zero Image / Video Storage Guarantee</span>
              </div>
              <p className="text-[11px] text-emerald-200/90 leading-relaxed">
                Raw camera frames are processed exclusively inside an isolated Web Worker on your device at 8 FPS.
                No pictures, videos, or facial images are EVER stored or sent across the network.
              </p>
            </div>

            {/* Camera Enable Toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-white">Sensor Status</span>
                <p className="text-[10px] text-slate-400">
                  {cameraState.isEnabled ? "Webcam active for posture & blink signals" : "Camera off (Sensors standby)"}
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleCamera}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm ${
                  cameraState.isEnabled
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30"
                    : "bg-brand-600 text-white hover:bg-brand-500"
                }`}
              >
                {cameraState.isEnabled ? "Stop Sensor" : "Enable Sensor"}
              </button>
            </div>

            {/* Error banner if permission denied */}
            {cameraState.error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{cameraState.error}</span>
              </div>
            )}

            {/* Study Mode Selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Study Mode (Adjusts Tolerance)</label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {(
                  [
                    { id: "screen", label: "Screen Focus", desc: "Standard screen learning" },
                    { id: "book_notes", label: "Book / Notes", desc: "Tolerates looking down" },
                    { id: "presence_only", label: "Presence Only", desc: "No blink/yawn scoring" },
                    { id: "camera_off", label: "Camera Off", desc: "Timer & input only" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleModeChange(m.id)}
                    className={`p-2.5 rounded-xl border text-left transition ${
                      cameraState.mode === m.id
                        ? "bg-brand-500/20 border-brand-500/40 text-white"
                        : "bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="font-semibold">{m.label}</div>
                    <div className="text-[10px] text-slate-500">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Real-time Telemetry Viewer */}
            {cameraState.isEnabled && (
              <div className="space-y-2 pt-1 border-t border-slate-800">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-brand-400" />
                    Live Numeric Signals
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTelemetry(!showTelemetry)}
                    className="text-[11px] text-brand-400 hover:underline"
                  >
                    {showTelemetry ? "Hide" : "Inspect"}
                  </button>
                </div>

                {showTelemetry && signals && (
                  <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2 text-[11px] font-mono">
                    <div className="flex justify-between items-center text-slate-300">
                      <span>Face Detected:</span>
                      <span className={signals.facePresent ? "text-emerald-400" : "text-rose-400"}>
                        {signals.facePresent ? "Yes" : "No"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-slate-300">
                      <span>Signal Quality:</span>
                      <span className={signals.qualityScore >= 40 ? "text-emerald-400" : "text-amber-400"}>
                        {signals.qualityScore}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-slate-300">
                      <span>Eye Closure:</span>
                      <span className="text-brand-300">{Math.round(signals.eyeClosure * 100)}%</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-300">
                      <span>Jaw Drop (Yawn):</span>
                      <span className="text-brand-300">{Math.round(signals.jawOpen * 100)}%</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-300">
                      <span>Head Pitch / Yaw:</span>
                      <span className="text-slate-400">
                        {Math.round(signals.pitchDeg)}° / {Math.round(signals.yawDeg)}°
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Offline Signal Recorder for Threshold Calibration */}
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <div className="text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300 block">Calibration Recorder</span>
                <span>{isRecording ? `Recording (${recordedCount} samples)` : "Inactive (Off by default)"}</span>
              </div>
              {isRecording ? (
                <button
                  type="button"
                  onClick={handleStopAndDownload}
                  className="px-3 py-1.5 rounded-xl bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Square className="w-3 h-3" />
                  <span>Stop & Download</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!cameraState.isEnabled}
                  onClick={handleStartRecording}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium flex items-center gap-1.5 transition"
                >
                  <Play className="w-3 h-3 text-brand-400" />
                  <span>Record JSON</span>
                </button>
              )}
            </div>

            {/* Footer */}
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
