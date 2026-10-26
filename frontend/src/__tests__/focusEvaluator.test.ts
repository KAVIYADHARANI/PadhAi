import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  FocusEvaluator,
  FocusEvent,
} from "../buddy/focusEvaluator";
import { FaceSignalsPayload } from "../buddy/types";

function createSignal(overrides: Partial<FaceSignalsPayload> = {}): FaceSignalsPayload {
  return {
    timestamp: 1000,
    facePresent: true,
    qualityScore: 90,
    eyeBlinkLeft: 0.1,
    eyeBlinkRight: 0.1,
    eyeClosure: 0.1,
    earFallback: 0.3,
    jawOpen: 0.05,
    pitchDeg: 0,
    yawDeg: 0,
    rollDeg: 0,
    ...overrides,
  };
}

describe("FocusEvaluator State Machine", () => {
  let evaluator: FocusEvaluator;

  beforeEach(() => {
    evaluator = new FocusEvaluator({
      sustainedThresholdS: 10,
      cooldownS: 60,
      minQualityScore: 35,
    });
  });

  it("initializes in disabled state when camera is off", () => {
    const state = evaluator.process(createSignal(), {
      cameraEnabled: false,
      tabVisible: true,
    });
    expect(state).toBe("disabled");
  });

  it("transitions to focused when looking directly at screen", () => {
    const signal = createSignal({ yawDeg: 5, pitchDeg: -2 });
    const state = evaluator.process(signal, {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 1000,
    });
    expect(state).toBe("focused");
  });

  it("does not trigger an alert on brief glance / short look-away under 10 seconds", () => {
    const listener = vi.fn();
    evaluator.subscribe(listener);

    // Initial focused frame at t=0
    evaluator.process(createSignal({ yawDeg: 0 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 1000,
    });

    // Turned head at t=2000 (2s)
    const state2 = evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 2000,
    });
    // Brief glance: still reported as focused/unconfirmed to avoid false alarms
    expect(state2).toBe("focused");

    // Look away at t=6000 (5s total duration)
    const state6 = evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 6000,
    });
    expect(state6).toBe("focused");

    // No sustained look away event triggered yet
    expect(listener).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "sustained_look_away" })
    );
  });

  it("triggers exactly one sustained_look_away event when look-away reaches sustained threshold (10s)", () => {
    const events: FocusEvent[] = [];
    evaluator.subscribe((e) => events.push(e));

    // Look away starts at t=1000
    evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 1000,
    });

    // Intermediate frame at t=6000 (5s elapsed)
    evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 6000,
    });
    expect(events.filter((e) => e.type === "sustained_look_away")).toHaveLength(0);

    // Sustained threshold reached at t=11000 (10s elapsed)
    const state11 = evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 11000,
    });
    expect(state11).toBe("looking_away");
    expect(events.filter((e) => e.type === "sustained_look_away")).toHaveLength(1);

    // Continues looking away at t=15000: does NOT duplicate alert during same continuous event
    evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 15000,
    });
    expect(events.filter((e) => e.type === "sustained_look_away")).toHaveLength(1);
  });

  it("resets look-away timer immediately when returning to the screen", () => {
    const events: FocusEvent[] = [];
    evaluator.subscribe((e) => events.push(e));

    // Looking away for 12 seconds
    evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 1000,
    });
    evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 13000,
    });
    expect(evaluator.getState()).toBe("looking_away");

    // Returns to screen at t=14000
    const returnedState = evaluator.process(createSignal({ yawDeg: 5, pitchDeg: 0 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 14000,
    });

    expect(returnedState).toBe("focused");
    expect(events.some((e) => e.type === "focus_restored")).toBe(true);
  });

  it("enforces cooldown (60s) before repeating alerts", () => {
    const events: FocusEvent[] = [];
    evaluator.subscribe((e) => events.push(e));

    // First sustained look-away: t=0 to t=10000
    evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 0,
    });
    evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 10000,
    });
    expect(events.filter((e) => e.type === "sustained_look_away")).toHaveLength(1);

    // Return briefly to screen at t=15000
    evaluator.process(createSignal({ yawDeg: 0 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 15000,
    });

    // Look away again at t=20000 and reaches 10s at t=30000 (30s since first reminder < 60s cooldown)
    evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 20000,
    });
    evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 30000,
    });
    // Cooldown active: no second reminder fired yet
    expect(events.filter((e) => e.type === "sustained_look_away")).toHaveLength(1);

    // After 60s cooldown (t=75000), a new sustained look-away triggers a new reminder
    evaluator.process(createSignal({ yawDeg: 0 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 62000,
    });
    evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 65000,
    });
    evaluator.process(createSignal({ yawDeg: 45 }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 76000,
    });
    expect(events.filter((e) => e.type === "sustained_look_away")).toHaveLength(2);
  });

  it("produces uncertain state on missing face or poor lighting, NOT a distraction diagnosis", () => {
    const events: FocusEvent[] = [];
    evaluator.subscribe((e) => events.push(e));

    // Missing face (facePresent: false)
    const stateNoFace = evaluator.process(createSignal({ facePresent: false }), {
      cameraEnabled: true,
      tabVisible: true,
      nowMs: 1000,
    });
    expect(stateNoFace).toBe("uncertain");
    expect(events.some((e) => e.type === "uncertain_state")).toBe(true);

    // Low quality lighting (qualityScore: 20 < 35)
    const stateLowQuality = evaluator.process(
      createSignal({ facePresent: true, qualityScore: 20 }),
      {
        cameraEnabled: true,
        tabVisible: true,
        nowMs: 2000,
      }
    );
    expect(stateLowQuality).toBe("uncertain");
  });

  it("pauses evaluation when the browser tab is hidden", () => {
    const events: FocusEvent[] = [];
    evaluator.subscribe((e) => events.push(e));

    const stateHidden = evaluator.process(createSignal(), {
      cameraEnabled: true,
      tabVisible: false,
      nowMs: 1000,
    });

    expect(stateHidden).toBe("paused");
    expect(events.some((e) => e.state === "paused")).toBe(true);
  });

  it("tolerates looking down in book_notes mode", () => {
    // Pitch = -35 (looking down at notes)
    const signalLookingDown = createSignal({ yawDeg: 5, pitchDeg: -35 });

    // In screen mode, looking down is considered look-away
    evaluator.process(signalLookingDown, {
      cameraEnabled: true,
      tabVisible: true,
      studyMode: "screen",
      nowMs: 1000,
    });
    evaluator.process(signalLookingDown, {
      cameraEnabled: true,
      tabVisible: true,
      studyMode: "screen",
      nowMs: 12000,
    });
    expect(evaluator.getState()).toBe("looking_away");

    // In book_notes mode, looking down is expected and accepted as focused
    evaluator.reset();
    const bookNotesState = evaluator.process(signalLookingDown, {
      cameraEnabled: true,
      tabVisible: true,
      studyMode: "book_notes",
      nowMs: 1000,
    });
    expect(bookNotesState).toBe("focused");
  });

  it("detects possible drowsiness when drowsiness score is high", () => {
    const events: FocusEvent[] = [];
    evaluator.subscribe((e) => events.push(e));

    const signal = createSignal({ eyeClosure: 0.85 });
    const state = evaluator.process(signal, {
      cameraEnabled: true,
      tabVisible: true,
      drowsinessScore: 75,
      nowMs: 1000,
    });

    expect(state).toBe("drowsy");
    expect(events.some((e) => e.type === "possible_drowsiness")).toBe(true);
  });
});
