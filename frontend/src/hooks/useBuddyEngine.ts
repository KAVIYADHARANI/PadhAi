/**
 * React hook connecting DOM events, visibility, and timers to the pure BuddyEngine.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { BuddyEngine, DEFAULT_CONFIG } from "../buddy/engine";
import {
  BuddyEngineConfig,
  BuddyEngineSnapshot,
  BuddySignals,
  QuizEvent,
} from "../buddy/types";

export interface UseBuddyEngineOptions {
  config?: Partial<BuddyEngineConfig>;
  enabled?: boolean;
}

export function useBuddyEngine(options: UseBuddyEngineOptions = {}) {
  const { config, enabled = true } = options;
  const engineRef = useRef<BuddyEngine>(new BuddyEngine(Date.now(), config));

  const [snapshot, setSnapshot] = useState<BuddyEngineSnapshot>(() =>
    engineRef.current.getSnapshot()
  );

  // 1. Periodic tick loop (1 Hz)
  useEffect(() => {
    if (!enabled) return;

    const intervalId = setInterval(() => {
      const updated = engineRef.current.tick(Date.now());
      setSnapshot(updated);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [enabled]);

  // 2. DOM activity listeners (visibility, mouse, keyboard)
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === "visible";
      const updated = engineRef.current.tick(Date.now(), { tab_visible: isVisible });
      setSnapshot(updated);
    };

    let lastInteractionTime = Date.now();
    const handleUserInteraction = () => {
      const now = Date.now();
      // Throttle interaction updates to once every 2 seconds
      if (now - lastInteractionTime > 2000) {
        lastInteractionTime = now;
        const updated = engineRef.current.tick(now, {
          input_active: true,
          last_interaction_time: now,
        });
        setSnapshot(updated);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("mousemove", handleUserInteraction);
    window.addEventListener("keydown", handleUserInteraction);
    window.addEventListener("click", handleUserInteraction);
    window.addEventListener("scroll", handleUserInteraction);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("mousemove", handleUserInteraction);
      window.removeEventListener("keydown", handleUserInteraction);
      window.removeEventListener("click", handleUserInteraction);
      window.removeEventListener("scroll", handleUserInteraction);
    };
  }, [enabled]);

  // Actions
  const respondToSuggestion = useCallback(
    (action: "accept" | "dismiss" | "switch_topic" | "easier_task") => {
      const updated = engineRef.current.respondToSuggestion(action, Date.now());
      setSnapshot(updated);
    },
    []
  );

  const requestBreak = useCallback((customDurationS?: number) => {
    const updated = engineRef.current.requestBreak(Date.now(), customDurationS);
    setSnapshot(updated);
  }, []);

  const endBreak = useCallback(() => {
    engineRef.current.endBreak();
    setSnapshot(engineRef.current.getSnapshot());
  }, []);

  const sendQuizEvent = useCallback((event: QuizEvent) => {
    const updated = engineRef.current.handleQuizEvent(event, Date.now());
    setSnapshot(updated);
  }, []);

  const updateSignals = useCallback((signals: Partial<BuddySignals>) => {
    engineRef.current.updateSignals(signals, Date.now());
    setSnapshot(engineRef.current.getSnapshot());
  }, []);

  return {
    snapshot,
    respondToSuggestion,
    requestBreak,
    endBreak,
    sendQuizEvent,
    updateSignals,
    config: { ...DEFAULT_CONFIG, ...config },
  };
}
