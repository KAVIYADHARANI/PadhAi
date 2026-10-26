/**
 * Replay Harness for Study Buddy v2.
 *
 * Implements BUILD_PLAYBOOK.md Phase 7 Task 7B:
 * Replays recorded or synthetic JSON time-series traces through the calibrated detector and engine,
 * verifying that fatigue triggers breaks, distraction triggers topic switches, reading mode prevents
 * false nod alerts, and low quality light triggers quiet fallback.
 */

import { BuddyEngine } from "./engine";
import { SignalRecordEntry, SignalRecordingSession } from "./recorder";
import { BreakSuggestion, CameraStudyMode, FaceSignalsPayload } from "./types";

export interface ReplayEvent {
  timeS: number;
  type: "snapshot" | "suggestion" | "state_change";
  state: string;
  drowsiness: number;
  attention: number;
  suggestion?: BreakSuggestion;
}

export interface ReplayResult {
  totalDurationS: number;
  sampleCount: number;
  events: ReplayEvent[];
  suggestions: BreakSuggestion[];
  finalSnapshot: ReturnType<BuddyEngine["getSnapshot"]>;
}

export function signalEntryToPayload(entry: SignalRecordEntry): FaceSignalsPayload {
  return {
    timestamp: entry.timestamp,
    facePresent: entry.face_present,
    qualityScore: entry.quality_score,
    eyeBlinkLeft: entry.eye_blink_left,
    eyeBlinkRight: entry.eye_blink_right,
    eyeClosure: entry.eye_closure,
    earFallback: entry.ear_fallback,
    jawOpen: entry.jaw_open,
    pitchDeg: entry.pitch_deg,
    yawDeg: entry.yaw_deg,
    rollDeg: entry.roll_deg,
  };
}

export class SignalReplayHarness {
  public static replay(
    session: SignalRecordingSession | SignalRecordEntry[],
    studyMode: CameraStudyMode = "screen",
    engineOptions?: ConstructorParameters<typeof BuddyEngine>[1]
  ): ReplayResult {
    const samples = Array.isArray(session) ? session : session.samples;
    if (samples.length === 0) {
      const engine = new BuddyEngine(0, engineOptions);
      return {
        totalDurationS: 0,
        sampleCount: 0,
        events: [],
        suggestions: [],
        finalSnapshot: engine.getSnapshot(0),
      };
    }

    const startTimestamp = samples[0].timestamp;
    const engine = new BuddyEngine(startTimestamp, engineOptions);
    engine.setStudyMode(studyMode);

    const suggestions: BreakSuggestion[] = [];
    const events: ReplayEvent[] = [];
    let lastState = engine.getSnapshot(startTimestamp).state;

    let lastTickTime = startTimestamp;

    for (let i = 0; i < samples.length; i++) {
      const entry = samples[i];
      const payload = signalEntryToPayload(entry);

      // 1. Process face signal to update scores
      engine.processFaceSignal(payload, entry.timestamp);

      // 2. Process periodic engine tick if at least 1s elapsed
      if (entry.timestamp - lastTickTime >= 1000) {
        lastTickTime = entry.timestamp;
        const tickSnapshot = engine.tick(entry.timestamp);

        if (tickSnapshot.active_suggestion && !suggestions.some((s) => s.id === tickSnapshot.active_suggestion?.id)) {
          suggestions.push(tickSnapshot.active_suggestion);
          events.push({
            timeS: Math.round((entry.timestamp - startTimestamp) / 1000),
            type: "suggestion",
            state: tickSnapshot.state,
            drowsiness: tickSnapshot.drowsiness_score,
            attention: tickSnapshot.attention_score,
            suggestion: tickSnapshot.active_suggestion,
          });
        }

        if (tickSnapshot.state !== lastState) {
          lastState = tickSnapshot.state;
          events.push({
            timeS: Math.round((entry.timestamp - startTimestamp) / 1000),
            type: "state_change",
            state: tickSnapshot.state,
            drowsiness: tickSnapshot.drowsiness_score,
            attention: tickSnapshot.attention_score,
          });
        }
      }
    }

    const finalSnapshot = engine.getSnapshot(samples[samples.length - 1].timestamp);

    return {
      totalDurationS: Math.round((samples[samples.length - 1].timestamp - startTimestamp) / 1000),
      sampleCount: samples.length,
      events,
      suggestions,
      finalSnapshot,
    };
  }

  /**
   * Generates a synthetic trace for testing detector behaviors.
   */
  public static generateSyntheticTrace(
    durationSeconds: number,
    fps: number,
    generator: (timeS: number) => Partial<SignalRecordEntry>
  ): SignalRecordEntry[] {
    const totalFrames = Math.floor(durationSeconds * fps);
    const intervalMs = Math.floor(1000 / fps);
    const baseTime = 1_700_000_000_000;
    const entries: SignalRecordEntry[] = [];

    for (let i = 0; i < totalFrames; i++) {
      const timeS = i / fps;
      const ts = baseTime + i * intervalMs;
      const custom = generator(timeS);

      entries.push({
        timestamp: ts,
        relative_time_s: Math.round(timeS * 100) / 100,
        face_present: custom.face_present ?? true,
        quality_score: custom.quality_score ?? 85,
        eye_blink_left: custom.eye_blink_left ?? 0.08,
        eye_blink_right: custom.eye_blink_right ?? 0.08,
        eye_closure: custom.eye_closure ?? 0.08,
        ear_fallback: custom.ear_fallback ?? 0.28,
        jaw_open: custom.jaw_open ?? 0.1,
        pitch_deg: custom.pitch_deg ?? 0.0,
        yaw_deg: custom.yaw_deg ?? 0.0,
        roll_deg: custom.roll_deg ?? 0.0,
      });
    }

    return entries;
  }
}
