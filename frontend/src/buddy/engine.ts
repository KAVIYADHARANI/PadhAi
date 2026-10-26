/**
 * Pure, deterministic Study Buddy rule engine and Break policy engine.
 * Defined strictly per README Sections 11.1, 11.3, 11.4.
 *
 * Ground Rules:
 * - Pure TypeScript with zero React or browser DOM dependencies.
 * - Buddy never diagnoses: wording says "you might be getting tired", never "you are sleepy".
 * - Never interrupts active quiz questions (queues until submitted).
 * - Nudge ladder never exceeds step 3, and ignored steps trigger a 15-minute quiet period.
 * - Adaptive thresholds and cooldowns calculated with plain arithmetic.
 */

import {
  BreakEventRecord,
  BreakOutcome,
  BreakSuggestion,
  BreakType,
  BuddyEngineConfig,
  BuddyEngineSnapshot,
  BuddySignals,
  BuddyState,
  CameraStudyMode,
  FaceSignalsPayload,
  NudgeStep,
  QuizEvent,
} from "./types";
import { DEFAULT_BASELINE, SessionCalibrator } from "./calibration";
import { DrowsinessDetector, SensitivityLevel } from "./drowsiness";
import { AttentionDetector } from "./attention";
import { evaluateQualityGate, QualityGateDecision } from "./qualityGate";

export const DEFAULT_CONFIG: BuddyEngineConfig = {
  work_duration_s: 25 * 60, // 25 min default Pomodoro work phase
  break_duration_s: 5 * 60, // 5 min default Pomodoro break phase
  base_cooldown_s: 15 * 60, // 15 min default proactive break cooldown
  quiet_period_s: 15 * 60, // 15 min quiet period after ignored nudge
  step1_threshold_s: 45, // 45 s for head tilt (curious_check)
  step2_threshold_s: 120, // 2 min for bubble (gentle_nudge)
  step3_threshold_s: 300, // 5 min for choices (tired_check)
};

export class BuddyEngine {
  private config: BuddyEngineConfig;
  private state: BuddyState = "ready";
  private previousState: BuddyState = "ready";
  private nudgeStep: NudgeStep = 0;
  private pomodoroPhase: "work" | "break" = "work";
  private pomodoroTimeRemainingS: number;
  private pomodoroCompletedCount: number = 0;
  private sessionElapsedS: number = 0;

  private activeSuggestion: BreakSuggestion | null = null;
  private queuedSuggestion: BreakSuggestion | null = null;

  private lastProactiveBreakTime: number = 0;
  private currentCooldownS: number;
  private quietPeriodUntil: number = 0;
  private celebrateUntil: number = 0;
  private step3TriggeredTime: number = 0;

  private recentMissCount: number = 0;
  private recentStreakCount: number = 0;
  private breakHistory: BreakEventRecord[] = [];

  private lastTickMs: number;
  private signals: BuddySignals;

  // Signal detectors & settings
  private calibrator: SessionCalibrator;
  private drowsinessDetector: DrowsinessDetector;
  private attentionDetector: AttentionDetector;
  private studyMode: CameraStudyMode = "screen";
  private sensitivity: SensitivityLevel = "balanced";
  private qualityGateDecision: QualityGateDecision;

  // Realtime scores & aggregates
  private drowsinessScore: number = 0;
  private attentionScore: number = 85;
  private totalFocusSum: number = 0;
  private totalStudyTicks: number = 0;
  private drowsySeconds: number = 0;
  private sustainedDrowsyS: number = 0;
  private sustainedLowAttentionS: number = 0;

  constructor(
    initialNowMs: number = Date.now(),
    customConfig?: Partial<BuddyEngineConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
    this.pomodoroTimeRemainingS = this.config.work_duration_s;
    this.currentCooldownS = this.config.base_cooldown_s;
    this.lastTickMs = initialNowMs;
    this.signals = {
      tab_visible: true,
      input_active: true,
      last_interaction_time: initialNowMs,
      quiz_active: false,
    };

    this.calibrator = new SessionCalibrator();
    this.drowsinessDetector = new DrowsinessDetector();
    this.attentionDetector = new AttentionDetector();
    this.qualityGateDecision = evaluateQualityGate(100, true, "screen");
  }

  public setStudyMode(mode: CameraStudyMode): void {
    this.studyMode = mode;
    this.qualityGateDecision = evaluateQualityGate(
      this.qualityGateDecision.qualityScore,
      true,
      mode
    );
  }

  public setSensitivity(sensitivity: SensitivityLevel): void {
    this.sensitivity = sensitivity;
  }

  public resetCalibration(nowMs: number = Date.now()): void {
    this.calibrator.reset(nowMs);
  }

  /**
   * Ingests FaceSignalsPayload from worker or replay harness.
   */
  public processFaceSignal(signal: FaceSignalsPayload, nowMs: number = Date.now()): void {
    const baseline = this.calibrator.addSample(signal, nowMs);

    this.qualityGateDecision = evaluateQualityGate(
      signal.qualityScore,
      signal.facePresent,
      this.studyMode
    );

    if (this.qualityGateDecision.shouldSilenceDrowsiness) {
      this.drowsinessScore = 0;
    } else {
      const dMetrics = this.drowsinessDetector.processSignal(
        signal,
        baseline,
        this.qualityGateDecision.effectiveStudyMode,
        this.sensitivity
      );
      this.drowsinessScore = dMetrics.score;
    }

    const aMetrics = this.attentionDetector.processSignal(
      signal,
      this.signals.tab_visible,
      this.signals.last_interaction_time,
      nowMs,
      baseline,
      this.qualityGateDecision.effectiveStudyMode
    );
    this.attentionScore = aMetrics.score;
  }

  /**
   * Main periodic clock tick advancing state machine, timers, and checks.
   */
  public tick(
    nowMs: number,
    signalsUpdate?: Partial<BuddySignals>
  ): BuddyEngineSnapshot {
    if (signalsUpdate) {
      this.updateSignals(signalsUpdate, nowMs);
    }

    const deltaS = Math.max(0, (nowMs - this.lastTickMs) / 1000);
    this.lastTickMs = nowMs;

    // 1. Tab visibility handling: when hidden, transition to 'away'
    if (!this.signals.tab_visible) {
      if (this.state !== "away") {
        this.transitionTo("away");
      }
      return this.getSnapshot(nowMs);
    } else if (this.state === "away" || this.state === "ready") {
      this.transitionTo(this.pomodoroPhase === "break" ? "break_time" : "studying");
    }

    // 2. Timers accumulation
    this.sessionElapsedS += deltaS;

    // Update attention from input recency if camera is not updating scores
    if (this.studyMode === "camera_off") {
      const aMetrics = this.attentionDetector.processSignal(
        null,
        this.signals.tab_visible,
        this.signals.last_interaction_time,
        nowMs,
        DEFAULT_BASELINE,
        "camera_off"
      );
      this.attentionScore = aMetrics.score;
    }

    // Accumulate study statistics
    if (this.pomodoroPhase === "work" && (this.state === "studying" || this.state === "deep_focus")) {
      this.totalFocusSum += this.attentionScore;
      this.totalStudyTicks += 1;

      if (this.drowsinessScore >= 50) {
        this.drowsySeconds += deltaS;
      }

      // Check for deep focus transition (high focus, sustained, not drowsy, recent interaction, not quiet period)
      const inQuietPeriod = nowMs < this.quietPeriodUntil;
      const inputRecent = (nowMs - this.signals.last_interaction_time) < 60_000;

      if (
        this.state === "studying" &&
        !inQuietPeriod &&
        inputRecent &&
        this.attentionScore >= 80 &&
        this.drowsinessScore < 25 &&
        this.sessionElapsedS >= 300
      ) {
        this.transitionTo("deep_focus");
      } else if (this.state === "deep_focus" && (!inputRecent || inQuietPeriod || this.attentionScore < 60 || this.drowsinessScore >= 45)) {
        this.transitionTo("studying");
      }
    }

    // Track sustained fatigue / inattention for adaptive breaks
    if (this.drowsinessScore >= 70 && !this.qualityGateDecision.shouldSilenceDrowsiness) {
      this.sustainedDrowsyS += deltaS;
    } else {
      this.sustainedDrowsyS = Math.max(0, this.sustainedDrowsyS - deltaS * 0.5);
    }

    if (this.attentionScore < 35 && this.drowsinessScore < 50) {
      this.sustainedLowAttentionS += deltaS;
    } else {
      this.sustainedLowAttentionS = Math.max(0, this.sustainedLowAttentionS - deltaS * 0.5);
    }

    // 3. Temporary celebrate state expiration
    if (this.state === "celebrate" && nowMs >= this.celebrateUntil) {
      this.transitionTo(this.pomodoroPhase === "break" ? "break_time" : "studying");
    }

    // 4. Pomodoro Countdown
    this.pomodoroTimeRemainingS = Math.max(0, this.pomodoroTimeRemainingS - deltaS);

    if (this.pomodoroPhase === "work") {
      if (this.pomodoroTimeRemainingS <= 0) {
        this.handlePomodoroWorkComplete(nowMs);
      }
    } else if (this.pomodoroPhase === "break") {
      if (this.pomodoroTimeRemainingS <= 0) {
        this.handlePomodoroBreakComplete();
      }
    }

    // 5. In-session Nudge Ladder (only in 'work' phase and when not in quiet period)
    if (this.pomodoroPhase === "work" && this.state !== "break_time" && this.state !== "celebrate") {
      this.evaluateNudgeLadder(nowMs);
    }

    // 6. Proactive Break Checks (fatigue, sustained low attention, long unbroken study)
    if (this.pomodoroPhase === "work" && !this.activeSuggestion && !this.queuedSuggestion) {
      this.evaluateProactiveBreakNeeds(nowMs);
    }

    return this.getSnapshot(nowMs);
  }

  /**
   * Evaluates the inattention / inactivity nudge ladder strictly per README 11.3:
   * Step 1 (~45s): curious_check (look up, tilt head, no text/sound)
   * Step 2 (~2 min): gentle_nudge ("Need a minute? I'm here.")
   * Step 3 (~5 min): tired_check (offers choices: short break, switch topic, easier task, "I'm fine")
   * Step 4 / Ignored: quiet period for 15 min, back to quiet studying. Ladder NEVER exceeds step 3.
   */
  private evaluateNudgeLadder(nowMs: number): void {
    const inQuietPeriod = nowMs < this.quietPeriodUntil;
    if (inQuietPeriod) {
      if (this.nudgeStep !== 0) {
        this.nudgeStep = 0;
      }
      if (this.isNudgeState(this.state)) {
        this.transitionTo("studying");
      }
      return;
    }

    // If active input, user is paying attention -> reset ladder
    if (this.signals.input_active) {
      if (this.nudgeStep !== 0) {
        this.nudgeStep = 0;
      }
      if (this.isNudgeState(this.state)) {
        this.transitionTo("studying");
      }
      this.step3TriggeredTime = 0;
      return;
    }

    const inactiveS = Math.max(0, (nowMs - this.signals.last_interaction_time) / 1000);

    // If step 3 was triggered and remained ignored for 60 seconds -> Enter 15-minute quiet period
    if (this.nudgeStep === 3 && this.step3TriggeredTime > 0) {
      if (nowMs - this.step3TriggeredTime >= 60 * 1000) {
        this.recordBreakOutcome("ignored", "drowsy_stretch", nowMs);
        this.quietPeriodUntil = nowMs + this.config.quiet_period_s * 1000;
        this.nudgeStep = 0;
        this.activeSuggestion = null;
        this.step3TriggeredTime = 0;
        this.transitionTo("studying");
        return;
      }
    }

    // Ladder escalation
    if (inactiveS >= this.config.step3_threshold_s) {
      if (this.nudgeStep < 3) {
        this.nudgeStep = 3;
        this.step3TriggeredTime = nowMs;
        this.transitionTo("tired_check");
        this.activeSuggestion = {
          id: `nudge_step3_${nowMs}`,
          type: "drowsy_stretch",
          title: "Study Check-in",
          message: "You might be getting tired. Would you like a breather?",
          suggested_duration_s: 300,
          choices: [
            { label: "Short break", action: "accept" },
            { label: "Switch topic", action: "switch_topic" },
            { label: "Easier task", action: "easier_task" },
            { label: "I'm fine", action: "dismiss" },
          ],
          created_at: nowMs,
        };
      }
    } else if (inactiveS >= this.config.step2_threshold_s) {
      if (this.nudgeStep < 2) {
        this.nudgeStep = 2;
        this.transitionTo("gentle_nudge");
      }
    } else if (inactiveS >= this.config.step1_threshold_s) {
      if (this.nudgeStep < 1) {
        this.nudgeStep = 1;
        this.transitionTo("curious_check");
      }
    }
  }

  /**
   * Evaluates proactive break triggers per README 11.4:
   * 1. Sustained drowsiness (> 70 for > 2 min): suggest movement break (drowsy_stretch)
   * 2. Sustained low attention (< 35 for > 2 min, not drowsy): suggest topic_switch or short sprint
   * 3. Long unbroken study (>= 50 minutes): suggest eye_rest (20-20-20 rule + stand)
   * At most 1 proactive prompt per cooldown period (default 15 minutes).
   */
  private evaluateProactiveBreakNeeds(nowMs: number): void {
    const timeSinceLastPrompt = nowMs - this.lastProactiveBreakTime;
    if (timeSinceLastPrompt < this.currentCooldownS * 1000) {
      return; // In proactive break cooldown
    }

    if (nowMs < this.quietPeriodUntil) {
      return; // In quiet period
    }

    // 1. Sustained drowsiness (> 70 for > 120s)
    if (this.sustainedDrowsyS >= 120 && !this.qualityGateDecision.shouldSilenceDrowsiness) {
      this.sustainedDrowsyS = 0;
      const suggestion: BreakSuggestion = {
        id: `drowsy_${nowMs}`,
        type: "drowsy_stretch",
        title: "Movement Break?",
        message: "You might be getting tired. Would you like to do a quick 3-minute stretch or walk around?",
        suggested_duration_s: 180,
        choices: [
          { label: "Quick stretch", action: "accept" },
          { label: "Switch topic", action: "switch_topic" },
          { label: "I'm fine", action: "dismiss" },
        ],
        created_at: nowMs,
      };
      this.deliverOrQueueSuggestion(suggestion, nowMs);
      return;
    }

    // 2. Sustained low attention (< 35 for > 120s, not drowsy)
    if (this.sustainedLowAttentionS >= 120 && this.drowsinessScore < 50) {
      this.sustainedLowAttentionS = 0;
      const suggestion: BreakSuggestion = {
        id: `attention_${nowMs}`,
        type: "topic_switch",
        title: "Switch Topics or Sprint?",
        message: "Focus seems a bit tough right now. Would you like to switch to an easier topic or do a quick flashcard sprint?",
        suggested_duration_s: 180,
        choices: [
          { label: "Switch topic", action: "switch_topic" },
          { label: "Flashcards", action: "flashcards" },
          { label: "I'm fine", action: "dismiss" },
        ],
        created_at: nowMs,
      };
      this.deliverOrQueueSuggestion(suggestion, nowMs);
      return;
    }

    // 3. Long unbroken stretch (50+ min = 3000 s)
    if (this.sessionElapsedS >= 50 * 60) {
      const suggestion: BreakSuggestion = {
        id: `unbroken_${nowMs}`,
        type: "eye_rest",
        title: "Eye Rest & Stretch",
        message: "You've been studying for a solid stretch! Rest your eyes for 20 seconds and stretch.",
        suggested_duration_s: 180,
        choices: [
          { label: "Take break", action: "accept" },
          { label: "I'm fine", action: "dismiss" },
        ],
        created_at: nowMs,
      };

      this.deliverOrQueueSuggestion(suggestion, nowMs);
    }
  }

  /**
   * Delivers break suggestion immediately or queues it if a quiz question is active.
   */
  private deliverOrQueueSuggestion(suggestion: BreakSuggestion, nowMs: number): void {
    this.lastProactiveBreakTime = nowMs;

    if (this.signals.quiz_active) {
      this.queuedSuggestion = suggestion;
    } else {
      this.activeSuggestion = suggestion;
      if (suggestion.type === "pomodoro") {
        this.transitionTo("break_time");
      } else {
        this.transitionTo("gentle_nudge");
      }
    }
  }

  /**
   * Triggered when Pomodoro study countdown hits 0.
   */
  private handlePomodoroWorkComplete(nowMs: number): void {
    const suggestion: BreakSuggestion = {
      id: `pomodoro_${nowMs}`,
      type: "pomodoro",
      title: "Pomodoro Complete!",
      message: "Great work! Time for a 5-minute break to recharge.",
      suggested_duration_s: this.config.break_duration_s,
      choices: [
        { label: "Start 5m break", action: "accept" },
        { label: "Keep studying (I'm fine)", action: "dismiss" },
      ],
      created_at: nowMs,
    };

    if (this.signals.quiz_active) {
      this.queuedSuggestion = suggestion;
    } else {
      this.activeSuggestion = suggestion;
      this.startBreak(this.config.break_duration_s, "pomodoro");
    }
  }

  /**
   * Triggered when Pomodoro break countdown hits 0.
   */
  private handlePomodoroBreakComplete(): void {
    this.pomodoroCompletedCount += 1;
    this.pomodoroPhase = "work";
    this.pomodoroTimeRemainingS = this.config.work_duration_s;
    this.transitionTo("welcome_back");
  }

  /**
   * Enters the break phase and resets work timer.
   */
  public startBreak(durationS?: number, _breakType: BreakType = "user_initiated"): void {
    const breakDur = durationS ?? this.config.break_duration_s;
    this.pomodoroPhase = "break";
    this.pomodoroTimeRemainingS = breakDur;
    this.nudgeStep = 0;
    this.transitionTo("break_time");
  }

  /**
   * Ends current break early and resumes studying.
   */
  public endBreak(): void {
    this.pomodoroPhase = "work";
    this.pomodoroTimeRemainingS = this.config.work_duration_s;
    this.activeSuggestion = null;
    this.nudgeStep = 0;
    this.transitionTo("welcome_back");
  }

  /**
   * User-initiated break. Always works immediately per README 11.4.
   */
  public requestBreak(nowMs: number = Date.now(), customDurationS?: number): BuddyEngineSnapshot {
    this.startBreak(customDurationS, "user_initiated");
    return this.getSnapshot(nowMs);
  }

  /**
   * Handles user response to an active break suggestion.
   * Modifies cooldown adaptively via plain arithmetic per README 11.4.
   */
  public respondToSuggestion(
    action: "accept" | "dismiss" | "switch_topic" | "easier_task" | "flashcards",
    nowMs: number = Date.now()
  ): BuddyEngineSnapshot {
    const suggestion = this.activeSuggestion;
    this.activeSuggestion = null;
    this.nudgeStep = 0;

    if (!suggestion) {
      return this.getSnapshot(nowMs);
    }

    if (action === "accept" || action === "flashcards") {
      this.recordBreakOutcome("accepted", suggestion.type, nowMs);
      // Adaptive: Accepting keeps or slightly lowers cooldown toward baseline
      this.currentCooldownS = Math.max(
        this.config.base_cooldown_s,
        Math.round(this.currentCooldownS * 0.9)
      );
      if (action === "accept") {
        this.startBreak(suggestion.suggested_duration_s, suggestion.type);
      } else {
        this.transitionTo("studying");
      }
    } else {
      this.recordBreakOutcome("dismissed", suggestion.type, nowMs);
      // Adaptive: Dismissals increase threshold and lengthen cooldown by 20% (capped at 30m)
      this.currentCooldownS = Math.min(
        1800, // 30 minutes cap
        Math.round(this.currentCooldownS * 1.2)
      );
      this.transitionTo("studying");
    }

    return this.getSnapshot(nowMs);
  }

  /**
   * Processes quiz events (streaks, misses, question completion).
   */
  public handleQuizEvent(event: QuizEvent, nowMs: number = Date.now()): BuddyEngineSnapshot {
    if (event.type === "question_started") {
      this.signals.quiz_active = true;
    } else if (event.type === "answer_submitted") {
      this.signals.quiz_active = false;
      this.signals.last_interaction_time = nowMs;

      // Deliver queued break suggestion if one was deferred during active question
      if (this.queuedSuggestion) {
        this.activeSuggestion = this.queuedSuggestion;
        this.queuedSuggestion = null;
        if (this.activeSuggestion.type === "pomodoro") {
          this.startBreak(this.activeSuggestion.suggested_duration_s, "pomodoro");
        } else {
          this.transitionTo("gentle_nudge");
        }
      }
    } else if (event.type === "miss") {
      this.recentMissCount += 1;
      this.recentStreakCount = 0;
      this.signals.last_interaction_time = nowMs;

      // Two misses in a row trigger supportive pause recommendation and offer flashcard review
      if (this.recentMissCount >= 2 && !this.activeSuggestion && !this.signals.quiz_active) {
        this.activeSuggestion = {
          id: `frustration_${nowMs}`,
          type: "frustration_pause",
          title: "Review with Flashcards?",
          message: "Tricky questions! Would you like to review flashcards for this topic or take a breather?",
          suggested_duration_s: 180,
          choices: [
            { label: "Review flashcards", action: "flashcards" },
            { label: "Short breather", action: "accept" },
            { label: "I'm fine", action: "dismiss" },
          ],
          created_at: nowMs,
        };
        this.transitionTo("gentle_nudge");
      }
    } else if (event.type === "streak" || event.type === "mastery_gain") {
      this.recentStreakCount = event.streak_count ?? (this.recentStreakCount + 1);
      this.recentMissCount = 0;
      this.signals.last_interaction_time = nowMs;

      // Celebrate streak or mastery
      this.celebrateUntil = nowMs + 4000; // 4s celebration
      this.transitionTo("celebrate");
    }

    return this.getSnapshot(nowMs);
  }

  /**
   * Updates environmental signals (tab visibility, mouse/keyboard input, camera scores).
   */
  public updateSignals(updates: Partial<BuddySignals>, nowMs: number = Date.now()): void {
    if (updates.input_active) {
      updates.last_interaction_time = nowMs;
    }
    this.signals = { ...this.signals, ...updates };
  }

  private recordBreakOutcome(outcome: BreakOutcome, type: BreakType, timestamp: number): void {
    this.breakHistory.push({
      id: `break_${timestamp}`,
      type,
      outcome,
      timestamp,
      cooldown_at_time_s: this.currentCooldownS,
    });
  }

  private transitionTo(newState: BuddyState): void {
    if (this.state !== newState) {
      this.previousState = this.state;
      this.state = newState;
    }
  }

  private isNudgeState(state: BuddyState): boolean {
    return state === "curious_check" || state === "gentle_nudge" || state === "tired_check";
  }

  /**
   * Produces an immutable snapshot of current engine state for React UI or tests.
   */
  public getSnapshot(nowMs: number = Date.now()): BuddyEngineSnapshot {
    const quietRemainingS = Math.max(0, Math.round((this.quietPeriodUntil - nowMs) / 1000));
    const focusAvg =
      this.totalStudyTicks > 0
        ? Math.round((this.totalFocusSum / this.totalStudyTicks) / 100 * 100) / 100
        : 0.85;

    return {
      state: this.state,
      previous_state: this.previousState,
      nudge_step: this.nudgeStep,
      pomodoro_phase: this.pomodoroPhase,
      pomodoro_time_remaining_s: Math.round(this.pomodoroTimeRemainingS),
      pomodoro_completed_count: this.pomodoroCompletedCount,
      session_elapsed_s: Math.round(this.sessionElapsedS),
      active_suggestion: this.activeSuggestion,
      queued_suggestion: this.queuedSuggestion,
      current_cooldown_s: this.currentCooldownS,
      in_quiet_period: quietRemainingS > 0,
      quiet_period_remaining_s: quietRemainingS,
      recent_miss_count: this.recentMissCount,
      recent_streak_count: this.recentStreakCount,
      drowsiness_score: this.drowsinessScore,
      attention_score: this.attentionScore,
      focus_avg: focusAvg,
      drowsy_minutes: Math.round((this.drowsySeconds / 60) * 10) / 10,
      quality_gate_passed: this.qualityGateDecision.passed,
      quality_gate_message: this.qualityGateDecision.quietMessage,
      study_mode: this.studyMode,
      sensitivity: this.sensitivity,
    };
  }
}
