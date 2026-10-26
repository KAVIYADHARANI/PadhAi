/**
 * Attention Scoring Module for Study Buddy v2.
 *
 * Implements README Section 11.2:
 * "Attention (0 to 100) from face presence, head yaw/gaze direction,
 * tab visibility, keyboard and mouse activity, time since last interaction."
 */

import { CalibrationBaseline, DEFAULT_BASELINE } from "./calibration";
import { CameraStudyMode, FaceSignalsPayload } from "./types";

export interface AttentionMetrics {
  score: number; // 0 to 100 (smoothed)
  rawScore: number;
  facePresent: boolean;
  isGazeOnTarget: boolean;
  tabVisible: boolean;
  inputRecencyS: number;
}

export class AttentionDetector {
  private smoothedScore = 85;
  private smoothingAlpha = 0.2; // Smooth over ~15-20s

  public reset(): void {
    this.smoothedScore = 85;
  }

  public processSignal(
    signal: FaceSignalsPayload | null,
    tabVisible: boolean,
    lastInteractionTimeMs: number,
    nowMs: number = Date.now(),
    baseline: CalibrationBaseline = DEFAULT_BASELINE,
    mode: CameraStudyMode = "screen"
  ): AttentionMetrics {
    const inputRecencyS = Math.max(0, (nowMs - lastInteractionTimeMs) / 1000);

    // 1. Tab visibility component (0 or 100)
    if (!tabVisible) {
      this.smoothedScore = Math.max(0, this.smoothedScore * 0.7);
      return {
        score: Math.round(this.smoothedScore),
        rawScore: 0,
        facePresent: false,
        isGazeOnTarget: false,
        tabVisible: false,
        inputRecencyS,
      };
    }

    // 2. Camera Off mode: compute based on tab visibility and input interaction recency
    if (mode === "camera_off" || !signal) {
      // Recent input within 30s = 100; degrades after 2m idle
      let inputFactor = 1.0;
      if (inputRecencyS > 180) {
        inputFactor = 0.35;
      } else if (inputRecencyS > 60) {
        inputFactor = 0.65;
      }
      const rawScore = Math.round(100 * inputFactor);
      this.smoothedScore =
        this.smoothedScore * (1 - this.smoothingAlpha) + rawScore * this.smoothingAlpha;

      return {
        score: Math.round(this.smoothedScore),
        rawScore,
        facePresent: true,
        isGazeOnTarget: true,
        tabVisible: true,
        inputRecencyS,
      };
    }

    // 3. Presence & Gaze Target evaluation
    const facePresent = signal.facePresent;
    if (!facePresent) {
      // Face absent: decay attention toward 0
      this.smoothedScore = Math.max(0, this.smoothedScore * 0.85);
      return {
        score: Math.round(this.smoothedScore),
        rawScore: 10,
        facePresent: false,
        isGazeOnTarget: false,
        tabVisible: true,
        inputRecencyS,
      };
    }

    // 4. Head pose & gaze alignment
    let isGazeOnTarget = true;
    const yawDelta = Math.abs(signal.yawDeg - baseline.baselineYaw);
    const pitchDelta = signal.pitchDeg - baseline.baselinePitch;

    if (mode === "book_notes") {
      // Looking down (negative pitch) is expected and considered active studying
      // Only penalize if head turned sideways (|yaw| > 40 deg) or tilted excessively up
      if (yawDelta > 40 || pitchDelta > 30) {
        isGazeOnTarget = false;
      }
    } else if (mode === "presence_only") {
      // Presence only ignores gaze angle
      isGazeOnTarget = true;
    } else {
      // Standard screen mode: head should be facing toward screen (|yaw| < 28 deg, pitch within -25 to +25)
      if (yawDelta > 28 || pitchDelta < -25 || pitchDelta > 25) {
        isGazeOnTarget = false;
      }
    }

    // 5. Composite Raw Score (0 to 100)
    let rawScore = 0;
    if (facePresent) rawScore += 30;
    if (isGazeOnTarget) rawScore += 50;

    // Interaction bonus: recent input boosts attention
    if (inputRecencyS <= 45) {
      rawScore = Math.min(100, rawScore + 20);
    } else if (inputRecencyS > 180) {
      rawScore = Math.max(10, rawScore - 15);
    }

    // 6. Smoothing
    this.smoothedScore =
      this.smoothedScore * (1 - this.smoothingAlpha) + rawScore * this.smoothingAlpha;

    return {
      score: Math.round(this.smoothedScore),
      rawScore,
      facePresent,
      isGazeOnTarget,
      tabVisible: true,
      inputRecencyS,
    };
  }
}
