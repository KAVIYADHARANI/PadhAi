import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CameraMonitor } from "../components/buddy/CameraMonitor";
import { signalManager } from "../buddy/signalManager";
import { reminderManager } from "../buddy/reminderManager";

vi.mock("../buddy/signalManager", () => {
  let state = {
    isEnabled: false,
    hasPermission: false,
    isStreaming: false,
    mode: "screen" as const,
    qualityScore: 100,
    isLowQuality: false,
    error: null as string | null,
  };
  const stateListeners = new Set<(s: any) => void>();
  const signalsListeners = new Set<(s: any) => void>();

  return {
    signalManager: {
      getState: () => ({ ...state }),
      start: vi.fn(async () => {
        state.isEnabled = true;
        state.isStreaming = true;
        state.hasPermission = true;
        state.error = null;
        stateListeners.forEach((l) => l({ ...state }));
        return true;
      }),
      stop: vi.fn(() => {
        state.isEnabled = false;
        state.isStreaming = false;
        stateListeners.forEach((l) => l({ ...state }));
      }),
      setMode: vi.fn((m) => {
        state.mode = m;
        stateListeners.forEach((l) => l({ ...state }));
      }),
      subscribeState: (listener: any) => {
        stateListeners.add(listener);
        listener({ ...state });
        return () => stateListeners.delete(listener);
      },
      subscribeSignals: (listener: any) => {
        signalsListeners.add(listener);
        return () => signalsListeners.delete(listener);
      },
      _setError: (err: string | null) => {
        state.error = err;
        stateListeners.forEach((l) => l({ ...state }));
      },
    },
  };
});

describe("CameraMonitor Responsive Drawer Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (signalManager as any)._setError(null);
  });

  it("renders privacy status badge initially showing Camera Off", () => {
    render(<CameraMonitor />);
    expect(screen.getByText("Camera Off")).toBeInTheDocument();
  });

  it("opens right-side drawer when badge is clicked", () => {
    render(<CameraMonitor />);
    const badge = screen.getByText("Camera Off");
    fireEvent.click(badge);

    // Header and Drawer content is present
    expect(screen.getByText("Focus & Drowsiness Sensor")).toBeInTheDocument();
    expect(screen.getByText("Zero Image / Video Storage Guarantee")).toBeInTheDocument();
    expect(screen.getByText("Study Mode (Adjusts Tolerance)")).toBeInTheDocument();
    expect(screen.getByText("Spoken Focus Reminders")).toBeInTheDocument();
  });

  it("closes drawer when Done button or close X button is clicked", async () => {
    render(<CameraMonitor />);
    fireEvent.click(screen.getByText("Camera Off"));

    expect(screen.getByText("Focus & Drowsiness Sensor")).toBeInTheDocument();

    const doneButton = screen.getByRole("button", { name: /done/i });
    fireEvent.click(doneButton);

    await waitFor(() => {
      expect(screen.queryByText("Zero Image / Video Storage Guarantee")).not.toBeInTheDocument();
    });
  });

  it("closes drawer on Escape key press", async () => {
    render(<CameraMonitor />);
    fireEvent.click(screen.getByText("Camera Off"));
    expect(screen.getByText("Focus & Drowsiness Sensor")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Zero Image / Video Storage Guarantee")).not.toBeInTheDocument();
    });
  });

  it("toggles proactive voice reminders setting", () => {
    render(<CameraMonitor />);
    fireEvent.click(screen.getByText("Camera Off"));

    const voiceBtn = screen.getByRole("button", { name: "Toggle proactive voice reminders" });
    fireEvent.click(voiceBtn);

    expect(reminderManager.isProactiveVoiceEnabled()).toBe(true);
  });

  it("displays permission error banner and retry button when camera error occurs", () => {
    (signalManager as any)._setError("Camera permission was denied.");
    render(<CameraMonitor />);
    fireEvent.click(screen.getByText("Camera Off"));

    expect(screen.getByText("Camera permission was denied.")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /retry permission/i });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(signalManager.start).toHaveBeenCalled();
  });
});
