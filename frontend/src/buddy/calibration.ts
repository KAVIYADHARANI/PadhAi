/**
 * Calibration Module for Study Buddy v2.
 *
 * README Section 11.2:
 * "Per-user calibration: a 20 to 30 second baseline at session start,
 * because eye openness varies by person, glasses and camera angle.
 * Thresholds are expressed relative to the baseline."
 */

import { FaceSignalsPayload } from "./types";

export interface CalibrationBaseline {
  isCalibrated: boolean;
  samplesCount: number;
  durationMs: number;
  baselineEyeClosure: number;
  baselineEAR: number;
  baselinePitch: number;
  baselineYaw: number;
  eyeClosureStdDev: number;
  closedThreshold: number; // dynamically computed threshold for "closed eye"
  yawnThreshold: number;
  nodPitchThreshold: number;
}

export const DEFAULT_BASELINE: CalibrationBaseline = {
  isCalibrated: false,
  samplesCount: 0,
  durationMs: 0,
  baselineEyeClosure: 0.1,
  baselineEAR: 0.28,
  baselinePitch: 0.0,
  baselineYaw: 0.0,
  eyeClosureStdDev: 0.05,
  closedThreshold: 0.65,
  yawnThreshold: 0.65,
  nodPitchThreshold: -25.0,
};

export class SessionCalibrator {
  private startTime: number = 0;
  private targetDurationMs: number = 20_000; // 20 seconds standard
  private samples: FaceSignalsPayload[] = [];
  private baseline: CalibrationBaseline = { ...DEFAULT_BASELINE };

  constructor(targetDurationMs = 20_000) {
    this.targetDurationMs = targetDurationMs;
  }

  public reset(nowMs: number = Date.now()): void {
    this.startTime = nowMs;
    this.samples = [];
    this.baseline = { ...DEFAULT_BASELINE };
  }

  public addSample(sample: FaceSignalsPayload, nowMs: number = Date.now()): CalibrationBaseline {
    if (this.baseline.isCalibrated) {
      return this.baseline;
    }

    if (this.startTime === 0) {
      this.startTime = nowMs;
    }

    // Only collect calibration data when a face is reliably present and well-lit
    if (sample.facePresent && sample.qualityScore >= 40) {
      this.samples.push(sample);
    }

    const elapsed = nowMs - this.startTime;
    this.baseline.durationMs = elapsed;
    this.baseline.samplesCount = this.samples.length;

    // After 20 seconds and at least 30 samples (~1.5s of 8fps frames), compute baseline
    if (elapsed >= this.targetDurationMs && this.samples.length >= 30) {
      this.finalize();
    }

    return this.baseline;
  }

  public isComplete(): boolean {
    return this.baseline.isCalibrated;
  }

  public getBaseline(): CalibrationBaseline {
    return this.baseline;
  }

  private finalize(): void {
    const n = this.samples.length;
    if (n === 0) {
      this.baseline = { ...DEFAULT_BASELINE, isCalibrated: true };
      return;
    }

    const meanEyeClosure = this.samples.reduce((acc, s) => acc + s.eyeClosure, 0) / n;
    const meanEAR = this.samples.reduce((acc, s) => acc + s.earFallback, 0) / n;
    const meanPitch = this.samples.reduce((acc, s) => acc + s.pitchDeg, 0) / n;
    const meanYaw = this.samples.reduce((acc, s) => acc + s.yawDeg, 0) / n;

    const variance =
      this.samples.reduce((acc, s) => acc + Math.pow(s.eyeClosure - meanEyeClosure, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    // Dynamic closed threshold: at least mean + 3*stdDev or 0.60, capped at 0.85
    const computedClosedThreshold = Math.max(0.6, Math.min(0.85, meanEyeClosure + 3 * Math.max(0.04, stdDev)));

    this.baseline = {
      isCalibrated: true,
      samplesCount: n,
      durationMs: this.targetDurationMs,
      baselineEyeClosure: Math.round(meanEyeClosure * 1000) / 1000,
      baselineEAR: Math.round(meanEAR * 1000) / 1000,
      baselinePitch: Math.round(meanPitch * 10) / 10,
      baselineYaw: Math.round(meanYaw * 10) / 10,
      eyeClosureStdDev: Math.round(stdDev * 1000) / 1000,
      closedThreshold: Math.round(computedClosedThreshold * 100) / 100,
      yawnThreshold: 0.65,
      nodPitchThreshold: Math.round((meanPitch - 20) * 10) / 10,
    };
  }
}
