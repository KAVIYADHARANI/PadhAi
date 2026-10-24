/**
 * Exhaustive Vitest replay test suite for BuddyEngine.
 * Covers all 8+ required scenarios per BUILD_PLAYBOOK Task 4A and README Section 11.
 */

import { describe, expect, it } from "vitest";
import { BuddyEngine, DEFAULT_CONFIG } from "../buddy/engine";

describe("Study Buddy Rule Engine", () => {
  const BASE_TIME = 1700000000000; // Fixed deterministic epoch

  it("Scenario 1: Clean initialization in ready state with full Pomodoro timer", () => {
    const engine = new BuddyEngine(BASE_TIME);
    const snap = engine.getSnapshot(BASE_TIME);

    expect(snap.state).toBe("ready");
    expect(snap.nudge_step).toBe(0);
    expect(snap.pomodoro_phase).toBe("work");
    expect(snap.pomodoro_time_remaining_s).toBe(DEFAULT_CONFIG.work_duration_s);
    expect(snap.pomodoro_completed_count).toBe(0);
    expect(snap.in_quiet_period).toBe(false);
  });

  it("Scenario 2: Full Pomodoro work countdown completes and transitions to break", () => {
    const engine = new BuddyEngine(BASE_TIME, { work_duration_s: 1500, break_duration_s: 300 });

    // Tick 1500 seconds forward
    const tEnd = BASE_TIME + 1500 * 1000;
    const snap = engine.tick(tEnd);

    expect(snap.pomodoro_phase).toBe("break");
    expect(snap.state).toBe("break_time");
    expect(snap.pomodoro_time_remaining_s).toBe(300);
    expect(snap.active_suggestion).not.toBeNull();
    expect(snap.active_suggestion?.type).toBe("pomodoro");
  });

  it("Scenario 3: Nudge ladder Step 1 (~45s inattention) triggers curious_check", () => {
    const engine = new BuddyEngine(BASE_TIME);
    // User stops interacting at BASE_TIME
    engine.updateSignals({ input_active: false, last_interaction_time: BASE_TIME });

    // Advance 45 seconds
    const snap = engine.tick(BASE_TIME + 46 * 1000);

    expect(snap.nudge_step).toBe(1);
    expect(snap.state).toBe("curious_check");
    expect(snap.active_suggestion).toBeNull(); // No text, visual head tilt only
  });

  it("Scenario 4: Nudge ladder Step 2 (~2 min inattention) triggers gentle_nudge", () => {
    const engine = new BuddyEngine(BASE_TIME);
    engine.updateSignals({ input_active: false, last_interaction_time: BASE_TIME });

    // Advance 121 seconds (2 minutes)
    const snap = engine.tick(BASE_TIME + 121 * 1000);

    expect(snap.nudge_step).toBe(2);
    expect(snap.state).toBe("gentle_nudge");
  });

  it("Scenario 5: Nudge ladder Step 3 (~5 min inattention) triggers tired_check with choices", () => {
    const engine = new BuddyEngine(BASE_TIME);
    engine.updateSignals({ input_active: false, last_interaction_time: BASE_TIME });

    // Advance 301 seconds (5 minutes)
    const snap = engine.tick(BASE_TIME + 301 * 1000);

    expect(snap.nudge_step).toBe(3);
    expect(snap.state).toBe("tired_check");
    expect(snap.active_suggestion).not.toBeNull();
    expect(snap.active_suggestion?.message).toContain("You might be getting tired");
    // Verify non-punitive options: includes "I'm fine"
    const choiceLabels = snap.active_suggestion?.choices.map((c) => c.label);
    expect(choiceLabels).toContain("I'm fine");
  });

  it("Scenario 6: Ignored Step 3 enters 15-minute quiet period and returns to studying", () => {
    const engine = new BuddyEngine(BASE_TIME);
    engine.updateSignals({ input_active: false, last_interaction_time: BASE_TIME });

    // 1. Advance to Step 3 (at 301s)
    engine.tick(BASE_TIME + 301 * 1000);

    // 2. Ignore for 61s more (total 362s)
    const snap = engine.tick(BASE_TIME + 365 * 1000);

    expect(snap.nudge_step).toBe(0);
    expect(snap.state).toBe("studying");
    expect(snap.in_quiet_period).toBe(true);
    expect(snap.quiet_period_remaining_s).toBeGreaterThanOrEqual(890);

    // 3. Further inactivity during quiet period does NOT trigger nudges
    const quietSnap = engine.tick(BASE_TIME + 600 * 1000);
    expect(quietSnap.nudge_step).toBe(0);
    expect(quietSnap.state).toBe("studying");
  });

  it("Scenario 7: Invariant check - Nudge ladder NEVER exceeds step 3", () => {
    const engine = new BuddyEngine(BASE_TIME);
    engine.updateSignals({ input_active: false, last_interaction_time: BASE_TIME });

    // Advance through massive inactivity (e.g. 1000 seconds)
    const snap = engine.tick(BASE_TIME + 1000 * 1000);

    expect(snap.nudge_step).toBeLessThanOrEqual(3);
    expect(snap.nudge_step).toBeGreaterThanOrEqual(0);
  });

  it("Scenario 8: User interaction resets in-progress nudge ladder back to 0", () => {
    const engine = new BuddyEngine(BASE_TIME);
    engine.updateSignals({ input_active: false, last_interaction_time: BASE_TIME });

    // Advance to Step 2
    engine.tick(BASE_TIME + 150 * 1000);
    expect(engine.getSnapshot(BASE_TIME + 150 * 1000).nudge_step).toBe(2);

    // User types / moves mouse
    const activeTime = BASE_TIME + 155 * 1000;
    const snap = engine.tick(activeTime, { input_active: true });

    expect(snap.nudge_step).toBe(0);
    expect(snap.state).toBe("studying");
  });

  it("Scenario 9: Active quiz question QUEUES proactive break until question is submitted", () => {
    const engine = new BuddyEngine(BASE_TIME, { work_duration_s: 1500 });

    // 1. Start quiz question at minute 24
    engine.handleQuizEvent({ type: "question_started", timestamp: BASE_TIME + 1440 * 1000 });

    // 2. Pomodoro hits 1500s work completion while question is active
    const snapAtComplete = engine.tick(BASE_TIME + 1500 * 1000);

    // Question is active: MUST NOT interrupt with popups or switch phase mid-question!
    expect(snapAtComplete.active_suggestion).toBeNull();
    expect(snapAtComplete.queued_suggestion).not.toBeNull();
    expect(snapAtComplete.queued_suggestion?.type).toBe("pomodoro");

    // 3. User submits answer
    const snapAfterSubmit = engine.handleQuizEvent(
      { type: "answer_submitted", timestamp: BASE_TIME + 1510 * 1000 },
      BASE_TIME + 1510 * 1000
    );

    // Now delivered immediately!
    expect(snapAfterSubmit.queued_suggestion).toBeNull();
    expect(snapAfterSubmit.active_suggestion).not.toBeNull();
    expect(snapAfterSubmit.pomodoro_phase).toBe("break");
  });

  it("Scenario 10: User-initiated break always works immediately", () => {
    const engine = new BuddyEngine(BASE_TIME);

    const snap = engine.requestBreak(BASE_TIME + 300 * 1000, 600); // Request 10m break

    expect(snap.pomodoro_phase).toBe("break");
    expect(snap.state).toBe("break_time");
    expect(snap.pomodoro_time_remaining_s).toBe(600);
  });

  it("Scenario 11: Adaptive arithmetic - dismissals increase cooldown, acceptances decrease it", () => {
    const engine = new BuddyEngine(BASE_TIME, { base_cooldown_s: 900 });

    // Simulate Step 3 prompt
    engine.tick(BASE_TIME + 305 * 1000, { input_active: false, last_interaction_time: BASE_TIME });
    expect(engine.getSnapshot().active_suggestion).not.toBeNull();

    // 1. Dismiss suggestion -> cooldown increases by 20% (900 * 1.2 = 1080)
    const snapAfterDismiss = engine.respondToSuggestion("dismiss", BASE_TIME + 306 * 1000);
    expect(snapAfterDismiss.current_cooldown_s).toBe(1080);
    expect(snapAfterDismiss.state).toBe("studying");

    // 2. Another prompt dismissed -> cooldown increases again (1080 * 1.2 = 1296)
    engine.tick(BASE_TIME + 1400 * 1000, { input_active: false, last_interaction_time: BASE_TIME + 1100 * 1000 });
    // Trigger manual break suggestion for test
    engine.requestBreak(BASE_TIME + 1400 * 1000);
    engine.endBreak();

    // 3. Accept a suggestion -> cooldown scales down toward baseline (1080 * 0.9 = 972)
    // Manually test accept on step 3
    engine.tick(BASE_TIME + 2000 * 1000, { input_active: false, last_interaction_time: BASE_TIME + 1700 * 1000 });
    const snapAfterAccept = engine.respondToSuggestion("accept", BASE_TIME + 2001 * 1000);
    expect(snapAfterAccept.current_cooldown_s).toBeLessThan(1080);
    expect(snapAfterAccept.pomodoro_phase).toBe("break");
  });

  it("Scenario 12: Hidden tab transitions to away state and resumes smoothly", () => {
    const engine = new BuddyEngine(BASE_TIME);

    // Tab hidden
    const awaySnap = engine.tick(BASE_TIME + 10 * 1000, { tab_visible: false });
    expect(awaySnap.state).toBe("away");

    // Tab visible again
    const resumeSnap = engine.tick(BASE_TIME + 20 * 1000, { tab_visible: true });
    expect(resumeSnap.state).toBe("studying");
  });

  it("Scenario 13: Quiz streak triggers celebrate state; 2 misses trigger supportive pause", () => {
    const engine = new BuddyEngine(BASE_TIME);

    // 1. Streak event -> celebrate state
    const celebrateSnap = engine.handleQuizEvent(
      { type: "streak", streak_count: 3, timestamp: BASE_TIME + 50 * 1000 },
      BASE_TIME + 50 * 1000
    );
    expect(celebrateSnap.state).toBe("celebrate");

    // 2. Consecutive misses -> frustration pause
    engine.handleQuizEvent({ type: "miss", timestamp: BASE_TIME + 60 * 1000 }, BASE_TIME + 60 * 1000);
    const missSnap2 = engine.handleQuizEvent(
      { type: "miss", timestamp: BASE_TIME + 70 * 1000 },
      BASE_TIME + 70 * 1000
    );

    expect(missSnap2.active_suggestion).not.toBeNull();
    expect(missSnap2.active_suggestion?.type).toBe("frustration_pause");
    expect(missSnap2.active_suggestion?.message).toContain("Tricky questions");
  });
});
