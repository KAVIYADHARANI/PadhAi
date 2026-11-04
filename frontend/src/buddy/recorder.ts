/**
 * Signal Recorder Utility for Study Buddy v2.
 * Captures ONLY numeric time-series data locally for threshold tuning.
 * NEVER stores images, video, canvas blobs, or audio.
 * Off by default.
 */

import { FaceSignalsPayload } from "./types";

export interface SignalRecordEntry {
  timestamp: number;
  relative_time_s: number;
  face_present: boolean;
  quality_score: number;
  eye_blink_left: number;
  eye_blink_right: number;
  eye_closure: number;
  ear_fallback: number;
  jaw_open: number;
  pitch_deg: number;
  yaw_deg: number;
  roll_deg: number;
}

export interface SignalRecordingSession {
  session_id: string;
  start_time: string;
  end_time: string;
  sample_count: number;
  samples: SignalRecordEntry[];
}

export class SignalRecorder {
  private isRecording = false;
  private startTime = 0;
  private samples: SignalRecordEntry[] = [];
  private sessionId = "";

  public start(): void {
    this.isRecording = true;
    this.startTime = Date.now();
    this.samples = [];
    this.sessionId = `rec_${this.startTime}_${Math.random().toString(36).substring(2, 7)}`;
  }

  public stop(): SignalRecordingSession | null {
    if (!this.isRecording) return null;
    this.isRecording = false;
    const session = this.exportSession();
    return session;
  }

  public isActive(): boolean {
    return this.isRecording;
  }

  public recordSample(payload: FaceSignalsPayload): void {
    if (!this.isRecording) return;

    const relativeS = Math.round(((Date.now() - this.startTime) / 1000) * 100) / 100;
    const entry: SignalRecordEntry = {
      timestamp: payload.timestamp,
      relative_time_s: relativeS,
      face_present: payload.facePresent,
      quality_score: Math.round(payload.qualityScore),
      eye_blink_left: Math.round(payload.eyeBlinkLeft * 1000) / 1000,
      eye_blink_right: Math.round(payload.eyeBlinkRight * 1000) / 1000,
      eye_closure: Math.round(payload.eyeClosure * 1000) / 1000,
      ear_fallback: Math.round(payload.earFallback * 1000) / 1000,
      jaw_open: Math.round(payload.jawOpen * 1000) / 1000,
      pitch_deg: Math.round(payload.pitchDeg * 10) / 10,
      yaw_deg: Math.round(payload.yawDeg * 10) / 10,
      roll_deg: Math.round(payload.rollDeg * 10) / 10,
    };

    this.samples.push(entry);
  }

  public getSamples(): SignalRecordEntry[] {
    return [...this.samples];
  }

  public exportSession(): SignalRecordingSession {
    return {
      session_id: this.sessionId || `rec_${Date.now()}`,
      start_time: new Date(this.startTime || Date.now()).toISOString(),
      end_time: new Date().toISOString(),
      sample_count: this.samples.length,
      samples: [...this.samples],
    };
  }

  public exportJson(): string {
    return JSON.stringify(this.exportSession(), null, 2);
  }

  public downloadJson(filename?: string): void {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(this.exportJson());
    const downloadAnchor = document.createElement("a");
    const name = filename || `study_signals_${this.sessionId || Date.now()}.json`;
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", name);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  public clear(): void {
    this.samples = [];
    this.isRecording = false;
    this.startTime = 0;
    this.sessionId = "";
  }
}

export const signalRecorder = new SignalRecorder();
