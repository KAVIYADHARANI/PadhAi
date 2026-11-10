/**
 * Study Companion (Buddy) UI Component.
 * Integrates PlaceholderMascot, useBuddyEngine, approved line bank, quick actions, and settings.
 */

import React, { useEffect, useState } from "react";
import { MASCOT_NAME } from "../../brand";
import { getBuddyLine } from "../../buddy/lines";
import { ActiveReminder, reminderManager } from "../../buddy/reminderManager";
import { BreakChoice, QuizEvent } from "../../buddy/types";
import { useBuddyEngine } from "../../hooks/useBuddyEngine";
import { speechService } from "../../services/voice";
import { api } from "../../services/api";
import { RoadmapItem } from "../../types";
import { PlaceholderMascot } from "./PlaceholderMascot";
import { CameraMonitor } from "./CameraMonitor";
import { CompanionChat } from "./CompanionChat";

import {
  Coffee,
  HelpCircle,
  Layers,
  Maximize2,
  MessageSquare,
  Minimize2,
  Play,
  RotateCcw,
  Settings,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

export interface BuddyProps {
  courseId: number;
  currentLesson?: { item: RoadmapItem; taskId: string; lessonTitle?: string } | null;
  onNavigateToQuiz?: () => void;
  onNavigateToChat?: () => void;
  onNavigateToFlashcards?: () => void;
  lastQuizEvent?: QuizEvent | null;
  className?: string;
  isFloating?: boolean;
  defaultCollapsed?: boolean;
}

export const Buddy: React.FC<BuddyProps> = ({
  courseId,
  currentLesson,
  onNavigateToQuiz,
  onNavigateToChat,
  onNavigateToFlashcards,
  lastQuizEvent,
  className = "",
  isFloating = false,
  defaultCollapsed = false,
}) => {
  const {
    snapshot,
    respondToSuggestion,
    requestBreak,
    endBreak,
    sendQuizEvent,
  } = useBuddyEngine();

  // Settings & Interactive Companion State
  const [addressTerm, setAddressTerm] = useState("boss");
  const [personaMode, setPersonaMode] = useState<"full" | "balanced" | "serious" | "english_only">("balanced");
  const [showSettings, setShowSettings] = useState(false);
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [dialogueLine, setDialogueLine] = useState<string>("");
  const [isTalking, setIsTalking] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [activeReminder, setActiveReminder] = useState<ActiveReminder | null>(null);
  const [isMuted, setIsMuted] = useState(speechService.getMuted());
  const [isCompanionChatOpen, setIsCompanionChatOpen] = useState(false);

  // Subscribe to proactive reminders
  useEffect(() => {
    const unsub = reminderManager.subscribe((reminder) => {
      setActiveReminder(reminder);
      if (reminder) {
        setDialogueLine(reminder.message);
        setIsTalking(true);
      }
    });
    return () => unsub();
  }, []);

  // Load user settings and start session on mount
  useEffect(() => {
    let mounted = true;
    if (typeof api?.getBuddySettings === "function") {
      api.getBuddySettings()
        .then((res) => {
          if (!mounted || !res) return;
          if (res.address_term) setAddressTerm(res.address_term);
          if (res.tone_mode) {
            setPersonaMode(res.tone_mode as any);
          }
        })
        .catch(() => {});
    }

    if (typeof api?.startStudySession === "function") {
      api.startStudySession(courseId)
        .then((session) => {
          if (mounted && session?.id) {
            setCurrentSessionId(session.id);
          }
        })
        .catch(() => {});
    }

    return () => {
      mounted = false;
      speechService.cancel();
    };
  }, [courseId]);

  // Handle Quiz events passed into Buddy
  useEffect(() => {
    if (lastQuizEvent) {
      sendQuizEvent(lastQuizEvent);
      if (lastQuizEvent.type === "miss") {
        setDialogueLine(getBuddyLine("miss_topic", "serious", addressTerm));
        setIsTalking(true);
      } else if (lastQuizEvent.type === "streak") {
        setDialogueLine(getBuddyLine("quiz_streak", "hype", addressTerm));
        setIsTalking(true);
      }
    }
  }, [lastQuizEvent, addressTerm, sendQuizEvent]);

  // Handle mascot tap interaction
  const handleMascotTap = () => {
    setIsCompanionChatOpen(true);
    const tone = snapshot.pomodoro_phase === "break" ? "friendly_checkin" : "balanced";
    const line = getBuddyLine("welcome_ready", tone, addressTerm);
    setDialogueLine(line);
    setIsTalking(true);
    if (!isMuted) {
      speechService.speak(line);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleSaveSettings = () => {
    if (typeof api?.updateBuddySettings === "function") {
      api.updateBuddySettings({
        address_term: addressTerm,
        tone_mode: personaMode,
      }).catch(() => {});
    }
    setShowSettings(false);
  };

  const handleBreakAction = (action: BreakChoice["action"]) => {
    respondToSuggestion(action);
    if (action === "flashcards" && onNavigateToFlashcards) {
      onNavigateToFlashcards();
    }
    if (currentSessionId && typeof api?.recordBreakEvent === "function") {
      api.recordBreakEvent(currentSessionId, {
        break_type: "pomodoro_break",
        outcome: action === "accept" || action === "flashcards" ? "accepted" : "dismissed",
        cooldown_at_time_s: snapshot.current_cooldown_s,
      }).catch(() => {});
    }
  };

  return (
    <div className={`relative flex flex-col items-center select-none ${className}`}>
      {/* Collapsed Pill View when floating */}
      {isFloating && isCollapsed ? (
        <div
          onClick={() => setIsCollapsed(false)}
          className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-surface border border-line shadow-dropdown cursor-pointer hover:border-primary transition group"
          title={`Expand ${MASCOT_NAME} companion`}
        >
          <div className="w-7 h-7 rounded-lg bg-primary-light text-primary flex items-center justify-center relative shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
            <span
              className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                snapshot.pomodoro_phase === "break"
                  ? "bg-amber-400 animate-pulse"
                  : snapshot.state === "celebrate"
                  ? "bg-emerald-500"
                  : "bg-indigo-500"
              }`}
            />
          </div>
          <div className="text-left leading-tight pr-1">
            <p className="font-bold text-heading text-[11px] truncate">{MASCOT_NAME}</p>
            <p className="text-[10px] text-muted truncate">
              {snapshot.pomodoro_phase === "break" ? "Break" : "Study"}: {formatTime(snapshot.pomodoro_time_remaining_s)}
            </p>
          </div>
          <button
            type="button"
            className="p-1 text-muted group-hover:text-heading transition shrink-0"
            aria-label="Expand companion"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <>
          {/* Floating Minimize Button */}
          {isFloating && (
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="absolute -top-2.5 -right-2.5 p-1 rounded-full bg-surface border border-line text-muted hover:text-heading shadow-sm z-10 transition"
              title="Minimize companion"
              aria-label="Minimize companion"
            >
              <Minimize2 className="w-3 h-3" />
            </button>
          )}

          {/* Speech / Dialogue Bubble (Dismissible & Clickable to chat) */}
          {(dialogueLine || isTalking || activeReminder) && (
            <div
              onClick={() => setIsCompanionChatOpen(true)}
              className="absolute -top-20 z-20 max-w-xs animate-in fade-in slide-in-from-bottom-2 duration-300 cursor-pointer group"
              title={`Chat with ${MASCOT_NAME}`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setIsCompanionChatOpen(true);
              }}
            >
              <div className="relative bg-surface border border-primary/40 hover:border-primary text-heading text-xs px-3.5 py-2.5 rounded-2xl shadow-dropdown flex items-start gap-2 transition">
                <div className="flex-1">
                  <p className="leading-relaxed font-medium">{dialogueLine || "Ready to study!"}</p>
                  <p className="text-[10px] text-primary font-semibold mt-1">Click to reply</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDialogueLine("");
                    setIsTalking(false);
                    if (activeReminder) {
                      reminderManager.dismiss();
                    }
                  }}
                  className="p-1 text-muted hover:text-heading shrink-0 -mr-1 -mt-1"
                  title="Dismiss message"
                  aria-label="Dismiss message"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                {/* Bubble arrow pointer */}
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-surface border-b border-r border-primary/40 rotate-45" />
              </div>
            </div>
          )}

          {/* Main Interactive Mascot Visual */}
          <PlaceholderMascot
            state={snapshot.state}
            isTalking={isTalking}
            onTap={handleMascotTap}
            title={`Chat with ${MASCOT_NAME}`}
            ariaLabel={`Chat with ${MASCOT_NAME}`}
            className="w-28 h-28 sm:w-32 sm:h-32"
          />

          {/* Companion Control Badge */}
          <div className="mt-2 flex items-center gap-1.5 bg-subtle border border-line px-3.5 py-1.5 rounded-full shadow-sm text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                snapshot.pomodoro_phase === "break"
                  ? "bg-amber-500 animate-pulse"
                  : snapshot.state === "celebrate"
                  ? "bg-teal-500"
                  : "bg-indigo-500"
              }`}
            />
            <span className="font-semibold text-heading">
              {snapshot.pomodoro_phase === "break" ? "Break" : "Study"}: {formatTime(snapshot.pomodoro_time_remaining_s)}
            </span>
            <button
              type="button"
              onClick={() => {
                const nextMuted = !isMuted;
                setIsMuted(nextMuted);
                speechService.setMuted(nextMuted);
              }}
              className="ml-1 p-0.5 text-muted hover:text-heading transition-colors"
              title={isMuted ? "Unmute spoken reminders" : "Mute spoken reminders"}
            >
              {isMuted ? (
                <VolumeX className="w-3.5 h-3.5 text-warning" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-muted" />
              )}
            </button>
            <button
              onClick={() => setShowQuickMenu(!showQuickMenu)}
              className="p-0.5 text-muted hover:text-primary transition-colors"
              title="Companion menu"
            >
              <Sparkles className="w-3.5 h-3.5 text-primary" />
            </button>
          </div>

          {/* Focus & Drowsiness Sensor Monitor */}
          <div className="mt-2.5 w-full">
            <CameraMonitor />
          </div>
        </>
      )}

      {/* Quick-Action Popup Menu */}
      {showQuickMenu && (
        <div className="absolute bottom-12 right-0 z-30 w-52 bg-surface border border-line rounded-xl shadow-dropdown p-1.5 space-y-0.5 text-xs text-body animate-in fade-in zoom-in-95">
          <div className="px-2.5 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider border-b border-line">
            {MASCOT_NAME} Actions
          </div>
          <button
            onClick={() => {
              setShowQuickMenu(false);
              setIsCompanionChatOpen(true);
            }}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-primary-light flex items-center gap-2 transition-colors font-semibold text-primary"
          >
            <MessageSquare className="w-3.5 h-3.5 text-primary" />
            <span>Chat with {MASCOT_NAME}</span>
          </button>
          <button
            onClick={() => {
              setShowQuickMenu(false);
              handleMascotTap();
            }}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-subtle flex items-center gap-2 transition-colors text-body"
          >
            <Volume2 className="w-3.5 h-3.5 text-primary" />
            <span>Chatter with me</span>
          </button>
          <button
            onClick={() => {
              setShowQuickMenu(false);
              requestBreak();
            }}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-warning-light flex items-center gap-2 transition-colors text-warning"
          >
            <Coffee className="w-3.5 h-3.5 text-warning" />
            <span>Take 5m break</span>
          </button>
          {onNavigateToQuiz && (
            <button
              onClick={() => {
                setShowQuickMenu(false);
                onNavigateToQuiz();
              }}
              className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-accent-light flex items-center gap-2 transition-colors text-accent"
            >
              <Play className="w-3.5 h-3.5 text-accent" />
              <span>Quiz me now</span>
            </button>
          )}
          {onNavigateToChat && (
            <button
              onClick={() => {
                setShowQuickMenu(false);
                onNavigateToChat();
              }}
              className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-subtle flex items-center gap-2 transition-colors text-body"
            >
              <MessageSquare className="w-3.5 h-3.5 text-primary" />
              <span>Ask course tutor</span>
            </button>
          )}
          {onNavigateToFlashcards && (
            <button
              onClick={() => {
                setShowQuickMenu(false);
                onNavigateToFlashcards();
              }}
              className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-primary-light flex items-center gap-2 transition-colors text-primary"
            >
              <Layers className="w-3.5 h-3.5 text-primary" />
              <span>Review flashcards</span>
            </button>
          )}
          <button
            onClick={() => {
              setShowQuickMenu(false);
              setShowSettings(true);
            }}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-subtle flex items-center gap-2 transition-colors border-t border-line text-muted mt-1"
          >
            <Settings className="w-3.5 h-3.5 text-muted" />
            <span>Companion settings</span>
          </button>
        </div>
      )}

      {/* Break Time Banner / Active Suggestion Modal */}
      {snapshot.active_suggestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full shadow-dropdown space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-primary-light text-primary rounded-xl shrink-0">
                <Coffee className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-heading text-sm">
                  {snapshot.active_suggestion.title || "Review with Flashcards?"}
                </h3>
                <p className="text-xs text-body leading-relaxed">
                  {snapshot.active_suggestion.message}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-line">
              {snapshot.active_suggestion.choices.map((choice: BreakChoice, idx: number) => (
                <button
                  key={idx}
                  onClick={() => handleBreakAction(choice.action)}
                  className={`w-full py-2.5 px-3 text-xs font-semibold rounded-btn transition-colors flex items-center justify-center gap-2 ${
                    choice.action === "accept" || choice.action === "flashcards"
                      ? "bg-primary hover:bg-primary-hover text-white shadow-sm"
                      : "bg-subtle hover:bg-codeblock text-body border border-line"
                  }`}
                >
                  {(choice.action === "accept" || choice.action === "flashcards") && <Play className="w-3.5 h-3.5" />}
                  {choice.action === "dismiss" && <RotateCcw className="w-3.5 h-3.5" />}
                  <span>{choice.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* In-Break Active View */}
      {snapshot.pomodoro_phase === "break" && !snapshot.active_suggestion && (
        <div className="mt-2 text-center">
          <button
            onClick={() => endBreak()}
            className="text-[11px] text-warning hover:underline font-semibold"
          >
            End break early
          </button>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full shadow-dropdown space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2 text-heading font-semibold text-sm">
                <Settings className="w-4 h-4 text-primary" />
                <span>Companion Preferences</span>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-muted hover:text-heading"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs text-body">
              <div>
                <label className="block text-[11px] font-semibold text-heading mb-1">
                  How should {MASCOT_NAME} address you?
                </label>
                <input
                  type="text"
                  value={addressTerm}
                  onChange={(e) => setAddressTerm(e.target.value)}
                  className="w-full bg-subtle border border-line rounded-btn px-3 py-2 text-heading text-xs focus:outline-none focus:border-primary focus:bg-surface"
                  placeholder="e.g. boss, friend, champ"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-heading mb-1">
                  Persona Style & Tone
                </label>
                <select
                  value={personaMode}
                  onChange={(e) => setPersonaMode(e.target.value as any)}
                  className="w-full bg-subtle border border-line rounded-btn px-3 py-2 text-heading text-xs focus:outline-none focus:border-primary focus:bg-surface"
                >
                  <option value="balanced">Balanced (Friendly Tanglish)</option>
                  <option value="full">Full (Energetic Tanglish)</option>
                  <option value="serious">Serious (Direct & Focused)</option>
                  <option value="english_only">English Only</option>
                </select>
              </div>

              <div className="p-3 bg-subtle rounded-xl border border-line text-[11px] text-muted flex items-start gap-2">
                <HelpCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>
                  Camera-based facial fatigue detection is disabled by default for privacy. All study timer rules run locally on browser activity.
                </span>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-line">
              <button
                onClick={() => setShowSettings(false)}
                className="px-3 py-1.5 text-xs text-muted hover:text-heading font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-btn text-xs font-semibold shadow-sm transition-colors"
              >
                Save Preferences
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Companion Conversation Panel */}
      {isCompanionChatOpen && (
        <div className="fixed inset-0 sm:inset-auto sm:bottom-6 sm:right-6 z-50 flex items-end sm:items-center justify-end p-0 bg-slate-950/60 sm:bg-transparent backdrop-blur-sm sm:backdrop-blur-none animate-in fade-in">
          <CompanionChat
            courseId={courseId}
            currentLesson={currentLesson}
            activeReminder={activeReminder}
            onClose={() => setIsCompanionChatOpen(false)}
            onMinimize={() => setIsCompanionChatOpen(false)}
            onRequestBreak={() => {
              requestBreak();
            }}
            onNavigateToQuiz={onNavigateToQuiz}
            onNavigateToFlashcards={onNavigateToFlashcards}
          />
        </div>
      )}
    </div>
  );
};
