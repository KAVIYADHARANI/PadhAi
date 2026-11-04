import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Coffee,
  HelpCircle,
  Mic,
  MicOff,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { MASCOT_NAME } from "../../brand";
import { ActiveReminder, reminderManager } from "../../buddy/reminderManager";
import { api, ApiError } from "../../services/api";
import { speechService, useSpeechRecognition } from "../../services/voice";
import { ChatMessage, RoadmapItem, SourceReference } from "../../types";
import { PlaceholderMascot } from "./PlaceholderMascot";

export interface CompanionChatProps {
  courseId: number;
  currentLesson?: { item: RoadmapItem; taskId: string; lessonTitle?: string } | null;
  activeReminder?: ActiveReminder | null;
  onClose: () => void;
  onMinimize: () => void;
  onRequestBreak: () => void;
  onNavigateToQuiz?: () => void;
  onNavigateToFlashcards?: () => void;
  className?: string;
}

export const CompanionChat: React.FC<CompanionChatProps> = ({
  courseId,
  currentLesson,
  activeReminder,
  onClose,
  onMinimize,
  onRequestBreak,
  onNavigateToQuiz,
  onNavigateToFlashcards,
  className = "",
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const [lastHandledReminderId, setLastHandledReminderId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Voice input recognition hook
  const {
    isSupported: isSpeechRecSupported,
    isListening,
    transcript,
    error: speechRecError,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  // Load existing course chat history on mount
  const loadHistory = useCallback(async () => {
    if (!courseId) return;
    setLoadingHistory(true);
    setError(null);
    try {
      const history = await api.getChatHistory(courseId);
      setMessages(history.messages || []);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load conversation history.");
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [courseId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Inject active reminder into dialogue if new
  useEffect(() => {
    if (activeReminder && activeReminder.id !== lastHandledReminderId) {
      setLastHandledReminderId(activeReminder.id);
      const reminderMsg: ChatMessage = {
        role: "assistant",
        content: activeReminder.message,
        clean_answer: activeReminder.message,
        tone: "friendly_checkin",
        created_at: new Date(activeReminder.timestamp).toISOString(),
      };
      setMessages((prev) => [...prev, reminderMsg]);
    }
  }, [activeReminder, lastHandledReminderId]);

  // Sync speech recognition transcript into input
  useEffect(() => {
    if (transcript) {
      setInputMessage(transcript);
    }
  }, [transcript]);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sending]);

  // Clean up speech on unmount
  useEffect(() => {
    return () => {
      speechService.cancel();
    };
  }, []);

  const handleSendMessage = async (customPrompt?: string, explicitIntent?: string) => {
    const textToSend = (customPrompt || inputMessage).trim();
    if (!textToSend || sending) return;

    if (isListening) {
      stopListening();
    }

    setError(null);
    setInputMessage("");

    // Optimistic user message append
    const userMsg: ChatMessage = {
      role: "user",
      content: textToSend,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    try {
      // Build context query prefix if inside a lesson
      let fullMessage = textToSend;
      if (currentLesson?.lessonTitle && !explicitIntent) {
        fullMessage = `[Studying Lesson: "${currentLesson.lessonTitle}"] ${textToSend}`;
      }

      if (typeof api.streamChatMessage === "function") {
        let accumulatedReply = "";
        let currentAgent: string | undefined = undefined;
        let currentRouteSource: string | undefined = undefined;
        let currentChip: { confirmation_chip?: string | null; follow_up_chip?: string | null } | null = null;
        let citations: string[] = [];
        let sources: SourceReference[] | undefined = undefined;

        await api.streamChatMessage(
          courseId,
          {
            message: fullMessage,
            user_tone_setting: "balanced",
            intent: explicitIntent,
            academic_integrity: true,
          },
          {
            onAgent: (agent) => {
              currentAgent = agent;
            },
            onRouteSource: (src) => {
              currentRouteSource = src;
            },
            onChip: (chipData) => {
              currentChip = chipData;
            },
            onToken: (tok) => {
              accumulatedReply += tok;
            },
            onReplace: (replacementText) => {
              accumulatedReply = replacementText;
            },
            onCitations: (cites, srcs) => {
              citations = cites;
              sources = srcs;
            },
            onDone: () => {},
            onError: (err) => {
              throw err;
            },
          }
        );

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: accumulatedReply,
          clean_answer: accumulatedReply,
          sources: sources,
          citations: citations,
          tone: "balanced",
          agent: currentAgent,
          route_source: currentRouteSource,
          confirmation_chip: currentChip ? (currentChip as any).confirmation_chip : undefined,
          follow_up_chip: currentChip ? (currentChip as any).follow_up_chip : undefined,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        // Fallback
        const reply = await api.sendChatMessage(courseId, fullMessage, "balanced", explicitIntent);
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: reply.reply,
          clean_answer: reply.clean_answer || reply.reply,
          sources: reply.sources,
          citations: reply.citations,
          tone: reply.tone,
          confirmation_chip: reply.confirmation_chip,
          follow_up_chip: reply.follow_up_chip,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Could not reach tutor. Please try again.");
      }
    } finally {
      setSending(false);
    }
  };

  // Specific Quick Reply Handlers
  const handleQuickReply = (actionType: "break" | "continue" | "explain" | "sleepy" | "quiz") => {
    switch (actionType) {
      case "break": {
        onRequestBreak();
        const breakMsg: ChatMessage = {
          role: "user",
          content: "Let's take a break",
          created_at: new Date().toISOString(),
        };
        const ackMsg: ChatMessage = {
          role: "assistant",
          content: "Break timer started! Take a 5-minute breather, stretch, and relax. Whenever you're ready to resume, I'll be here.",
          clean_answer: "Break timer started! Take a 5-minute breather, stretch, and relax. Whenever you're ready to resume, I'll be here.",
          tone: "friendly_checkin",
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, breakMsg, ackMsg]);
        if (activeReminder) {
          reminderManager.dismiss();
        }
        break;
      }
      case "continue": {
        const contMsg: ChatMessage = {
          role: "user",
          content: "Continue studying",
          created_at: new Date().toISOString(),
        };
        const ackMsg: ChatMessage = {
          role: "assistant",
          content: "Great determination! Let's keep the focus going. Progress panna po!",
          clean_answer: "Great determination! Let's keep the focus going. Progress panna po!",
          tone: "hype",
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, contMsg, ackMsg]);
        if (activeReminder) {
          reminderManager.dismiss();
        }
        break;
      }
      case "explain": {
        const topicPrompt = currentLesson?.lessonTitle
          ? `Explain the core concepts of "${currentLesson.lessonTitle}" simply with step-by-step examples.`
          : "Explain the key principles we are studying in this course with clear examples.";
        handleSendMessage(topicPrompt);
        break;
      }
      case "sleepy": {
        const sleepMsg: ChatMessage = {
          role: "user",
          content: "I'm feeling sleepy",
          created_at: new Date().toISOString(),
        };
        const adviceMsg: ChatMessage = {
          role: "assistant",
          content: "Feeling drowsy? Wash your face with cold water, do a quick 30-second shoulder stretch, or let's switch to quick flashcards to keep your mind engaged!",
          clean_answer: "Feeling drowsy? Wash your face with cold water, do a quick 30-second shoulder stretch, or let's switch to quick flashcards to keep your mind engaged!",
          tone: "patient",
          follow_up_chip: onNavigateToFlashcards ? "Review flashcards" : undefined,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, sleepMsg, adviceMsg]);
        break;
      }
      case "quiz": {
        if (onNavigateToQuiz) {
          onNavigateToQuiz();
        }
        handleSendMessage("Ask me 1 quick practice question based on our current study materials.", "quiz");
        break;
      }
    }
  };

  // Toggle speech synthesis for an assistant message
  const handleToggleSpeech = (idx: number, text: string) => {
    if (speakingIdx === idx) {
      if (isSpeechPaused) {
        speechService.resume();
        setIsSpeechPaused(false);
      } else {
        speechService.pause();
        setIsSpeechPaused(true);
      }
    } else {
      speechService.cancel();
      setSpeakingIdx(idx);
      setIsSpeechPaused(false);
      speechService.speak(text, {
        onEnd: () => {
          setSpeakingIdx(null);
          setIsSpeechPaused(false);
        },
        onError: () => {
          setSpeakingIdx(null);
          setIsSpeechPaused(false);
        },
      });
    }
  };

  const handleStopSpeech = () => {
    speechService.cancel();
    setSpeakingIdx(null);
    setIsSpeechPaused(false);
  };

  return (
    <div
      role="dialog"
      aria-label={`${MASCOT_NAME} Study Companion`}
      className={`flex flex-col bg-slate-900/95 border border-slate-750 shadow-2xl rounded-3xl backdrop-blur-xl overflow-hidden w-full max-w-full sm:w-[400px] md:w-[440px] h-[580px] sm:h-[620px] transition-all animate-in slide-in-from-bottom-3 duration-300 ${className}`}
    >
      {/* Pinned Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-500/20 to-indigo-600/20 border border-brand-500/30 flex items-center justify-center shrink-0">
            <PlaceholderMascot state={sending ? "studying" : "idle"} isTalking={sending} className="w-7 h-7" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-bold text-white truncate">{MASCOT_NAME}</h3>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">
                Companion
              </span>
            </div>
            <p className="text-[10px] text-slate-400 truncate">
              {currentLesson?.lessonTitle ? `Lesson: ${currentLesson.lessonTitle}` : "Grounded Tutor"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMinimize}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Minimize companion"
            aria-label="Minimize companion"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Close companion"
            aria-label="Close companion"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 min-w-0 text-xs">
        {loadingHistory && (
          <div className="flex items-center justify-center h-full text-slate-400 gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-brand-400" />
            <span className="text-[11px] font-medium">Loading conversation...</span>
          </div>
        )}

        {!loadingHistory && messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-2 text-slate-400">
            <div className="w-10 h-10 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <p className="font-semibold text-white text-xs">How can I assist you right now?</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Ask about formulas, request an explanation, take a break, or ask for a practice question.
            </p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={idx}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[88%] p-3 rounded-2xl leading-relaxed space-y-2 min-w-0 ${
                  isUser
                    ? "bg-brand-600 text-white rounded-br-sm shadow-md"
                    : "bg-slate-850/90 text-slate-200 border border-slate-750 rounded-bl-sm"
                }`}
              >
                <div className="whitespace-pre-wrap break-words">
                  {isUser
                    ? msg.content
                    : (msg.clean_answer ||
                       msg.content
                         .replace(/\*\*Sources?:?\*\*[\s\S]*$/i, "")
                         .replace(/\[(?:doc\s+)?p\.?\s*\d+\]/gi, "")
                         .trim())}
                </div>

                {/* Sources & Citations */}
                {!isUser && msg.citations && msg.citations.length > 0 && (
                  <div className="pt-1.5 border-t border-slate-750/70 flex flex-wrap items-center gap-1">
                    <span className="text-[9px] uppercase font-bold text-slate-400 flex items-center gap-0.5">
                      <BookOpen className="w-2.5 h-2.5 text-brand-400" />
                      Sources:
                    </span>
                    {msg.citations.map((cite, cIdx) => (
                      <span
                        key={cIdx}
                        className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[9px] font-mono text-brand-300"
                      >
                        {cite}
                      </span>
                    ))}
                  </div>
                )}

                {/* Speaker Controls for Assistant Messages */}
                {!isUser && (
                  <div className="pt-1 flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-750/60">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleSpeech(idx, msg.clean_answer || msg.content)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md transition cursor-pointer ${
                          speakingIdx === idx
                            ? "bg-brand-500/20 text-brand-300 border border-brand-500/40"
                            : "hover:bg-slate-800 hover:text-slate-200"
                        }`}
                        title={speakingIdx === idx ? (isSpeechPaused ? "Resume speech" : "Pause speech") : "Listen to answer"}
                        aria-label="Listen to answer"
                      >
                        {speakingIdx === idx && !isSpeechPaused ? (
                          <>
                            <Pause className="w-3 h-3 text-brand-400 animate-pulse" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3 h-3 text-brand-400" />
                            <span>{speakingIdx === idx ? "Resume" : "Listen"}</span>
                          </>
                        )}
                      </button>

                      {speakingIdx === idx && (
                        <button
                          type="button"
                          onClick={handleStopSpeech}
                          className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                          title="Stop speaking"
                          aria-label="Stop speaking"
                        >
                          <Square className="w-2.5 h-2.5 text-rose-400" />
                        </button>
                      )}
                    </div>

                    {msg.tone && (
                      <span className="text-[9px] text-slate-400 capitalize">
                        {msg.tone}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {sending && (
          <div className="flex items-center gap-2 p-2 text-xs text-slate-400">
            <div className="w-2 h-2 rounded-full bg-brand-400 animate-ping" />
            <span>{MASCOT_NAME} is finding grounded notes...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Proactive Quick Reply Action Chips Bar */}
      <div className="shrink-0 px-3 py-2 border-t border-slate-800 bg-slate-950/60 overflow-x-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => handleQuickReply("break")}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[11px] font-semibold transition shrink-0 cursor-pointer"
        >
          <Coffee className="w-3 h-3" />
          <span>Let's take a break</span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickReply("continue")}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold transition shrink-0 cursor-pointer"
        >
          <Play className="w-3 h-3" />
          <span>Continue studying</span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickReply("explain")}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-brand-500/15 hover:bg-brand-500/25 border border-brand-500/30 text-brand-300 text-[11px] font-semibold transition shrink-0 cursor-pointer"
        >
          <HelpCircle className="w-3 h-3" />
          <span>Explain this topic</span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickReply("sleepy")}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-[11px] font-semibold transition shrink-0 cursor-pointer"
        >
          <Sparkles className="w-3 h-3" />
          <span>I'm feeling sleepy</span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickReply("quiz")}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-[11px] font-semibold transition shrink-0 cursor-pointer"
        >
          <Play className="w-3 h-3" />
          <span>Ask me a question</span>
        </button>
      </div>

      {/* Error Banner with Retry */}
      {error && (
        <div className="shrink-0 px-4 py-2 bg-rose-500/10 border-t border-rose-500/20 text-rose-300 text-[11px] flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => handleSendMessage()}
            className="text-[10px] underline font-bold hover:text-white shrink-0 ml-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Speech Recognition Error Banner */}
      {speechRecError && (
        <div className="shrink-0 px-4 py-2 bg-amber-500/10 border-t border-amber-500/20 text-amber-300 text-[11px] flex items-center justify-between">
          <span className="truncate">{speechRecError}</span>
          <button
            type="button"
            onClick={resetTranscript}
            className="text-[10px] underline font-bold hover:text-white shrink-0 ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Active Listening Indicator */}
      {isListening && (
        <div className="shrink-0 px-4 py-1.5 bg-rose-500/10 border-t border-rose-500/20 text-rose-300 text-[11px] flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span className="font-semibold truncate">Listening... Speak your question</span>
          </div>
          <button
            type="button"
            onClick={stopListening}
            className="text-[10px] font-bold underline hover:text-white ml-2"
          >
            Stop
          </button>
        </div>
      )}

      {/* Input Box Footer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
        className="shrink-0 p-3 border-t border-slate-800 bg-slate-950 flex items-center gap-2"
      >
        <button
          type="button"
          onClick={isListening ? stopListening : startListening}
          className={`p-2 rounded-xl border transition flex items-center justify-center shrink-0 ${
            isListening
              ? "bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse"
              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
          }`}
          title={
            !isSpeechRecSupported
              ? "Speech recognition is not supported in this browser"
              : isListening
              ? "Click to stop dictating"
              : "Click to dictate with your voice"
          }
          aria-label={isListening ? "Stop microphone" : "Start microphone"}
        >
          {isListening ? (
            <MicOff className="w-4 h-4 text-rose-400" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>

        <textarea
          ref={inputRef}
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          disabled={sending}
          rows={1}
          placeholder={`Reply to ${MASCOT_NAME}... (Enter to send)`}
          className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-brand-500 resize-none max-h-20"
        />

        <button
          type="submit"
          disabled={sending || !inputMessage.trim()}
          className="p-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          title="Send message"
          aria-label="Send message"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
