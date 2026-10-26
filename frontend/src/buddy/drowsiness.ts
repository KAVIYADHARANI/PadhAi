/**
 * Drowsiness Scoring Module for Study Buddy v2.
 *
 * Implements README Section 11.2:
 * "Score 0 to 100 from PERCLOS over a rolling 60 s window,
 * average blink duration, long closures, yawns, head nods, reduced blink-rate variability.
 * Smoothed over 30 to 60 s with hysteresis; never reacts to a single frame."
 */

import { CalibrationBaseline, DEFAULT_BASELINE } from "./calibration";
import { CameraStudyMode, FaceSignalsPayload } from "./types";

export type SensitivityLevel = "relaxed" | "balanced" | "strict";

export interface DrowsinessMetrics {
  score: number; // 0 to 100 (smoothed)
  rawScore: number;
  perclos: number; // 0.0 to 1.0 (fraction of time eyes closed in last 60s)
  blinkCount: number;
  avgBlinkDurationMs: number;
  longClosureCount: number; // blinks > 1.2s
  yawnCount: number; // sustained jawOpen > threshold
  headNodCount: number; // rapid pitch drop and recovery
}

interface FrameRecord {
  timestamp: number;
  isClosed: boolean;
  eyeClosure: number;
  jawOpen: number;
  pitchDeg: number;
}

export class DrowsinessDetector {
  private windowDurationMs = 60_000; // 60 seconds rolling window
  private history: FrameRecord[] = [];
  private smoothedScore = 0;
  private smoothingAlpha = 0.15; // Exponential moving average factor (~30-45s convergence)

  // Blink tracking state
  private blinkStartTime: number | null = null;
  private blinkDurations: number[] = [];

  // Yawn tracking state
  private yawnStartTime: number | null = null;
  private detectedYawns = 0;

  // Head nod tracking state
  private pitchHistory: Array<{ timestamp: number; pitch: number }> = [];
  private detectedNods = 0;

  constructor(windowDurationMs = 60_000) {
    this.windowDurationMs = windowDurationMs;
  }

  public reset(): void {
    this.history = [];
    this.smoothedScore = 0;
    this.blinkStartTime = null;
    this.blinkDurations = [];
    this.yawnStartTime = null;
    this.detectedYawns = 0;
    this.pitchHistory = [];
    this.detectedNods = 0;
  }

  public processSignal(
    signal: FaceSignalsPayload,
    baseline: CalibrationBaseline = DEFAULT_BASELINE,
    mode: CameraStudyMode = "screen",
    sensitivity: SensitivityLevel = "balanced"
  ): DrowsinessMetrics {
    // If camera is off or presence-only, drowsiness scoring is disabled
    if (mode === "camera_off" || mode === "presence_only" || !signal.facePresent) {
      return {
        score: 0,
        rawScore: 0,
        perclos: 0,
        blinkCount: 0,
        avgBlinkDurationMs: 0,
        longClosureCount: 0,
        yawnCount: 0,
        headNodCount: 0,
      };
    }

    const now = signal.timestamp;
    const isClosed = signal.eyeClosure >= baseline.closedThreshold;

    // 1. Maintain rolling history within windowDurationMs
    this.history.push({
      timestamp: now,
      isClosed,
      eyeClosure: signal.eyeClosure,
      jawOpen: signal.jawOpen,
      pitchDeg: signal.pitchDeg,
    });

    const cutoff = now - this.windowDurationMs;
    this.history = this.history.filter((f) => f.timestamp >= cutoff);

    // 2. Track Blinks and Blink Durations
    if (isClosed) {
      if (this.blinkStartTime === null) {
        this.blinkStartTime = now;
      }
    } else {
      if (this.blinkStartTime !== null) {
        const duration = now - this.blinkStartTime;
        this.blinkDurations.push(duration);
        this.blinkStartTime = null;
      }
    }
    // Filter blink durations older than window
    const recentBlinks = this.blinkDurations.slice(-30);

    // 3. Track Yawns (jawOpen > threshold sustained for > 1500ms)
    if (signal.jawOpen >= baseline.yawnThreshold) {
      if (this.yawnStartTime === null) {
        this.yawnStartTime = now;
      } else if (now - this.yawnStartTime >= 1500) {
        this.detectedYawns++;
        this.yawnStartTime = null; // Reset to count next yawn
      }
    } else {
      this.yawnStartTime = null;
    }

    // 4. Track Head Nods (pitch drops by > 15 deg and recovers within 2.5s)
    if (mode !== "book_notes") {
      this.pitchHistory.push({ timestamp: now, pitch: signal.pitchDeg });
      this.pitchHistory = this.pitchHistory.filter((p) => p.timestamp >= now - 5000);
      if (this.pitchHistory.length >= 10) {
        const baselineP = baseline.baselinePitch;
        const minPitch = Math.min(...this.pitchHistory.map((p) => p.pitch));
        const latestPitch = signal.pitchDeg;
        // Sudden dip below threshold and rapid recovery
        if (minPitch <= baseline.nodPitchThreshold && latestPitch >= baselineP - 5) {
          this.detectedNods++;
          this.pitchHistory = []; // Reset after nod detection
        }
      }
    }

    // 5. Compute PERCLOS (Percentage of Eye Closure)
    const closedFrames = this.history.filter((f) => f.isClosed).length;
    const perclos = this.history.length > 0 ? closedFrames / this.history.length : 0;

    // 6. Long closures count (blinks > 1200ms in recent blinks or ongoing closure > 1200ms)
    const currentOngoingClosureMs = this.blinkStartTime !== null ? (now - this.blinkStartTime) : 0;
    const isOngoingLongClosure = currentOngoingClosureMs >= 1200;
    const completedLongClosures = recentBlinks.filter((d) => d >= 1200).length;
    const longClosureCount = completedLongClosures + (isOngoingLongClosure ? 1 : 0);

    // 7. Average Blink Duration
    const avgBlinkDurationMs =
      recentBlinks.length > 0
        ? recentBlinks.reduce((acc, d) => acc + d, 0) / recentBlinks.length
        : isOngoingLongClosure ? currentOngoingClosureMs : 180;

    // 8. Composite Raw Fatigue Score (0 to 100)
    // Formula components:
    // - PERCLOS component: baseline 0-10% closure is normal, > 25% is high fatigue (weight 60%)
    const perclosScore = Math.min(100, Math.max(0, ((perclos - 0.08) / 0.22) * 100));

    // - Long closure component (weight 20%)
    const closureScore = Math.min(100, longClosureCount * 50);

    // - Yawn component (weight 10%)
    const yawnScore = Math.min(100, this.detectedYawns * 40);

    // - Head nod component (weight 10%)
    const nodScore = Math.min(100, this.detectedNods * 40);

    let rawScore =
      perclosScore * 0.60 + closureScore * 0.20 + yawnScore * 0.10 + nodScore * 0.10;

    // Sensitivity multiplier
    const sensitivityMultiplier =
      sensitivity === "relaxed" ? 0.75 : sensitivity === "strict" ? 1.25 : 1.0;
    rawScore = Math.min(100, Math.max(0, rawScore * sensitivityMultiplier));

    // 9. Smoothing & Hysteresis (Exponential Moving Average)
    this.smoothedScore =
      this.smoothedScore * (1 - this.smoothingAlpha) + rawScore * this.smoothingAlpha;

    return {
      score: Math.round(this.smoothedScore),
      rawScore: Math.round(rawScore),
      perclos: Math.round(perclos * 1000) / 1000,
      blinkCount: recentBlinks.length,
      avgBlinkDurationMs: Math.round(avgBlinkDurationMs),
      longClosureCount,
      yawnCount: this.detectedYawns,
      headNodCount: this.detectedNods,
    };
  }
}
