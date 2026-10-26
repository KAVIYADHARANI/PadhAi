import { describe, expect, it } from "vitest";
import { SessionCalibrator } from "../buddy/calibration";
import { DrowsinessDetector } from "../buddy/drowsiness";
import { AttentionDetector } from "../buddy/attention";
import { evaluateQualityGate } from "../buddy/qualityGate";
import { SignalReplayHarness } from "../buddy/replay";
import { FaceSignalsPayload } from "../buddy/types";

describe("Study Buddy Phase 7B - Scoring, Calibration, Quality Gate, and Replay Harness", () => {
  const createSample = (overrides: Partial<FaceSignalsPayload> = {}): FaceSignalsPayload => ({
    timestamp: 1_700_000_000_000,
    facePresent: true,
    qualityScore: 85,
    eyeBlinkLeft: 0.1,
    eyeBlinkRight: 0.1,
    eyeClosure: 0.1,
    earFallback: 0.28,
    jawOpen: 0.05,
    pitchDeg: 0,
    yawDeg: 0,
    rollDeg: 0,
    ...overrides,
  });

  describe("Session Calibration", () => {
    it("computes dynamic thresholds relative to baseline after 20 seconds", () => {
      const calibrator = new SessionCalibrator(20_000);
      const baseTime = 1_700_000_000_000;

      // Feed 40 samples spanning 21 seconds with personal open-eye baseline of ~0.15
      for (let i = 0; i <= 40; i++) {
        const ts = baseTime + i * 550;
        calibrator.addSample(
          createSample({
            timestamp: ts,
            eyeClosure: 0.15 + (i % 2 === 0 ? 0.02 : -0.02),
            pitchDeg: -5,
            yawDeg: 2,
          }),
          ts
        );
      }

      expect(calibrator.isComplete()).toBe(true);
      const baseline = calibrator.getBaseline();
      expect(baseline.isCalibrated).toBe(true);
      expect(baseline.samplesCount).toBeGreaterThan(30);
      expect(baseline.baselineEyeClosure).toBeCloseTo(0.15, 1);
      expect(baseline.closedThreshold).toBeGreaterThan(0.2);
      expect(baseline.nodPitchThreshold).toBeLessThan(-20);
    });
  });

  describe("Quality Gate", () => {
    it("passes when quality score is good (>= 40)", () => {
      const decision = evaluateQualityGate(85, true, "screen");
      expect(decision.passed).toBe(true);
      expect(decision.effectiveStudyMode).toBe("screen");
      expect(decision.shouldSilenceDrowsiness).toBe(false);
      expect(decision.quietMessage).toBeNull();
    });

    it("silences drowsiness when quality is poor (< 40) and falls back to presence-only", () => {
      const decision = evaluateQualityGate(25, true, "screen");
      expect(decision.passed).toBe(false);
      expect(decision.effectiveStudyMode).toBe("presence_only");
      expect(decision.shouldSilenceDrowsiness).toBe(true);
      expect(decision.quietMessage).toContain("I can't see you well");
    });
  });

  describe("Drowsiness Detector", () => {
    it("never reacts to a single closed frame (hysteresis & smoothing)", () => {
      const detector = new DrowsinessDetector();
      const baseTime = 1_700_000_000_000;

      // Single frame with closed eye
      const metrics = detector.processSignal(
        createSample({ timestamp: baseTime, eyeClosure: 0.95 })
      );
      // Single frame should have very low score because of exponential moving average
      expect(metrics.score).toBeLessThan(20);
    });

    it("escalates fatigue score during sustained eye closures and yawns", () => {
      const detector = new DrowsinessDetector();
      const baseTime = 1_700_000_000_000;

      // 30 seconds of high eye closure
      let lastMetrics = detector.processSignal(createSample({ timestamp: baseTime }));
      for (let sec = 1; sec <= 30; sec++) {
        lastMetrics = detector.processSignal(
          createSample({
            timestamp: baseTime + sec * 1000,
            eyeClosure: 0.85,
            jawOpen: sec > 20 ? 0.8 : 0.05,
          })
        );
      }

      expect(lastMetrics.perclos).toBeGreaterThan(0.7);
      expect(lastMetrics.score).toBeGreaterThan(50);
    });
  });

  describe("Attention Detector", () => {
    it("scores high for alert, centered face with recent interaction", () => {
      const detector = new AttentionDetector();
      const baseTime = 1_700_000_000_000;

      const metrics = detector.processSignal(
        createSample({ timestamp: baseTime, yawDeg: 3, pitchDeg: 2 }),
        true,
        baseTime - 5000,
        baseTime
      );

      expect(metrics.score).toBeGreaterThan(75);
      expect(metrics.isGazeOnTarget).toBe(true);
    });

    it("tolerates looking down in book_notes mode without penalizing gaze", () => {
      const detector = new AttentionDetector();
      const baseTime = 1_700_000_000_000;

      const metrics = detector.processSignal(
        createSample({ timestamp: baseTime, pitchDeg: -22, yawDeg: 5 }),
        true,
        baseTime - 5000,
        baseTime,
        undefined,
        "book_notes"
      );

      expect(metrics.isGazeOnTarget).toBe(true);
      expect(metrics.score).toBeGreaterThan(70);
    });
  });

  describe("Replay Harness", () => {
    it("synthetic tired trace triggers movement break (drowsy_stretch) by minute 4", () => {
      // 240 seconds trace at 2 FPS:
      // First 30s: normal calibration baseline
      // Next 210s: high eye closure, yawns, fatigue
      const trace = SignalReplayHarness.generateSyntheticTrace(240, 2, (timeS) => {
        if (timeS < 30) {
          return { eye_closure: 0.1, jaw_open: 0.05, quality_score: 90 };
        }
        return {
          eye_closure: 0.85,
          jaw_open: timeS % 20 < 3 ? 0.75 : 0.05,
          quality_score: 90,
        };
      });

      const result = SignalReplayHarness.replay(trace, "screen");

      // Verify a drowsy_stretch suggestion was generated
      const drowsyBreak = result.suggestions.find((s) => s.type === "drowsy_stretch");
      expect(drowsyBreak).toBeDefined();
      expect(drowsyBreak?.title).toContain("Movement Break");
    });

    it("synthetic distracted trace triggers topic switch by minute 3", () => {
      // 200 seconds trace:
      // First 30s: normal
      // Next 170s: head turned away (|yaw| = 45), low attention, zero input
      const trace = SignalReplayHarness.generateSyntheticTrace(200, 2, (timeS) => {
        if (timeS < 30) {
          return { yaw_deg: 0, quality_score: 90 };
        }
        return { yaw_deg: 45, quality_score: 90 };
      });

      const result = SignalReplayHarness.replay(trace, "screen");

      // Sustained low attention triggers topic_switch
      const topicSwitch = result.suggestions.find((s) => s.type === "topic_switch");
      expect(topicSwitch).toBeDefined();
      expect(topicSwitch?.title).toContain("Switch Topics");
    });

    it("synthetic reading trace in book_notes mode never triggers false nod alert or break", () => {
      // 180 seconds trace with pitchDeg = -20 (reading down notes)
      const trace = SignalReplayHarness.generateSyntheticTrace(180, 2, () => ({
        pitch_deg: -20,
        eye_closure: 0.12,
        yaw_deg: 0,
        quality_score: 90,
      }));

      const result = SignalReplayHarness.replay(trace, "book_notes");

      // Should remain in study mode without fatigue/topic switch breaks
      expect(result.suggestions.filter((s) => s.type === "drowsy_stretch")).toHaveLength(0);
      expect(result.finalSnapshot.attention_score).toBeGreaterThan(60);
    });

    it("poor lighting trace suppresses drowsiness alerts via Quality Gate", () => {
      // Trace with low quality (quality_score = 25) even with high eye closure
      const trace = SignalReplayHarness.generateSyntheticTrace(180, 2, () => ({
        eye_closure: 0.9,
        quality_score: 25,
      }));

      const result = SignalReplayHarness.replay(trace, "screen");

      // Quality gate passed is false
      expect(result.finalSnapshot.quality_gate_passed).toBe(false);
      // Drowsiness score is silenced to 0
      expect(result.finalSnapshot.drowsiness_score).toBe(0);
      // No drowsy break triggered
      expect(result.suggestions.filter((s) => s.type === "drowsy_stretch")).toHaveLength(0);
    });
  });
});
