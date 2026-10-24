/**
 * Types and interfaces for the Study Buddy engine.
 * Defined strictly per README Sections 11.1, 11.3, and 11.4.
 */

export type BuddyState =
  | "idle"
  | "ready"
  | "studying"
  | "deep_focus"
  | "curious_check"
  | "gentle_nudge"
  | "tired_check"
  | "break_time"
  | "welcome_back"
  | "celebrate"
  | "sleepy"
  | "rest"
  | "away";

export type NudgeStep = 0 | 1 | 2 | 3;

export type BreakType =
  | "pomodoro"
  | "drowsy_stretch"
  | "eye_rest"
  | "topic_switch"
  | "frustration_pause"
  | "user_initiated";

export type BreakOutcome = "accepted" | "dismissed" | "ignored";

export interface BreakChoice {
  label: string;
  action: "accept" | "dismiss" | "switch_topic" | "easier_task";
}

export interface BreakSuggestion {
  id: string;
  type: BreakType;
  title: string;
  message: string;
  suggested_duration_s: number;
  choices: BreakChoice[];
  created_at: number;
}

export interface BuddySignals {
  tab_visible: boolean;
  input_active: boolean;
  last_interaction_time: number;
  quiz_active: boolean;
  drowsiness_score?: number; // 0 to 100
  attention_score?: number; // 0 to 100
}

export type QuizEventType =
  | "question_started"
  | "answer_submitted"
  | "miss"
  | "streak"
  | "mastery_gain";

export interface QuizEvent {
  type: QuizEventType;
  streak_count?: number;
  miss_count?: number;
  topic_name?: string;
  timestamp: number;
}

export interface BuddyEngineConfig {
  work_duration_s: number; // default 25 * 60 (1500)
  break_duration_s: number; // default 5 * 60 (300)
  base_cooldown_s: number; // default 15 * 60 (900)
  quiet_period_s: number; // default 15 * 60 (900)
  step1_threshold_s: number; // default 45 s
  step2_threshold_s: number; // default 120 s (2 min)
  step3_threshold_s: number; // default 300 s (5 min)
}

export interface BreakEventRecord {
  id: string;
  type: BreakType;
  outcome: BreakOutcome;
  timestamp: number;
  cooldown_at_time_s: number;
}

export interface BuddyEngineSnapshot {
  state: BuddyState;
  previous_state: BuddyState;
  nudge_step: NudgeStep;
  pomodoro_phase: "work" | "break";
  pomodoro_time_remaining_s: number;
  pomodoro_completed_count: number;
  session_elapsed_s: number;
  active_suggestion: BreakSuggestion | null;
  queued_suggestion: BreakSuggestion | null;
  current_cooldown_s: number;
  in_quiet_period: boolean;
  quiet_period_remaining_s: number;
  recent_miss_count: number;
  recent_streak_count: number;
}
