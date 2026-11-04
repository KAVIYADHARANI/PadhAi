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
        .catch(() => {
          // Fall back to default settings
        });
    }

    if (courseId && typeof api?.startStudySession === "function") {
      api.startStudySession(courseId)
        .then((session) => {
          if (mounted && session?.id) {
            setCurrentSessionId(session.id);
          }
        })
        .catch(() => {
          // Ignore offline/session errors
        });
    }

    return () => {
      mounted = false;
    };
  }, [courseId]);

  // Sync external quiz events (e.g. from quiz tab)
  useEffect(() => {
    if (lastQuizEvent) {
      sendQuizEvent(lastQuizEvent);
    }
  }, [lastQuizEvent, sendQuizEvent]);

  // Update speech bubble when state or suggestions change
  useEffect(() => {
    let line = "";
    if (snapshot.state === "celebrate") {
      line = getBuddyLine("quiz_streak", "hype", addressTerm);
    } else if (snapshot.state === "break_time") {
      line = getBuddyLine("break_prompt", "friendly_checkin", addressTerm);
    } else if (snapshot.active_suggestion) {
      line = snapshot.active_suggestion.message;
    } else if (snapshot.state === "gentle_nudge") {
      line = `Need a minute? I'm right here with you, ${addressTerm}.`;
    }

    if (line) {
      setDialogueLine(line);
      setIsTalking(true);
      const timer = setTimeout(() => setIsTalking(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [snapshot.state, snapshot.active_suggestion, addressTerm]);

  // Handle Mascot Tap / Poke -> Opens companion chat & plays reaction
  const handleMascotTap = () => {
    setIsCompanionChatOpen(true);
    const randomTriggers = ["long_unbroken_study", "struggling_topic", "quiz_streak", "break_prompt"];
    const trigger = randomTriggers[Math.floor(Math.random() * randomTriggers.length)];
    const tone = personaMode === "serious" ? "patient" : "friendly_checkin";
    const line = getBuddyLine(trigger, tone, addressTerm);
    setDialogueLine(line);
    setIsTalking(true);
    setTimeout(() => setIsTalking(false), 4500);
  };

  // Format MM:SS for Pomodoro counter
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSaveSettings = async () => {
    try {
      await api.updateBuddySettings({
        address_term: addressTerm,
        tone_mode: personaMode,
      });
    } catch {
      // Ignore network errors in local dev
    }
    setShowSettings(false);
  };

  const handleBreakAction = (action: BreakChoice["action"]) => {
    respondToSuggestion(action);
    if (action === "flashcards" && onNavigateToFlashcards) {
      onNavigateToFlashcards();
    }
    if (currentSessionId) {
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
          className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-slate-900/95 border border-slate-750 shadow-2xl backdrop-blur-xl cursor-pointer hover:border-brand-500/50 transition group"
          title={`Expand ${MASCOT_NAME} companion`}
        >
          <div className="w-7 h-7 rounded-lg bg-brand-500/20 text-brand-400 flex items-center justify-center relative shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
            <span
              className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                snapshot.pomodoro_phase === "break"
                  ? "bg-amber-400 animate-pulse"
                  : snapshot.state === "celebrate"
                  ? "bg-emerald-400"
                  : "bg-brand-400"
              }`}
            />
          </div>
          <div className="text-left leading-tight pr-1">
            <p className="font-bold text-white text-[11px] truncate">{MASCOT_NAME}</p>
            <p className="text-[10px] text-slate-400 truncate">
              {snapshot.pomodoro_phase === "break" ? "Break" : "Study"}: {formatTime(snapshot.pomodoro_time_remaining_s)}
            </p>
          </div>
          <button
            type="button"
            className="p-1 text-slate-400 group-hover:text-white transition shrink-0"
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
              className="absolute -top-2.5 -right-2.5 p-1 rounded-full bg-slate-800 border border-slate-750 text-slate-400 hover:text-white shadow-md z-10 transition"
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
              <div className="relative bg-slate-900 border border-brand-500/40 hover:border-brand-500/70 text-slate-100 text-xs px-3.5 py-2.5 rounded-2xl shadow-xl shadow-brand-950/40 backdrop-blur-md flex items-start gap-2 transition">
                <div className="flex-1 min-w-0">
                  <p className="font-medium leading-relaxed">
                    {activeReminder ? activeReminder.message : dialogueLine}
                  </p>
                  <p className="text-[10px] text-brand-400 font-semibold mt-1 flex items-center gap-1 group-hover:underline">
                    <MessageSquare className="w-2.5 h-2.5" />
                    <span>Click to reply</span>
                  </p>
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
                  className="p-1 text-slate-400 hover:text-white shrink-0 -mr-1 -mt-1"
                  title="Dismiss message"
                  aria-label="Dismiss message"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                {/* Bubble arrow pointer */}
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900 border-b border-r border-brand-500/40 rotate-45" />
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
          <div className="mt-1 flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-3 py-1 rounded-full shadow-md text-xs backdrop-blur-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                snapshot.pomodoro_phase === "break"
                  ? "bg-amber-400 animate-pulse"
                  : snapshot.state === "celebrate"
                  ? "bg-emerald-400"
                  : "bg-brand-400"
              }`}
            />
            <span className="font-semibold text-slate-200">
              {snapshot.pomodoro_phase === "break" ? "Break" : "Study"}: {formatTime(snapshot.pomodoro_time_remaining_s)}
            </span>
            <button
              type="button"
              onClick={() => {
                const nextMuted = !isMuted;
                setIsMuted(nextMuted);
                speechService.setMuted(nextMuted);
              }}
              className="ml-1 p-0.5 text-slate-400 hover:text-white transition-colors"
              title={isMuted ? "Unmute spoken reminders" : "Mute spoken reminders"}
            >
              {isMuted ? (
                <VolumeX className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>
            <button
              onClick={() => setShowQuickMenu(!showQuickMenu)}
              className="p-0.5 text-slate-400 hover:text-white transition-colors"
              title="Companion menu"
            >
              <Sparkles className="w-3.5 h-3.5 text-brand-400" />
            </button>
          </div>

          {/* Focus & Drowsiness Sensor Monitor */}
          <div className="mt-2">
            <CameraMonitor />
          </div>
        </>
      )}

      {/* Quick-Action Popup Menu */}
      {showQuickMenu && (
        <div className="absolute bottom-12 right-0 z-30 w-48 bg-slate-900 border border-slate-750 rounded-xl shadow-2xl p-1.5 space-y-0.5 text-xs text-slate-200 animate-in fade-in zoom-in-95">
          <div className="px-2.5 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
            {MASCOT_NAME} Actions
          </div>
          <button
            onClick={() => {
              setShowQuickMenu(false);
              setIsCompanionChatOpen(true);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 flex items-center gap-2 transition-colors font-semibold text-brand-300"
          >
            <MessageSquare className="w-3.5 h-3.5 text-brand-400" />
            <span>Chat with {MASCOT_NAME}</span>
          </button>
          <button
            onClick={() => {
              setShowQuickMenu(false);
              handleMascotTap();
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 flex items-center gap-2 transition-colors"
          >
            <Volume2 className="w-3.5 h-3.5 text-brand-400" />
            <span>Chatter with me</span>
          </button>
          <button
            onClick={() => {
              setShowQuickMenu(false);
              requestBreak();
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 flex items-center gap-2 transition-colors"
          >
            <Coffee className="w-3.5 h-3.5 text-amber-400" />
            <span>Take 5m break</span>
          </button>
          {onNavigateToQuiz && (
            <button
              onClick={() => {
                setShowQuickMenu(false);
                onNavigateToQuiz();
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 flex items-center gap-2 transition-colors"
            >
              <Play className="w-3.5 h-3.5 text-emerald-400" />
              <span>Quiz me now</span>
            </button>
          )}
          {onNavigateToChat && (
            <button
              onClick={() => {
                setShowQuickMenu(false);
                onNavigateToChat();
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 flex items-center gap-2 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
              <span>Ask course tutor</span>
            </button>
          )}
          {onNavigateToFlashcards && (
            <button
              onClick={() => {
                setShowQuickMenu(false);
                onNavigateToFlashcards();
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 flex items-center gap-2 transition-colors"
            >
              <Layers className="w-3.5 h-3.5 text-brand-400" />
              <span>Review flashcards</span>
            </button>
          )}
          <button
            onClick={() => {
              setShowQuickMenu(false);
              setShowSettings(true);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 flex items-center gap-2 transition-colors border-t border-slate-800 mt-1"
          >
            <Settings className="w-3.5 h-3.5 text-slate-400" />
            <span>Companion settings</span>
          </button>
        </div>
      )}

      {/* Break Time Banner / Active Suggestion Modal */}
      {snapshot.active_suggestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-brand-500/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-brand-500/10 text-brand-400 rounded-xl">
                <Coffee className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-slate-100 text-sm">
                  {snapshot.active_suggestion.title}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {snapshot.active_suggestion.message}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-800">
              {snapshot.active_suggestion.choices.map((choice: BreakChoice, idx: number) => (
                <button
                  key={idx}
                  onClick={() => handleBreakAction(choice.action)}
                  className={`w-full py-2 px-3 text-xs font-medium rounded-xl transition-colors flex items-center justify-center gap-2 ${
                    choice.action === "accept"
                      ? "bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-600/30"
                      : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                  }`}
                >
                  {choice.action === "accept" && <Play className="w-3.5 h-3.5" />}
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
            className="text-[11px] text-amber-400 hover:text-amber-300 underline font-medium"
          >
            End break early
          </button>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-100 font-semibold text-sm">
                <Settings className="w-4 h-4 text-brand-400" />
                <span>Companion Preferences</span>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs text-slate-300">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  How should {MASCOT_NAME} address you?
                </label>
                <input
                  type="text"
                  value={addressTerm}
                  onChange={(e) => setAddressTerm(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-brand-500"
                  placeholder="e.g. boss, friend, champ"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Persona Style & Tone
                </label>
                <select
                  value={personaMode}
                  onChange={(e) => setPersonaMode(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-brand-500"
                >
                  <option value="balanced">Balanced (Friendly Tanglish)</option>
                  <option value="full">Full (Energetic Tanglish)</option>
                  <option value="serious">Serious (Direct & Focused)</option>
                  <option value="english_only">English Only</option>
                </select>
              </div>

              <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-850 text-[11px] text-slate-400 flex items-start gap-2">
                <HelpCircle className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
                <span>
                  Camera-based facial fatigue detection is disabled by default for privacy. All break rules run locally on browser input activity.
                </span>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-800">
              <button
                onClick={() => setShowSettings(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-4 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                Save Preferences
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Companion Conversation Panel */}
      {isCompanionChatOpen && (
        <div className="fixed inset-0 sm:inset-auto sm:bottom-4 sm:right-4 md:bottom-6 md:right-6 z-50 flex items-end sm:items-center justify-end p-2 sm:p-0 bg-slate-950/60 sm:bg-transparent backdrop-blur-sm sm:backdrop-blur-none animate-in fade-in">
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
