import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Coffee,
  HelpCircle,
  Layers,
  Mic,
  MicOff,
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
import { ChatMessage, RoadmapItem } from "../../types";
import { PlaceholderMascot } from "./PlaceholderMascot";

export interface CompanionChatProps {
  courseId: number;
  currentLesson?: { item: RoadmapItem; taskId: string; lessonTitle?: string } | null;
  activeReminder?: ActiveReminder | null;
  onClose: () => void;
  onMinimize?: () => void;
  onRequestBreak: () => void;
  onNavigateToQuiz?: () => void;
  onNavigateToFlashcards?: () => void;
  className?: string;
}

/**
 * Lightweight inline markdown and citation renderer.
 * Ensures code blocks scroll horizontally INSIDE the block only,
 * and text wraps naturally with zero horizontal scrolling on bubbles.
 */
function renderMarkdownContent(content: string): React.ReactNode {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, pIdx) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const firstLineEnd = part.indexOf("\n");
      const lang = firstLineEnd > 3 ? part.slice(3, firstLineEnd).trim() : "";
      const code = firstLineEnd !== -1 ? part.slice(firstLineEnd + 1, -3) : part.slice(3, -3);
      return (
        <div key={pIdx} className="my-2 rounded-lg bg-[#F1F5F9] border border-[#E2E8F0] overflow-hidden text-xs">
          {lang && (
            <div className="px-3 py-1 bg-[#E2E8F0] text-[10px] font-mono text-[#64748B] uppercase">
              {lang}
            </div>
          )}
          <pre className="p-3 overflow-x-auto text-[#0F172A] font-mono text-[11px] leading-relaxed">
            <code>{code}</code>
          </pre>
        </div>
      );
    }

    const lines = part.split("\n");
    return (
      <div key={pIdx} className="space-y-1">
        {lines.map((line, lIdx) => {
          if (!line.trim()) return <div key={lIdx} className="h-1" />;

          // Headings
          if (line.startsWith("### ")) {
            return (
              <h4 key={lIdx} className="font-bold text-[#0F172A] text-xs pt-1">
                {formatInline(line.slice(4))}
              </h4>
            );
          }
          if (line.startsWith("## ")) {
            return (
              <h3 key={lIdx} className="font-bold text-[#0F172A] text-sm pt-1">
                {formatInline(line.slice(3))}
              </h3>
            );
          }
          if (line.startsWith("# ")) {
            return (
              <h2 key={lIdx} className="font-bold text-[#0F172A] text-base pt-1">
                {formatInline(line.slice(2))}
              </h2>
            );
          }

          // Bullet lists
          if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
            return (
              <div key={lIdx} className="flex items-start gap-1.5 ml-2 text-xs">
                <span className="text-[#4F46E5] font-bold">•</span>
                <span className="flex-1">{formatInline(line.trim().slice(2))}</span>
              </div>
            );
          }

          // Numbered lists
          const numMatch = line.trim().match(/^(\d+)\.\s+(.*)/);
          if (numMatch) {
            return (
              <div key={lIdx} className="flex items-start gap-1.5 ml-2 text-xs">
                <span className="text-[#4F46E5] font-semibold">{numMatch[1]}.</span>
                <span className="flex-1">{formatInline(numMatch[2])}</span>
              </div>
            );
          }

          return (
            <p key={lIdx} className="text-xs leading-relaxed break-words">
              {formatInline(line)}
            </p>
          );
        })}
      </div>
    );
  });
}

function formatInline(str: string): React.ReactNode[] {
  const tokens = str.split(/(`[^`]+`|\*\*[^*]+\*\*|\[(?:doc\s+)?p\.?\s*\d+\])/g);
  return tokens.map((token, tIdx) => {
    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <code
          key={tIdx}
          className="px-1.5 py-0.5 rounded bg-[#F1F5F9] border border-[#E2E8F0] font-mono text-[11px] text-[#0F172A]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith("**") && token.endsWith("**")) {
      return (
        <strong key={tIdx} className="font-semibold text-[#0F172A]">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (/^\[(?:doc\s+)?p\.?\s*\d+\]$/i.test(token)) {
      return (
        <span
          key={tIdx}
          className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-[#EEF2FF] text-[#4F46E5] border border-indigo-100 text-[10px] font-medium mx-0.5"
        >
          {token}
        </span>
      );
    }
    return token;
  });
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

  // Handle Speech Synthesis
  const handleToggleSpeech = (idx: number, text: string) => {
    if (speakingIdx === idx) {
      if (isSpeechPaused) {
        speechService.resume();
        setIsSpeechPaused(false);
      } else {
        speechService.pause();
        setIsSpeechPaused(true);
      }
      return;
    }

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
  };

  const handleStopSpeech = () => {
    speechService.cancel();
    setSpeakingIdx(null);
    setIsSpeechPaused(false);
  };

  // Quick reply chip click handler
  const handleQuickReply = (action: string) => {
    if (action === "break") {
      onRequestBreak();
      const userMsg: ChatMessage = {
        role: "user",
        content: "Let's take a break",
        created_at: new Date().toISOString(),
      };
      const botAck: ChatMessage = {
        role: "assistant",
        content: "Break timer started. Romba nalladhu! Take 5 minutes, stretch, and drink some water, boss.",
        clean_answer: "Break timer started. Romba nalladhu! Take 5 minutes, stretch, and drink some water, boss.",
        tone: "friendly_checkin",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg, botAck]);
      return;
    }

    if (action === "continue") {
      reminderManager.dismiss();
      const userMsg: ChatMessage = {
        role: "user",
        content: "Continue studying",
        created_at: new Date().toISOString(),
      };
      const botAck: ChatMessage = {
        role: "assistant",
        content: "Great determination! Super! Back to focus mode. What should we tackle next?",
        clean_answer: "Great determination! Super! Back to focus mode. What should we tackle next?",
        tone: "hype",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg, botAck]);
      return;
    }

    if (action === "explain") {
      const topicPrompt = currentLesson?.lessonTitle
        ? `Explain ${currentLesson.lessonTitle} simply with a real-world example.`
        : "Explain this topic simply with a clear real-world analogy.";
      handleSendMessage(topicPrompt);
      return;
    }

    if (action === "sleepy") {
      const userMsg: ChatMessage = {
        role: "user",
        content: "I'm feeling sleepy",
        created_at: new Date().toISOString(),
      };
      const botAck: ChatMessage = {
        role: "assistant",
        content: "You might be getting tired, boss. Wash your face with cold water or take a quick 5-minute break!",
        clean_answer: "You might be getting tired, boss. Wash your face with cold water or take a quick 5-minute break!",
        tone: "friendly_checkin",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg, botAck]);
      return;
    }

    if (action === "quiz") {
      if (onNavigateToQuiz) {
        onNavigateToQuiz();
        return;
      }
      handleSendMessage("Quiz me on this concept with a quick question!");
      return;
    }

    if (action === "flashcards") {
      if (onNavigateToFlashcards) {
        onNavigateToFlashcards();
        return;
      }
      handleSendMessage("Can we make flashcards for this topic?");
      return;
    }
  };

  // Send message to Tutor API
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? inputMessage).trim();
    if (!text || sending) return;

    setError(null);
    setInputMessage("");
    resetTranscript();
    if (isListening) stopListening();

    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setSending(true);

    try {
      let accumulatedReply = "";
      let accumulatedClean = "";
      let accumulatedCitations: string[] = [];

      // Add placeholder assistant message
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "",
          clean_answer: "",
          citations: [],
          created_at: new Date().toISOString(),
        },
      ]);

      await api.streamChatMessage(
        courseId,
        {
          message: text,
          user_tone_setting: "balanced",
        },
        {
          onToken: (token) => {
            accumulatedReply += token;
            accumulatedClean += token;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                last.content = accumulatedReply;
                last.clean_answer = accumulatedClean;
              }
              return next;
            });
          },
          onCitations: (citations) => {
            accumulatedCitations = citations;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                last.citations = accumulatedCitations;
              }
              return next;
            });
          },
          onError: (err) => {
            setError(err.message || "Failed to stream message");
          },
        }
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to send message. Please retry.");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`${MASCOT_NAME} Study Companion`}
      className={`flex flex-col bg-white border border-[#E2E8F0] shadow-panel overflow-hidden w-full max-w-full sm:w-[380px] h-[min(600px,80vh)] rounded-2xl select-text transition-all animate-in slide-in-from-bottom-3 duration-200 z-40 ${className}`}
    >
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-[#E2E8F0] bg-white flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-[#EEF2FF] border border-indigo-100 flex items-center justify-center shrink-0">
            <PlaceholderMascot state={sending ? "studying" : "idle"} isTalking={sending} className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-bold text-[#0F172A] truncate">{MASCOT_NAME}</h3>
              <span className="w-2 h-2 rounded-full bg-[#0D9488]" />
              <span className="text-[10px] text-[#0D9488] font-semibold tracking-wide">
                Your study buddy
              </span>
            </div>
            <p className="text-[10px] text-[#64748B] truncate">
              {currentLesson?.lessonTitle ? currentLesson.lessonTitle : "Grounded Tutor"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition"
              title="Minimize companion"
              aria-label="Minimize companion"
            >
              <span className="text-xs font-semibold px-1">Done</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition"
            title="Close companion"
            aria-label="Close companion"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3 min-w-0 text-xs bg-[#F7F8FC]"
        aria-live="polite"
      >
        {loadingHistory && (
          <div className="flex items-center justify-center h-full text-[#64748B] gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-[#4F46E5]" />
            <span className="text-xs font-medium">Loading conversation...</span>
          </div>
        )}

        {!loadingHistory && messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-3 text-[#64748B]">
            <div className="w-12 h-12 rounded-2xl bg-[#EEF2FF] border border-indigo-100 flex items-center justify-center text-[#4F46E5]">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="font-bold text-[#0F172A] text-sm">Hi, I'm {MASCOT_NAME}!</p>
              <p className="text-xs text-[#64748B] max-w-xs leading-relaxed">
                Your friendly study companion. What would you like to work on right now?
              </p>
            </div>

            {/* 3 Suggested Prompts */}
            <div className="w-full space-y-2 pt-2">
              <button
                type="button"
                onClick={() => handleQuickReply("explain")}
                className="w-full text-left px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] hover:border-[#4F46E5] hover:bg-[#EEF2FF] text-[#334155] text-xs font-medium transition shadow-sm flex items-center gap-2 group"
              >
                <HelpCircle className="w-3.5 h-3.5 text-[#4F46E5] shrink-0" />
                <span className="truncate group-hover:text-[#4F46E5]">Explain this topic simply</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickReply("quiz")}
                className="w-full text-left px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] hover:border-[#4F46E5] hover:bg-[#EEF2FF] text-[#334155] text-xs font-medium transition shadow-sm flex items-center gap-2 group"
              >
                <Play className="w-3.5 h-3.5 text-[#0D9488] shrink-0" />
                <span className="truncate group-hover:text-[#4F46E5]">Quiz me</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickReply("flashcards")}
                className="w-full text-left px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] hover:border-[#4F46E5] hover:bg-[#EEF2FF] text-[#334155] text-xs font-medium transition shadow-sm flex items-center gap-2 group"
              >
                <Layers className="w-3.5 h-3.5 text-[#D97706] shrink-0" />
                <span className="truncate group-hover:text-[#4F46E5]">Make flashcards</span>
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isUser = msg.role === "user";
          const rawText = isUser
            ? msg.content
            : (msg.clean_answer ||
               msg.content
                 .replace(/\*\*Sources?:?\*\*[\s\S]*$/i, "")
                 .replace(/\[(?:doc\s+)?p\.?\s*\d+\]/gi, "")
                 .trim());

          const bodyToRender =
            !isUser && msg.citations && msg.citations.length > 0
              ? rawText.replace(/\[(?:doc\s+)?p\.?\s*\d+\]/gi, "").trim()
              : rawText;

          return (
            <div
              key={idx}
              className={`flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"} min-w-0`}
            >
              {!isUser && (
                <div className="w-6 h-6 rounded-full bg-[#EEF2FF] border border-indigo-100 flex items-center justify-center shrink-0 mb-1">
                  <PlaceholderMascot state="idle" className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-[85%] p-3 rounded-[12px] leading-relaxed space-y-1.5 min-w-0 overflow-x-hidden ${
                  isUser
                    ? "bg-[#4F46E5] text-white rounded-br-none shadow-sm"
                    : "bg-white text-[#334155] border border-[#E2E8F0] rounded-bl-none shadow-sm"
                }`}
              >
                <div className="overflow-wrap-anywhere break-words min-w-0">
                  {isUser ? (
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  ) : (
                    renderMarkdownContent(bodyToRender)
                  )}
                </div>

                {/* Citations */}
                {!isUser && msg.citations && msg.citations.length > 0 && (
                  <div className="pt-1.5 border-t border-[#E2E8F0] flex flex-wrap items-center gap-1">
                    <span className="text-[10px] uppercase font-bold text-[#64748B] flex items-center gap-0.5">
                      <BookOpen className="w-2.5 h-2.5 text-[#4F46E5]" />
                      Sources:
                    </span>
                    {msg.citations.map((cite, cIdx) => (
                      <span
                        key={cIdx}
                        className="px-1.5 py-0.5 rounded bg-[#EEF2FF] border border-indigo-100 text-[10px] font-medium text-[#4F46E5]"
                      >
                        {cite}
                      </span>
                    ))}
                  </div>
                )}

                {/* Speaker Controls */}
                {!isUser && (
                  <div className="pt-1 flex items-center justify-between text-[10px] text-[#64748B] border-t border-[#F1F5F9]">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleSpeech(idx, rawText)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md transition cursor-pointer ${
                          speakingIdx === idx
                            ? "bg-[#EEF2FF] text-[#4F46E5] border border-indigo-200"
                            : "hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                        }`}
                        title={speakingIdx === idx ? (isSpeechPaused ? "Resume speech" : "Pause speech") : "Listen to answer"}
                        aria-label="Listen to answer"
                      >
                        {speakingIdx === idx && !isSpeechPaused ? (
                          <>
                            <Pause className="w-3 h-3 text-[#4F46E5] animate-pulse" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3 h-3 text-[#4F46E5]" />
                            <span>{speakingIdx === idx ? "Resume" : "Listen"}</span>
                          </>
                        )}
                      </button>

                      {speakingIdx === idx && (
                        <button
                          type="button"
                          onClick={handleStopSpeech}
                          className="p-1 rounded text-[#64748B] hover:text-[#E11D48] hover:bg-[#FFF1F2]"
                          title="Stop speaking"
                          aria-label="Stop speaking"
                        >
                          <Square className="w-2.5 h-2.5 text-[#E11D48]" />
                        </button>
                      )}
                    </div>

                    {msg.tone && (
                      <span className="text-[9px] text-[#64748B] capitalize">
                        {msg.tone}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {sending && (
          <div className="flex items-end gap-2 justify-start min-w-0">
            <div className="w-6 h-6 rounded-full bg-[#EEF2FF] border border-indigo-100 flex items-center justify-center shrink-0 mb-1">
              <PlaceholderMascot state="studying" className="w-4 h-4" />
            </div>
            <div className="bg-white border border-[#E2E8F0] px-3.5 py-2.5 rounded-[12px] rounded-bl-none shadow-sm flex items-center gap-2">
              <span className="text-[11px] font-medium text-[#64748B]">{MASCOT_NAME} is thinking</span>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4F46E5] animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#4F46E5] animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#4F46E5] animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Proactive Quick Reply Action Chips Bar */}
      <div className="shrink-0 px-3 py-2 border-t border-[#E2E8F0] bg-white overflow-x-auto flex items-center gap-1.5 scrollbar-none">
        <button
          type="button"
          onClick={() => handleQuickReply("break")}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-[#FFFBEB] hover:bg-[#FEF3C7] border border-amber-200 text-[#D97706] text-[11px] font-semibold transition shrink-0 cursor-pointer"
        >
          <Coffee className="w-3 h-3" />
          <span>Let's take a break</span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickReply("continue")}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-[#F0FDFA] hover:bg-[#CCFBF1] border border-teal-200 text-[#0D9488] text-[11px] font-semibold transition shrink-0 cursor-pointer"
        >
          <Play className="w-3 h-3" />
          <span>Continue studying</span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickReply("explain")}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-[#EEF2FF] hover:bg-[#E0E7FF] border border-indigo-200 text-[#4F46E5] text-[11px] font-semibold transition shrink-0 cursor-pointer"
        >
          <HelpCircle className="w-3 h-3" />
          <span>Explain this topic</span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickReply("sleepy")}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-[#FFF1F2] hover:bg-[#FFE4E6] border border-rose-200 text-[#E11D48] text-[11px] font-semibold transition shrink-0 cursor-pointer"
        >
          <Coffee className="w-3 h-3" />
          <span>I'm feeling sleepy</span>
        </button>
      </div>

      {/* Error Banner with Retry */}
      {error && (
        <div className="shrink-0 px-4 py-2 bg-[#FFF1F2] border-t border-rose-200 text-[#E11D48] text-[11px] flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 text-[#E11D48] shrink-0" />
            <span className="truncate">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => handleSendMessage()}
            className="text-[10px] underline font-bold hover:text-rose-900 shrink-0 ml-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Speech Recognition Error Banner */}
      {speechRecError && (
        <div className="shrink-0 px-4 py-2 bg-[#FFFBEB] border-t border-amber-200 text-[#D97706] text-[11px] flex items-center justify-between">
          <span className="truncate">{speechRecError}</span>
          <button
            type="button"
            onClick={resetTranscript}
            className="text-[10px] underline font-bold hover:text-amber-900 shrink-0 ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Active Listening Indicator */}
      {isListening && (
        <div className="shrink-0 px-4 py-1.5 bg-[#FFF1F2] border-t border-rose-200 text-[#E11D48] text-[11px] flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-full bg-[#E11D48] animate-ping" />
            <span className="font-semibold truncate">Listening... Speak your question</span>
          </div>
          <button
            type="button"
            onClick={stopListening}
            className="text-[10px] font-bold underline hover:text-rose-900 ml-2"
          >
            Stop
          </button>
        </div>
      )}

      {/* Sticky Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
        className="shrink-0 p-3 border-t border-[#E2E8F0] bg-white flex items-center gap-2"
      >
        <button
          type="button"
          onClick={isListening ? stopListening : startListening}
          className={`p-2.5 rounded-btn border transition flex items-center justify-center shrink-0 min-h-[44px] min-w-[44px] ${
            isListening
              ? "bg-[#FFF1F2] border-rose-300 text-[#E11D48] animate-pulse"
              : "bg-[#F8FAFC] border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9]"
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
            <MicOff className="w-4 h-4 text-[#E11D48]" />
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
          className="flex-1 bg-[#F8FAFC] border border-[#E2E8F0] rounded-btn px-3 py-2 text-xs text-[#0F172A] placeholder-[#64748B] focus:outline-none focus:border-[#4F46E5] focus:bg-white resize-none max-h-20"
        />

        <button
          type="submit"
          onClick={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          disabled={sending || !inputMessage.trim()}
          className="p-2.5 rounded-btn bg-[#4F46E5] hover:bg-[#4338CA] text-white font-bold transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center shadow-sm"
          title="Send message"
          aria-label="Send message"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
