import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Bot,
  CornerDownLeft,
  Info,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { MASCOT_NAME } from "../brand";
import { api, ApiError } from "../services/api";
import { ChatMessage, Course } from "../types";

interface ChatViewProps {
  course: Course;
}

type ToneSetting = "balanced" | "serious" | "full" | "english_only";

export const ChatView: React.FC<ChatViewProps> = ({ course }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState<string>("");
  const [loadingHistory, setLoadingHistory] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [toneSetting, setToneSetting] = useState<ToneSetting>("balanced");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setError(null);
    try {
      const history = await api.getChatHistory(course.id);
      setMessages(history.messages || []);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load chat history.");
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [course.id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending]);

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = (customPrompt || inputMessage).trim();
    if (!textToSend || sending) return;

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
      const reply = await api.sendChatMessage(course.id, textToSend, toneSetting);
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: reply.reply,
        clean_answer: reply.clean_answer || reply.reply,
        sources: reply.sources,
        citations: reply.citations,
        tone: reply.tone,
        is_sufficient: reply.is_sufficient,
        grounding_status: reply.grounding_status,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Could not reach tutor service. Please check your connection or provider settings.");
      }
    } finally {
      setSending(false);
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm("Clear all conversation history with " + MASCOT_NAME + " for this course?")) {
      return;
    }
    try {
      await api.clearChatHistory(course.id);
      setMessages([]);
    } catch (err) {
      console.error("Failed to clear chat history:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const quickPrompts = [
    "Summarize the key learning concepts in these materials.",
    "What are the most challenging formulas or principles here?",
    "Give me 3 practice questions based on what we studied.",
  ];

  return (
    <div className="flex flex-col h-[700px] glass-panel rounded-3xl border border-slate-800 overflow-hidden">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-brand-500/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Ask {MASCOT_NAME}</h2>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Grounded RAG
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Answers are strictly grounded in your uploaded course materials with citations.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Tone Setting selector */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 text-[11px] font-semibold">Persona Tone:</span>
            <select
              value={toneSetting}
              onChange={(e) => setToneSetting(e.target.value as ToneSetting)}
              className="bg-slate-800 text-slate-200 border border-slate-700 rounded-xl px-2.5 py-1 text-xs focus:ring-1 focus:ring-brand-400 focus:outline-none"
            >
              <option value="balanced">Balanced (Encouraging)</option>
              <option value="full">Full (Tanglish Buddy)</option>
              <option value="serious">Serious (Exam Focus)</option>
              <option value="english_only">English Only</option>
            </select>
          </div>

          {messages.length > 0 && (
            <button
              onClick={handleClearHistory}
              title="Clear conversation"
              className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loadingHistory && (
          <div className="flex items-center justify-center h-full text-slate-400 gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-brand-400" />
            <span className="text-xs font-semibold">Loading conversation history...</span>
          </div>
        )}

        {!loadingHistory && messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 py-8">
            <div className="w-14 h-14 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
              <Bot className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-white">How can {MASCOT_NAME} help?</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Ask any question about your notes, formulas, or textbook chapters.
                Answers cite exact document pages and refuse to fabricate facts.
              </p>
            </div>

            <div className="pt-2 w-full space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 text-left">
                Suggested questions:
              </p>
              {quickPrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSendMessage(prompt)}
                  className="w-full text-left text-xs p-3 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-brand-500/40 text-slate-300 hover:text-white transition flex items-center justify-between group"
                >
                  <span>{prompt}</span>
                  <CornerDownLeft className="w-3.5 h-3.5 text-slate-400 group-hover:text-brand-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isUser = msg.role === "user";

          return (
            <div
              key={idx}
              className={`flex items-start gap-3.5 ${
                isUser ? "flex-row-reverse" : "flex-row"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  isUser
                    ? "bg-slate-800 text-slate-300 border border-slate-700"
                    : "bg-gradient-to-tr from-brand-500 to-indigo-600 text-white shadow-md shadow-brand-500/20"
                }`}
              >
                {isUser ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[85%] rounded-2xl p-4 space-y-3 text-xs leading-relaxed ${
                  isUser
                    ? "bg-brand-600 text-white rounded-tr-sm shadow-md"
                    : "glass-card bg-slate-900/90 text-slate-200 border border-slate-800 rounded-tl-sm"
                }`}
              >
                {/* Clean Answer Body */}
                <div className="whitespace-pre-wrap font-sans leading-relaxed">
                  {isUser
                    ? msg.content
                    : (msg.clean_answer ||
                       msg.content
                         .replace(/\*\*Sources?:?\*\*[\s\S]*$/i, "")
                         .replace(/\[(?:doc\s+)?p\.?\s*\d+\]/gi, "")
                         .trim())}
                </div>

                {/* Refusal notification if context insufficient */}
                {msg.is_sufficient === false && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      Grounded Retrieval Note: The uploaded materials do not contain sufficient evidence to answer this query.
                    </span>
                  </div>
                )}

                {/* Structured Sources Section */}
                {!isUser && msg.sources && msg.sources.length > 0 && (
                  <div className="pt-3 border-t border-slate-800/80 space-y-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5 tracking-wider">
                      <BookOpen className="w-3 h-3 text-brand-400" />
                      Sources:
                    </span>
                    <div className="space-y-1">
                      {msg.sources.map((src, sIdx) => (
                        <div
                          key={sIdx}
                          className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800/90 text-[11px] font-mono text-slate-300"
                        >
                          <span className="text-brand-300 font-semibold">{src.document_name}</span>
                          <span className="text-slate-400">Page {src.page}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fallback Citation Badges if structured sources not available */}
                {!isUser && (!msg.sources || msg.sources.length === 0) && msg.citations && msg.citations.length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                      <BookOpen className="w-3 h-3 text-brand-400" />
                      Sources:
                    </span>
                    {msg.citations.map((cite, cIdx) => (
                      <span
                        key={cIdx}
                        className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700/80 text-[10px] font-mono text-brand-300"
                      >
                        {cite}
                      </span>
                    ))}
                  </div>
                )}

                {/* Assistant tone tag */}
                {!isUser && msg.tone && (
                  <div className="text-[10px] text-slate-500 text-right">
                    Tone: <span className="capitalize text-slate-400">{msg.tone}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Sending / streaming indicator */}
        {sending && (
          <div className="flex items-start gap-3.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-500 to-indigo-600 flex items-center justify-center text-white shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="glass-card bg-slate-900/90 p-4 rounded-2xl rounded-tl-sm border border-slate-800 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-brand-400 animate-spin" />
              <span className="text-xs text-slate-400">
                Searching course chunks and generating answer...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="px-6 py-3 bg-rose-500/10 border-t border-rose-500/20 text-rose-300 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">{error}</p>
            {error.toLowerCase().includes("api key") && (
              <p className="text-slate-400 text-[11px] leading-relaxed">
                Tip: Configure <code className="text-brand-300 font-mono">GROQ_API_KEY</code>, <code className="text-brand-300 font-mono">OPENROUTER_API_KEY</code>, or <code className="text-brand-300 font-mono">GOOGLE_API_KEY</code> in your root <code className="text-brand-300 font-mono">.env</code> file, then restart the development server.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Input Box Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/60">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-end gap-3"
        >
          <div className="flex-1 relative">
            <textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              placeholder={`Ask ${MASCOT_NAME} a question about your course materials... (Press Enter to send)`}
              rows={2}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-2xl px-4 py-3 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={sending || !inputMessage.trim()}
            className="h-11 px-5 rounded-2xl bg-gradient-to-r from-brand-500 to-indigo-600 text-white font-bold text-xs hover:from-brand-600 hover:to-indigo-700 transition shadow-lg shadow-brand-500/25 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <span>Ask</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
