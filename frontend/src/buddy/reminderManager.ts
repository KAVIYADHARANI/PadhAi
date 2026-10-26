/**
 * Proactive Reminder Manager for Study Buddy v2.
 *
 * Implements:
 * 1. Connects focus events (sustained look-away, drowsiness) to visual mascot dialogue
 *    and optional spoken voice reminders.
 * 2. Strict user opt-in: proactive voice reminders are OFF by default and require explicit consent.
 * 3. Quiet mode toggle and adjustable cooldown (default 60s).
 * 4. Non-interruptive: never interrupts active speech or active video playback.
 * 5. Deterministic supportive wording (never claims to diagnose medical or psychological states).
 * 6. Visual fallback: visual mascot reminder bubble is always displayed regardless of voice capability.
 */

import { speechService } from "../services/voice";
import { FocusEvent, focusEvaluator } from "./focusEvaluator";

export interface ActiveReminder {
  id: string;
  type: "look_away" | "drowsiness";
  message: string;
  spokenText: string;
  timestamp: number;
}

export type ReminderListener = (reminder: ActiveReminder | null) => void;

export class ReminderManager {
  private activeReminder: ActiveReminder | null = null;
  private proactiveVoiceEnabled = false;
  private quietMode = false;
  private listeners: Set<ReminderListener> = new Set();
  private unsubFocus: (() => void) | null = null;

  private lookAwayPhrases = [
    "Hey, shall we get back to this topic?",
    "Ready to continue learning?",
    "Whenever you're ready, let's keep going!",
  ];

  private drowsinessPhrases = [
    "Take a quick break if you're feeling tired.",
    "Would you like to stretch for a couple of minutes?",
    "A short break might help recharge your focus.",
  ];

  constructor() {
    this.init();
  }

  private init(): void {
    // Load persisted preferences if in browser
    if (typeof window !== "undefined") {
      try {
        const savedVoice = localStorage.getItem("padhai_proactive_voice");
        if (savedVoice !== null) {
          this.proactiveVoiceEnabled = savedVoice === "true";
        }
        const savedQuiet = localStorage.getItem("padhai_quiet_mode");
        if (savedQuiet !== null) {
          this.quietMode = savedQuiet === "true";
        }
      } catch {
        // ignore storage restrictions
      }
    }

    this.unsubFocus = focusEvaluator.subscribe((event) => this.handleFocusEvent(event));
  }

  public getActiveReminder(): ActiveReminder | null {
    return this.activeReminder;
  }

  public isProactiveVoiceEnabled(): boolean {
    return this.proactiveVoiceEnabled;
  }

  public setProactiveVoiceEnabled(enabled: boolean): void {
    this.proactiveVoiceEnabled = enabled;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("padhai_proactive_voice", String(enabled));
      } catch {}
    }
  }

  public isQuietMode(): boolean {
    return this.quietMode;
  }

  public setQuietMode(quiet: boolean): void {
    this.quietMode = quiet;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("padhai_quiet_mode", String(quiet));
      } catch {}
    }
    if (quiet) {
      speechService.cancel();
    }
  }

  public subscribe(listener: ReminderListener): () => void {
    this.listeners.add(listener);
    listener(this.activeReminder);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l(this.activeReminder));
  }

  public dismiss(): void {
    this.activeReminder = null;
    speechService.cancel();
    this.notify();
  }

  public handleFocusEvent(event: FocusEvent): void {
    if (event.type === "focus_restored" || event.type === "state_changed") {
      // Clear reminder when focus is naturally restored
      if (this.activeReminder && event.state === "focused") {
        this.activeReminder = null;
        this.notify();
      }
      return;
    }

    if (event.type === "sustained_look_away") {
      const phrase = this.lookAwayPhrases[Math.floor(Math.random() * this.lookAwayPhrases.length)];
      const reminder: ActiveReminder = {
        id: `look_away_${event.timestamp}`,
        type: "look_away",
        message: phrase,
        spokenText: phrase,
        timestamp: event.timestamp,
      };

      this.activeReminder = reminder;
      this.notify();

      // Trigger optional voice if enabled and not quiet
      if (this.proactiveVoiceEnabled && !this.quietMode && !speechService.isSpeaking()) {
        speechService.speak(reminder.spokenText);
      }
    } else if (event.type === "possible_drowsiness") {
      const phrase =
        this.drowsinessPhrases[Math.floor(Math.random() * this.drowsinessPhrases.length)];
      const reminder: ActiveReminder = {
        id: `drowsy_${event.timestamp}`,
        type: "drowsiness",
        message: phrase,
        spokenText: phrase,
        timestamp: event.timestamp,
      };

      this.activeReminder = reminder;
      this.notify();

      if (this.proactiveVoiceEnabled && !this.quietMode && !speechService.isSpeaking()) {
        speechService.speak(reminder.spokenText);
      }
    }
  }

  public destroy(): void {
    if (this.unsubFocus) {
      this.unsubFocus();
      this.unsubFocus = null;
    }
    this.listeners.clear();
  }
}

export const reminderManager = new ReminderManager();
