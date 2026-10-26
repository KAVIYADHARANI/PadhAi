import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { signalRecorder } from "../buddy/recorder";
import { signalManager } from "../buddy/signalManager";
import { FaceSignalsPayload } from "../buddy/types";
import { CameraMonitor } from "../components/buddy/CameraMonitor";

describe("SignalManager, SignalRecorder, and CameraMonitor", () => {
  beforeEach(() => {
    signalRecorder.clear();
    signalManager.stop();
  });

  describe("SignalRecorder", () => {
    it("starts, records numeric samples, and exports JSON session", () => {
      signalRecorder.start();
      expect(signalRecorder.isActive()).toBe(true);

      const mockPayload: FaceSignalsPayload = {
        timestamp: 1700000000000,
        facePresent: true,
        qualityScore: 92,
        eyeBlinkLeft: 0.05,
        eyeBlinkRight: 0.04,
        eyeClosure: 0.045,
        earFallback: 0.29,
        jawOpen: 0.02,
        pitchDeg: -4.5,
        yawDeg: 1.2,
        rollDeg: 0.1,
      };

      signalRecorder.recordSample(mockPayload);
      const samples = signalRecorder.getSamples();
      expect(samples.length).toBe(1);
      expect(samples[0].face_present).toBe(true);
      expect(samples[0].eye_closure).toBe(0.045);
      expect(samples[0].quality_score).toBe(92);

      const session = signalRecorder.stop();
      expect(signalRecorder.isActive()).toBe(false);
      expect(session).not.toBeNull();
      expect(session?.sample_count).toBe(1);

      // Verify that exported JSON contains ONLY numeric data and no image properties
      const jsonStr = signalRecorder.exportJson();
      const parsed = JSON.parse(jsonStr);
      expect(parsed.samples[0]).toHaveProperty("pitch_deg");
      expect(parsed.samples[0]).toHaveProperty("eye_closure");
      expect(parsed.samples[0]).not.toHaveProperty("image");
      expect(parsed.samples[0]).not.toHaveProperty("frame");
      expect(parsed.samples[0]).not.toHaveProperty("bitmap");
    });
  });

  describe("SignalManager", () => {
    it("initializes with camera off and sensors in standby by default", () => {
      const state = signalManager.getState();
      expect(state.isEnabled).toBe(false);
      expect(state.isStreaming).toBe(false);
      expect(state.hasPermission).toBe(false);
      expect(state.mode).toBe("screen");
    });

    it("allows switching study modes", () => {
      signalManager.setMode("book_notes");
      expect(signalManager.getState().mode).toBe("book_notes");

      signalManager.setMode("presence_only");
      expect(signalManager.getState().mode).toBe("presence_only");
    });
  });

  describe("CameraMonitor Component", () => {
    it("renders Camera Off status badge by default", () => {
      render(<CameraMonitor />);
      expect(screen.getByText("Camera Off")).toBeInTheDocument();
    });

    it("opens privacy modal when clicking the status badge", () => {
      render(<CameraMonitor />);
      const badge = screen.getByText("Camera Off");
      fireEvent.click(badge);

      expect(screen.getByText("Focus & Drowsiness Sensor")).toBeInTheDocument();
      expect(screen.getByText("Zero Image / Video Storage Guarantee")).toBeInTheDocument();
      expect(
        screen.getByText(/Raw camera frames are processed exclusively inside an isolated Web Worker/i)
      ).toBeInTheDocument();
      expect(screen.getByText("Enable Sensor")).toBeInTheDocument();
      expect(screen.getByText("Screen Focus")).toBeInTheDocument();
      expect(screen.getByText("Book / Notes")).toBeInTheDocument();
    });
  });
});
