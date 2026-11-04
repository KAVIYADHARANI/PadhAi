/**
 * Camera Monitor & Privacy UI Component.
 *
 * Provides:
 * 1. Always-visible privacy status indicator badge with 1-click turn-off.
 * 2. Responsive right-side slide-over drawer (approx 400px wide on desktop/tablet,
 *    near full-width on mobile) with clear backdrop and internal scrolling.
 *    Eliminates all layout overlap with dashboard cards, upload area, and navigation.
 * 3. Opt-in flow with clear privacy disclosure (frames never leave device).
 * 4. Permission handling: explains webcam usage before prompting, handles denied
 *    permission with retry button, releases hardware immediately on stop.
 * 5. Study mode selection (Screen, Book/notes, Presence-only, Camera Off).
 * 6. Proactive Voice Reminder controls (independent opt-in, quiet mode, cooldown).
 * 7. Real-time telemetry inspector (eye closure, jaw drop, pitch/yaw, quality).
 * 8. Offline time-series recorder controls for calibration.
 */

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  ChevronDown,
  ChevronUp,
  Eye,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { focusEvaluator, FocusState } from "../../buddy/focusEvaluator";
import { reminderManager } from "../../buddy/reminderManager";
import { signalRecorder } from "../../buddy/recorder";
import { signalManager } from "../../buddy/signalManager";
import { CameraState, CameraStudyMode, FaceSignalsPayload } from "../../buddy/types";

interface CameraMonitorProps {
  className?: string;
}

export const CameraMonitor: React.FC<CameraMonitorProps> = ({ className = "" }) => {
  const [cameraState, setCameraState] = useState<CameraState>(signalManager.getState());
  const [signals, setSignals] = useState<FaceSignalsPayload | null>(null);
  const [focusState, setFocusState] = useState<FocusState>(focusEvaluator.getState());
  const [showDrawer, setShowDrawer] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [isRecording, setIsRecording] = useState(signalRecorder.isActive());
  const [recordedCount, setRecordedCount] = useState(0);

  // Proactive voice reminder settings
  const [proactiveVoice, setProactiveVoice] = useState(reminderManager.isProactiveVoiceEnabled());
  const [quietMode, setQuietMode] = useState(reminderManager.isQuietMode());
  const [cooldownS, setCooldownS] = useState(focusEvaluator.getConfig().cooldownS);

  useEffect(() => {
    const unsubState = signalManager.subscribeState((st) => setCameraState(st));
    const unsubSignals = signalManager.subscribeSignals((sig) => {
      setSignals(sig);
      if (signalRecorder.isActive()) {
        setRecordedCount(signalRecorder.getSamples().length);
      }
    });
    const unsubFocus = focusEvaluator.subscribe((event) => {
      setFocusState(event.state);
    });

    return () => {
      unsubState();
      unsubSignals();
      unsubFocus();
    };
  }, []);

  // Keyboard accessibility: Escape closes the drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showDrawer) {
        setShowDrawer(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showDrawer]);

  const handleToggleCamera = async () => {
    if (cameraState.isEnabled) {
      signalManager.stop();
    } else {
      await signalManager.start();
    }
  };

  const handleRetryPermission = async () => {
    await signalManager.start();
  };

  const handleModeChange = (mode: CameraStudyMode) => {
    signalManager.setMode(mode);
  };

  const handleToggleProactiveVoice = () => {
    const nextVal = !proactiveVoice;
    setProactiveVoice(nextVal);
    reminderManager.setProactiveVoiceEnabled(nextVal);
  };

  const handleToggleQuietMode = () => {
    const nextVal = !quietMode;
    setQuietMode(nextVal);
    reminderManager.setQuietMode(nextVal);
  };

  const handleChangeCooldown = (seconds: number) => {
    setCooldownS(seconds);
    focusEvaluator.updateConfig({ cooldownS: seconds });
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
          onClick={() => setShowDrawer(true)}
          className={`group flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition cursor-pointer select-none ${
            !cameraState.isEnabled
              ? "bg-slate-800/80 text-slate-400 border-slate-700/80 hover:bg-slate-800 hover:text-slate-200"
              : focusState === "looking_away"
              ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
              : focusState === "drowsy"
              ? "bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30"
              : cameraState.isLowQuality || focusState === "uncertain"
              ? "bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20"
              : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20"
          }`}
          title="Focus & Drowsiness Sensor Settings & Privacy Status"
        >
          {!cameraState.isEnabled ? (
            <>
              <CameraOff className="w-3.5 h-3.5 text-slate-400" />
              <span>Camera Off</span>
            </>
          ) : focusState === "looking_away" ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              <span>Looking Away</span>
            </>
          ) : focusState === "drowsy" ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
              <span>Drowsiness Alert</span>
            </>
          ) : cameraState.isLowQuality || focusState === "uncertain" ? (
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

      {/* Responsive Right-Side Drawer with Backdrop */}
      {showDrawer && (
        <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true">
          {/* Dimmed backdrop preventing background interaction */}
          <div
            onClick={() => setShowDrawer(false)}
            className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
          />

          {/* Drawer container pinned to right on desktop/tablet, bottom-sheet/full on mobile */}
          <div className="fixed inset-y-0 right-0 z-50 flex max-w-full pl-0 sm:pl-10">
            <div className="w-screen max-w-full sm:w-[400px] md:w-[420px] bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col h-full transform transition ease-in-out duration-300 animate-in slide-in-from-right">
              {/* Drawer Header (pinned) */}
              <div className="shrink-0 px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-brand-500/20 text-brand-400 flex items-center justify-center shrink-0">
                    <Camera className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white truncate">
                      Focus & Drowsiness Sensor
                    </h3>
                    <p className="text-[11px] text-slate-400 truncate">
                      Client-side privacy architecture
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDrawer(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition shrink-0 ml-2"
                  aria-label="Close sensor drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Drawer Scrollable Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-w-0">
                {/* Privacy Guarantee Pledge */}
                <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs space-y-1.5 min-w-0">
                  <div className="flex items-center gap-1.5 font-bold">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">Zero Image / Video Storage Guarantee</span>
                  </div>
                  <p className="text-[11px] text-emerald-200/90 leading-relaxed break-words">
                    Raw camera frames are processed exclusively inside an isolated Web Worker on your device at 8 FPS.
                    No pictures, videos, or facial images are EVER stored or sent across the network.
                  </p>
                </div>

                {/* Camera Enable Toggle & Status */}
                <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <span className="text-xs font-semibold text-white block">Sensor Status</span>
                      <p className="text-[10px] text-slate-400 break-words">
                        {cameraState.isEnabled
                          ? "Webcam active for posture & blink signals"
                          : "Camera off (Sensors in standby)"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleToggleCamera}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm shrink-0 ${
                        cameraState.isEnabled
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30"
                          : "bg-brand-600 text-white hover:bg-brand-500"
                      }`}
                    >
                      {cameraState.isEnabled ? "Stop Sensor" : "Enable Sensor"}
                    </button>
                  </div>

                  {!cameraState.isEnabled && (
                    <p className="text-[10px] text-slate-400 leading-relaxed border-t border-slate-850 pt-2 break-words">
                      Webcam access is requested only after you click Enable Sensor. It is used strictly on-device to measure head angle and blink rate for your study companion.
                    </p>
                  )}
                </div>

                {/* Error Banner if permission denied */}
                {cameraState.error && (
                  <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs space-y-2 min-w-0">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span className="leading-relaxed break-words">{cameraState.error}</span>
                    </div>
                    <div className="pt-1 flex justify-end">
                      <button
                        type="button"
                        onClick={handleRetryPermission}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 rounded-lg text-[11px] font-semibold transition"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Retry Permission</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Study Mode Selector */}
                <div className="space-y-2 min-w-0">
                  <label className="text-xs font-semibold text-slate-300 block">
                    Study Mode (Adjusts Tolerance)
                  </label>
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
                        className={`p-2.5 rounded-xl border text-left transition min-w-0 ${
                          cameraState.mode === m.id
                            ? "bg-brand-500/20 border-brand-500/40 text-white"
                            : "bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        <div className="font-semibold truncate">{m.label}</div>
                        <div className="text-[10px] text-slate-400 truncate">{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Proactive Voice Reminders Settings */}
                <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-brand-400" />
                        Spoken Focus Reminders
                      </span>
                      <p className="text-[10px] text-slate-400 break-words mt-0.5">
                        Opt-in voice prompts when looking away for 10s
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Toggle proactive voice reminders"
                      onClick={handleToggleProactiveVoice}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition shrink-0 ${
                        proactiveVoice
                          ? "bg-brand-500/20 text-brand-300 border border-brand-500/40"
                          : "bg-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {proactiveVoice ? "Enabled" : "Off"}
                    </button>
                  </div>

                  {proactiveVoice && (
                    <div className="pt-2 border-t border-slate-850 space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400 flex items-center gap-1">
                          {quietMode ? (
                            <VolumeX className="w-3.5 h-3.5 text-amber-400" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          Quiet Mode (Mute voice)
                        </span>
                        <button
                          type="button"
                          onClick={handleToggleQuietMode}
                          className={`px-2 py-0.5 text-[11px] rounded-lg transition font-medium ${
                            quietMode
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {quietMode ? "Muted" : "Active"}
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Reminder Cooldown:</span>
                        <div className="flex items-center gap-1">
                          {[30, 60, 90].map((sec) => (
                            <button
                              key={sec}
                              type="button"
                              onClick={() => handleChangeCooldown(sec)}
                              className={`px-2 py-0.5 text-[10px] rounded-md transition ${
                                cooldownS === sec
                                  ? "bg-brand-600 text-white font-bold"
                                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              {sec}s
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Real-time Telemetry Viewer */}
                {cameraState.isEnabled && (
                  <div className="space-y-2 pt-1 border-t border-slate-800 min-w-0">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                        <Eye className="w-3.5 h-3.5 text-brand-400" />
                        Live Numeric Signals
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowTelemetry(!showTelemetry)}
                        className="text-[11px] text-brand-400 hover:underline flex items-center gap-0.5"
                      >
                        <span>{showTelemetry ? "Hide" : "Inspect"}</span>
                        {showTelemetry ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    {showTelemetry && signals && (
                      <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2 text-[11px] font-mono min-w-0">
                        <div className="flex justify-between items-center text-slate-300">
                          <span>Focus Evaluation:</span>
                          <span
                            className={
                              focusState === "focused"
                                ? "text-emerald-400 font-bold"
                                : focusState === "looking_away"
                                ? "text-amber-400 font-bold"
                                : focusState === "drowsy"
                                ? "text-rose-400 font-bold"
                                : "text-slate-400 font-bold"
                            }
                          >
                            {focusState.toUpperCase()}
                          </span>
                        </div>
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
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between min-w-0">
                  <div className="text-[11px] text-slate-400 min-w-0 pr-2">
                    <span className="font-semibold text-slate-300 block truncate">Calibration Recorder</span>
                    <span className="truncate block">
                      {isRecording ? `Recording (${recordedCount} samples)` : "Inactive (Off by default)"}
                    </span>
                  </div>
                  {isRecording ? (
                    <button
                      type="button"
                      onClick={handleStopAndDownload}
                      className="px-3 py-1.5 rounded-xl bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition shrink-0"
                    >
                      <Square className="w-3 h-3" />
                      <span>Stop & Save</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!cameraState.isEnabled}
                      onClick={handleStartRecording}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium flex items-center gap-1.5 transition shrink-0"
                    >
                      <Play className="w-3 h-3 text-brand-400" />
                      <span>Record JSON</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Drawer Footer (pinned) */}
              <div className="shrink-0 px-6 py-4 border-t border-slate-800 bg-slate-900/95 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowDrawer(false)}
                  className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
