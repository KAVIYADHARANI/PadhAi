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
              ? "bg-surface text-muted border-line hover:bg-subtle hover:text-heading"
              : focusState === "looking_away"
              ? "bg-warning-light text-warning border-warning/30 hover:opacity-90"
              : focusState === "drowsy"
              ? "bg-error-light text-error border-error/30 hover:opacity-90"
              : cameraState.isLowQuality || focusState === "uncertain"
              ? "bg-warning-light text-warning border-warning/30 hover:opacity-90"
              : "bg-accent-light text-accent border-accent/30 hover:opacity-90"
          }`}
          title="Focus & Drowsiness Sensor Settings & Privacy Status"
        >
          {!cameraState.isEnabled ? (
            <>
              <CameraOff className="w-3.5 h-3.5 text-muted" />
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

          <ShieldCheck className="w-3.5 h-3.5 ml-0.5 text-muted group-hover:text-heading" />
        </button>

        {/* Quick turn-off button when active */}
        {cameraState.isEnabled && (
          <button
            type="button"
            onClick={handleToggleCamera}
            className="p-1.5 rounded-xl bg-surface text-muted hover:text-error hover:bg-error-light border border-line transition"
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
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
          />

          {/* Drawer container pinned to right on desktop/tablet, bottom-sheet/full on mobile */}
          <div className="fixed inset-y-0 right-0 z-50 flex max-w-full pl-0 sm:pl-10">
            <div className="w-screen max-w-full sm:w-[400px] md:w-[420px] bg-surface border-l border-line shadow-2xl flex flex-col h-full transform transition ease-in-out duration-300 animate-in slide-in-from-right">
              {/* Drawer Header (pinned) */}
              <div className="shrink-0 px-6 py-4 border-b border-line flex items-center justify-between bg-surface">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-primary-light text-primary flex items-center justify-center shrink-0 border border-primary/20">
                    <Camera className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-heading truncate">
                      Focus & Drowsiness Sensor
                    </h3>
                    <p className="text-[11px] text-muted truncate">
                      Client-side privacy architecture
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDrawer(false)}
                  className="p-1.5 rounded-lg text-muted hover:text-heading hover:bg-subtle transition shrink-0 ml-2"
                  aria-label="Close sensor drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Drawer Scrollable Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-w-0">
                {/* Privacy Guarantee Pledge */}
                <div className="p-3.5 rounded-2xl bg-accent-light border border-accent/25 text-accent text-xs space-y-1.5 min-w-0">
                  <div className="flex items-center gap-1.5 font-bold">
                    <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
                    <span className="truncate">Zero Image / Video Storage Guarantee</span>
                  </div>
                  <p className="text-[11px] opacity-90 leading-relaxed break-words">
                    Raw camera frames are processed exclusively inside an isolated Web Worker on your device at 8 FPS.
                    No pictures, videos, or facial images are EVER stored or sent across the network.
                  </p>
                </div>

                {/* Camera Enable Toggle & Status */}
                <div className="p-3.5 rounded-2xl bg-subtle border border-line space-y-3 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <span className="text-xs font-semibold text-heading block">Sensor Status</span>
                      <p className="text-[10px] text-muted break-words">
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
                          ? "bg-error-light text-error border border-error/25 hover:opacity-90"
                          : "bg-primary text-white hover:bg-primary-hover"
                      }`}
                    >
                      {cameraState.isEnabled ? "Stop Sensor" : "Enable Sensor"}
                    </button>
                  </div>

                  {!cameraState.isEnabled && (
                    <p className="text-[10px] text-muted leading-relaxed border-t border-line pt-2 break-words">
                      Webcam access is requested only after you click Enable Sensor. It is used strictly on-device to measure head angle and blink rate for your study companion.
                    </p>
                  )}
                </div>

                {/* Error Banner if permission denied */}
                {cameraState.error && (
                  <div className="p-3.5 rounded-xl bg-error-light border border-error/25 text-error text-xs space-y-2 min-w-0">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-error shrink-0 mt-0.5" />
                      <span className="leading-relaxed break-words">{cameraState.error}</span>
                    </div>
                    <div className="pt-1 flex justify-end">
                      <button
                        type="button"
                        onClick={handleRetryPermission}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface border border-error/30 hover:bg-subtle text-error rounded-lg text-[11px] font-semibold transition"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Retry Permission</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Study Mode Selector */}
                <div className="space-y-2 min-w-0">
                  <label className="text-xs font-semibold text-body block">
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
                            ? "bg-primary-light border-primary text-primary"
                            : "bg-surface border-line text-muted hover:text-heading hover:border-primary/40"
                        }`}
                      >
                        <div className="font-semibold truncate">{m.label}</div>
                        <div className="text-[10px] opacity-80 truncate">{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Proactive Voice Reminders Settings */}
                <div className="p-3.5 rounded-2xl bg-subtle border border-line space-y-3 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-heading flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-primary" />
                        Spoken Focus Reminders
                      </span>
                      <p className="text-[10px] text-muted break-words mt-0.5">
                        Opt-in voice prompts when looking away for 10s
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Toggle proactive voice reminders"
                      onClick={handleToggleProactiveVoice}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition shrink-0 ${
                        proactiveVoice
                          ? "bg-primary-light text-primary border border-primary/25"
                          : "bg-surface border border-line text-muted hover:text-heading"
                      }`}
                    >
                      {proactiveVoice ? "Enabled" : "Off"}
                    </button>
                  </div>

                  {proactiveVoice && (
                    <div className="pt-2 border-t border-line space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted flex items-center gap-1">
                          {quietMode ? (
                            <VolumeX className="w-3.5 h-3.5 text-warning" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5 text-muted" />
                          )}
                          Quiet Mode (Mute voice)
                        </span>
                        <button
                          type="button"
                          onClick={handleToggleQuietMode}
                          className={`px-2 py-0.5 text-[11px] rounded-lg transition font-medium ${
                            quietMode
                              ? "bg-warning-light text-warning border border-warning/30"
                              : "bg-surface border border-line text-muted"
                          }`}
                        >
                          {quietMode ? "Muted" : "Active"}
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted">Reminder Cooldown:</span>
                        <div className="flex items-center gap-1">
                          {[30, 60, 90].map((sec) => (
                            <button
                              key={sec}
                              type="button"
                              onClick={() => handleChangeCooldown(sec)}
                              className={`px-2 py-0.5 text-[10px] rounded-md transition ${
                                cooldownS === sec
                                  ? "bg-primary text-white font-bold"
                                  : "bg-surface border border-line text-muted hover:text-heading"
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
                  <div className="space-y-2 pt-1 border-t border-line min-w-0">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-body flex items-center gap-1.5">
                        <Eye className="w-3.5 h-3.5 text-primary" />
                        Live Numeric Signals
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowTelemetry(!showTelemetry)}
                        className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
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
                      <div className="p-3 rounded-xl bg-surface border border-line space-y-2 text-[11px] font-mono min-w-0 text-body">
                        <div className="flex justify-between items-center">
                          <span>Focus Evaluation:</span>
                          <span
                            className={
                              focusState === "focused"
                                ? "text-accent font-bold"
                                : focusState === "looking_away"
                                ? "text-warning font-bold"
                                : focusState === "drowsy"
                                ? "text-error font-bold"
                                : "text-muted font-bold"
                            }
                          >
                            {focusState.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Face Detected:</span>
                          <span className={signals.facePresent ? "text-accent" : "text-error"}>
                            {signals.facePresent ? "Yes" : "No"}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Signal Quality:</span>
                          <span className={signals.qualityScore >= 40 ? "text-accent" : "text-warning"}>
                            {signals.qualityScore}%
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Eye Closure:</span>
                          <span className="text-primary">{Math.round(signals.eyeClosure * 100)}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Jaw Drop (Yawn):</span>
                          <span className="text-primary">{Math.round(signals.jawOpen * 100)}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Head Pitch / Yaw:</span>
                          <span className="text-muted">
                            {Math.round(signals.pitchDeg)}° / {Math.round(signals.yawDeg)}°
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Offline Signal Recorder for Threshold Calibration */}
                <div className="pt-2 border-t border-line flex items-center justify-between min-w-0">
                  <div className="text-[11px] text-muted min-w-0 pr-2">
                    <span className="font-semibold text-heading block truncate">Calibration Recorder</span>
                    <span className="truncate block">
                      {isRecording ? `Recording (${recordedCount} samples)` : "Inactive (Off by default)"}
                    </span>
                  </div>
                  {isRecording ? (
                    <button
                      type="button"
                      onClick={handleStopAndDownload}
                      className="px-3 py-1.5 rounded-xl bg-error-light text-error border border-error/25 hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 transition shrink-0"
                    >
                      <Square className="w-3 h-3" />
                      <span>Stop & Save</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!cameraState.isEnabled}
                      onClick={handleStartRecording}
                      className="px-3 py-1.5 rounded-xl bg-subtle border border-line text-body hover:text-heading hover:bg-codeblock disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium flex items-center gap-1.5 transition shrink-0"
                    >
                      <Play className="w-3 h-3 text-primary" />
                      <span>Record JSON</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Drawer Footer (pinned) */}
              <div className="shrink-0 px-6 py-4 border-t border-line bg-surface flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowDrawer(false)}
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition min-h-[44px]"
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
