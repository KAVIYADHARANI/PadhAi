/**
 * Focus Evaluator State Machine for Study Buddy v2.
 *
 * Implements reliable, temporally-smoothed focus and gaze evaluation:
 * 1. Distinguishes:
 *    - Focused (gaze on screen)
 *    - Sustained Look-Away (head turned away for >= 8-12 seconds)
 *    - Possible Drowsiness (high PERCLOS / long closures)
 *    - Uncertain / Face Unavailable (missing face or low quality lighting; NEVER falsely diagnosed as distraction)
 *    - Paused (browser tab hidden)
 *    - Disabled (camera off)
 * 2. Temporal filtering: ignores brief glances (< sustainedThresholdS).
 * 3. Cooldown: enforces >= 60s between repeated alerts during continuous events.
 * 4. Safe resets: immediately resets look-away timer upon returning to screen, tab hidden, or camera disabled.
 */

import { CameraStudyMode, FaceSignalsPayload } from "./types";

export type FocusState =
  | "disabled"
  | "paused"
  | "uncertain"
  | "focused"
  | "looking_away"
  | "drowsy";

export interface FocusEvaluatorConfig {
  sustainedThresholdS: number; // default 10s (8-12s range)
  cooldownS: number; // default 60s
  minQualityScore: number; // default 35
  yawThresholdDeg: number; // default 28 deg for screen mode
  pitchToleranceUpDeg: number; // default 25 deg
  pitchToleranceDownDeg: number; // default 25 deg
  drowsinessScoreThreshold: number; // default 60
}

export const DEFAULT_FOCUS_CONFIG: FocusEvaluatorConfig = {
  sustainedThresholdS: 10,
  cooldownS: 60,
  minQualityScore: 35,
  yawThresholdDeg: 28,
  pitchToleranceUpDeg: 25,
  pitchToleranceDownDeg: 25,
  drowsinessScoreThreshold: 60,
};

export interface FocusEvent {
  type:
    | "sustained_look_away"
    | "focus_restored"
    | "possible_drowsiness"
    | "uncertain_state"
    | "state_changed";
  state: FocusState;
  lookAwayDurationS: number;
  timestamp: number;
}

export type FocusEventListener = (event: FocusEvent) => void;

export class FocusEvaluator {
  private config: FocusEvaluatorConfig;
  private state: FocusState = "disabled";
  private lookAwayStartMs: number | null = null;
  private lastReminderMs: number | null = null;
  private hasEmittedSustainedEventForCurrentRun = false;
  private listeners: Set<FocusEventListener> = new Set();

  constructor(config: Partial<FocusEvaluatorConfig> = {}) {
    this.config = { ...DEFAULT_FOCUS_CONFIG, ...config };
  }

  public getState(): FocusState {
    return this.state;
  }

  public getConfig(): FocusEvaluatorConfig {
    return { ...this.config };
  }

  public updateConfig(updates: Partial<FocusEvaluatorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  public subscribe(listener: FocusEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: FocusEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  public reset(): void {
    const prevState = this.state;
    this.state = "disabled";
    this.lookAwayStartMs = null;
    this.lastReminderMs = null;
    this.hasEmittedSustainedEventForCurrentRun = false;

    if (prevState !== "disabled") {
      this.emit({
        type: "state_changed",
        state: "disabled",
        lookAwayDurationS: 0,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Main evaluation method called on each frame or tick.
   */
  public process(
    signal: FaceSignalsPayload | null,
    options: {
      cameraEnabled: boolean;
      tabVisible: boolean;
      studyMode?: CameraStudyMode;
      drowsinessScore?: number;
      nowMs?: number;
    }
  ): FocusState {
    const nowMs = options.nowMs ?? Date.now();
    const mode = options.studyMode ?? "screen";
    const drowsinessScore = options.drowsinessScore ?? 0;
    const prevState = this.state;

    // 1. Camera disabled
    if (!options.cameraEnabled || mode === "camera_off") {
      this.state = "disabled";
      this.lookAwayStartMs = null;
      this.hasEmittedSustainedEventForCurrentRun = false;
      if (prevState !== "disabled") {
        this.emit({
          type: "state_changed",
          state: "disabled",
          lookAwayDurationS: 0,
          timestamp: nowMs,
        });
      }
      return this.state;
    }

    // 2. Tab hidden / paused
    if (!options.tabVisible) {
      this.state = "paused";
      this.lookAwayStartMs = null;
      this.hasEmittedSustainedEventForCurrentRun = false;
      if (prevState !== "paused") {
        this.emit({
          type: "state_changed",
          state: "paused",
          lookAwayDurationS: 0,
          timestamp: nowMs,
        });
      }
      return this.state;
    }

    // 3. Face absent or landmark quality degraded
    // IMPORTANT: Missing face or low quality is an UNCERTAIN state, NEVER treated as distraction!
    if (!signal || !signal.facePresent || signal.qualityScore < this.config.minQualityScore) {
      this.state = "uncertain";
      this.lookAwayStartMs = null;
      this.hasEmittedSustainedEventForCurrentRun = false;

      if (prevState !== "uncertain") {
        this.emit({
          type: "uncertain_state",
          state: "uncertain",
          lookAwayDurationS: 0,
          timestamp: nowMs,
        });
      }
      return this.state;
    }

    // 4. Check for possible drowsiness first if model indicates high PERCLOS/closure
    if (drowsinessScore >= this.config.drowsinessScoreThreshold && mode !== "presence_only") {
      this.state = "drowsy";
      this.lookAwayStartMs = null;

      const cooldownElapsed =
        this.lastReminderMs === null || nowMs - this.lastReminderMs >= this.config.cooldownS * 1000;
      if (cooldownElapsed) {
        this.lastReminderMs = nowMs;
        this.emit({
          type: "possible_drowsiness",
          state: "drowsy",
          lookAwayDurationS: 0,
          timestamp: nowMs,
        });
      }
      return this.state;
    }

    // 5. Gaze Alignment Evaluation
    let isLookingAtScreen = true;
    const yawDelta = Math.abs(signal.yawDeg);
    const pitch = signal.pitchDeg;

    if (mode === "book_notes") {
      // In book_notes mode, looking down (pitch < 0) is expected.
      // Only penalize if head turned sideways (|yaw| > 40 deg) or tilted excessively up (pitch > 30 deg).
      if (yawDelta > 40 || pitch > 30) {
        isLookingAtScreen = false;
      }
    } else if (mode === "presence_only") {
      isLookingAtScreen = true;
    } else {
      // Standard screen mode: yaw within +/-28 deg and pitch within [-25, +25] deg
      const pitchDownTolerance = -this.config.pitchToleranceDownDeg;
      const pitchUpTolerance = this.config.pitchToleranceUpDeg;

      if (
        yawDelta > this.config.yawThresholdDeg ||
        pitch < pitchDownTolerance ||
        pitch > pitchUpTolerance
      ) {
        isLookingAtScreen = false;
      }
    }

    // 6. State Machine Transitions
    if (isLookingAtScreen) {
      // Learner is looking toward screen
      if (this.lookAwayStartMs !== null || prevState === "looking_away") {
        // Just returned to screen! Reset look-away timer and emit restoration
        this.emit({
          type: "focus_restored",
          state: "focused",
          lookAwayDurationS: 0,
          timestamp: nowMs,
        });
      }

      this.state = "focused";
      this.lookAwayStartMs = null;
      this.hasEmittedSustainedEventForCurrentRun = false;
      return this.state;
    }

    // Learner is looking away
    if (this.lookAwayStartMs === null) {
      this.lookAwayStartMs = nowMs;
      this.hasEmittedSustainedEventForCurrentRun = false;
    }

    const durationS = (nowMs - this.lookAwayStartMs) / 1000;

    // Check if sustained threshold reached (8-12 seconds, default 10s)
    if (durationS >= this.config.sustainedThresholdS) {
      this.state = "looking_away";

      const cooldownElapsed =
        this.lastReminderMs === null || nowMs - this.lastReminderMs >= this.config.cooldownS * 1000;
      if (!this.hasEmittedSustainedEventForCurrentRun && cooldownElapsed) {
        this.hasEmittedSustainedEventForCurrentRun = true;
        this.lastReminderMs = nowMs;

        this.emit({
          type: "sustained_look_away",
          state: "looking_away",
          lookAwayDurationS: Math.round(durationS),
          timestamp: nowMs,
        });
      }
    } else {
      // Brief glance: still in focused state, avoid early false positives
      this.state = "focused";
    }

    return this.state;
  }
}

export const focusEvaluator = new FocusEvaluator();
