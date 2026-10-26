/**
 * Signal Manager for Study Buddy v2.
 *
 * Responsibilities:
 * 1. Opt-in Camera lifecycle management (camera off is the default).
 * 2. Spawns and supervises the face-signals.worker.ts Web Worker.
 * 3. Throttles frame sampling to 5–10 FPS (120ms cycle).
 * 4. Pauses processing completely when the browser tab is hidden.
 * 5. Passes derived numeric signals to subscribers and recorder.
 * 6. Guarantees raw frames never escape the local device or leave the worker.
 */

import { signalRecorder } from "./recorder";
import {
  CameraState,
  CameraStudyMode,
  FaceSignalsPayload,
  FaceWorkerInMessage,
  FaceWorkerOutMessage,
} from "./types";

export type SignalsListener = (signals: FaceSignalsPayload) => void;
export type CameraStateListener = (state: CameraState) => void;

export class SignalManager {
  private worker: Worker | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private mediaStream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private lastFrameTimestamp = 0;
  private targetIntervalMs = 125; // ~8 FPS
  private isProcessing = false;
  private isTabVisible = true;

  private state: CameraState = {
    isEnabled: false,
    hasPermission: false,
    isStreaming: false,
    mode: "screen",
    qualityScore: 100,
    isLowQuality: false,
    error: null,
  };

  private signalsListeners: Set<SignalsListener> = new Set();
  private stateListeners: Set<CameraStateListener> = new Set();

  constructor() {
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  public getState(): CameraState {
    return { ...this.state };
  }

  public setMode(mode: CameraStudyMode): void {
    this.state.mode = mode;
    this.notifyState();
    if (mode === "camera_off" && this.state.isEnabled) {
      this.stop();
    }
  }

  public subscribeSignals(listener: SignalsListener): () => void {
    this.signalsListeners.add(listener);
    return () => this.signalsListeners.delete(listener);
  }

  public subscribeState(listener: CameraStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => this.stateListeners.delete(listener);
  }

  private notifyState(): void {
    const currentState = this.getState();
    this.stateListeners.forEach((l) => l(currentState));
  }

  private notifySignals(payload: FaceSignalsPayload): void {
    // Record sample if recording is active
    if (signalRecorder.isActive()) {
      signalRecorder.recordSample(payload);
    }

    // Update quality state
    const isLowQuality = payload.facePresent && payload.qualityScore < 40;
    if (this.state.qualityScore !== payload.qualityScore || this.state.isLowQuality !== isLowQuality) {
      this.state.qualityScore = payload.qualityScore;
      this.state.isLowQuality = isLowQuality;
      this.notifyState();
    }

    this.signalsListeners.forEach((l) => l(payload));
  }

  /**
   * Initializes Web Worker and requests camera access.
   */
  public async start(): Promise<boolean> {
    if (this.state.isEnabled && this.state.isStreaming) {
      return true;
    }

    this.state.isEnabled = true;
    this.state.error = null;
    this.notifyState();

    try {
      // 1. Initialize Worker if needed
      if (!this.worker) {
        this.initWorker();
      }

      // 2. Request user media with privacy constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 10, max: 15 },
          facingMode: "user",
        },
        audio: false,
      });

      this.mediaStream = stream;
      this.state.hasPermission = true;

      // 3. Create hidden off-screen video element
      if (!this.videoElement) {
        this.videoElement = document.createElement("video");
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
        this.videoElement.autoplay = true;
        this.videoElement.style.display = "none";
        document.body.appendChild(this.videoElement);
      }

      this.videoElement.srcObject = stream;
      await this.videoElement.play();

      this.state.isStreaming = true;
      this.notifyState();

      // 4. Begin frame processing loop
      this.startFrameLoop();
      return true;
    } catch (err: any) {
      this.state.hasPermission = false;
      this.state.isStreaming = false;
      this.state.isEnabled = false;
      this.state.error =
        err?.name === "NotAllowedError"
          ? "Camera permission was denied. Face signals will remain in standby."
          : err?.message || "Could not access webcam for study signals.";
      this.notifyState();
      this.cleanupMedia();
      return false;
    }
  }

  /**
   * Stops video capture and releases hardware devices.
   */
  public stop(): void {
    this.stopFrameLoop();
    this.cleanupMedia();

    this.state.isEnabled = false;
    this.state.isStreaming = false;
    this.state.error = null;
    this.notifyState();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(
        new URL("../workers/face-signals.worker.ts", import.meta.url),
        { type: "module" }
      );

      this.worker.onmessage = (event: MessageEvent<FaceWorkerOutMessage>) => {
        const msg = event.data;
        if (!msg) return;

        if (msg.type === "SIGNALS") {
          this.notifySignals(msg.data);
        } else if (msg.type === "INITIALIZED" && !msg.success) {
          console.warn("[SignalManager] Worker initialization warning:", msg.error);
        } else if (msg.type === "ERROR") {
          console.warn("[SignalManager] Worker processing error:", msg.error);
        }
      };

      const initMsg: FaceWorkerInMessage = { type: "INIT" };
      this.worker.postMessage(initMsg);
    } catch (workerErr) {
      console.error("[SignalManager] Failed to create face signals worker:", workerErr);
    }
  }

  private handleVisibilityChange(): void {
    if (typeof document === "undefined") return;
    this.isTabVisible = document.visibilityState === "visible";

    if (!this.isTabVisible) {
      // Pause frame capture when hidden
      this.stopFrameLoop();
    } else if (this.state.isStreaming && !this.animationFrameId) {
      // Resume frame capture when visible
      this.startFrameLoop();
    }
  }

  private startFrameLoop(): void {
    if (this.animationFrameId !== null) return;

    const frameStep = async () => {
      if (!this.state.isStreaming || !this.isTabVisible) {
        this.animationFrameId = null;
        return;
      }

      const now = performance.now();
      if (
        now - this.lastFrameTimestamp >= this.targetIntervalMs &&
        !this.isProcessing &&
        this.videoElement &&
        this.videoElement.readyState >= 2 && // HAVE_CURRENT_DATA
        this.worker
      ) {
        this.lastFrameTimestamp = now;
        this.isProcessing = true;

        try {
          // Extract ImageBitmap from video
          const bitmap = await createImageBitmap(this.videoElement);
          const processMsg: FaceWorkerInMessage = {
            type: "PROCESS_FRAME",
            bitmap,
            timestamp: now,
          };
          // Transfer bitmap to worker to avoid main-thread copy
          this.worker.postMessage(processMsg, [bitmap]);
        } catch {
          // Ignore transient capture error
        } finally {
          this.isProcessing = false;
        }
      }

      this.animationFrameId = requestAnimationFrame(frameStep);
    };

    this.animationFrameId = requestAnimationFrame(frameStep);
  }

  private stopFrameLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isProcessing = false;
  }

  private cleanupMedia(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      this.mediaStream = null;
    }

    if (this.videoElement) {
      try {
        this.videoElement.srcObject = null;
        this.videoElement.remove();
      } catch {
        // ignore
      }
      this.videoElement = null;
    }
  }

  public destroy(): void {
    this.stop();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.signalsListeners.clear();
    this.stateListeners.clear();
  }
}

export const signalManager = new SignalManager();
