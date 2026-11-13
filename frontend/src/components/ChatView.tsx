import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Bot,
  CornerDownLeft,
  Info,
  Mic,
  MicOff,
  Pause,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  User as UserIcon,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { MASCOT_NAME } from "../brand";
import { PlaceholderMascot } from "./buddy/PlaceholderMascot";
import { speechService, useSpeechRecognition } from "../services/voice";
import { api, ApiError } from "../services/api";
import { ChatMessage, Course, SourceReference } from "../types";

interface ChatViewProps {
  course: Course;
}

type ToneSetting = "balanced" | "serious" | "full" | "english_only";

interface CitationModalState {
  document_name: string;
  page: number;
  excerpt?: string | null;
}

export const ChatView: React.FC<ChatViewProps> = ({ course }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState<string>("");
  const [loadingHistory, setLoadingHistory] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [toneSetting, setToneSetting] = useState<ToneSetting>("balanced");
  const [academicIntegrity, setAcademicIntegrity] = useState<boolean>(true);

  // Streaming state
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [streamingMeta, setStreamingMeta] = useState<{
    agent?: string;
    route_source?: string;
    chip?: { confirmation_chip?: string | null; follow_up_chip?: string | null };
  }>({});

  // Citation modal popover
  const [selectedCitation, setSelectedCitation] = useState<CitationModalState | null>(null);

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

  // Voice output speech synthesis state
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [isSpeechPaused, setIsSpeechPaused] = useState<boolean>(false);
  const [autoReadReplies, setAutoReadReplies] = useState<boolean>(() => {
    try {
      return localStorage.getItem("padhai_chat_autoread") === "true";
    } catch {
      return false;
    }
  });

  // Sync speech recognition transcript into input
  useEffect(() => {
    if (transcript) {
      setInputMessage(transcript);
    }
  }, [transcript]);

  // Clean up speech synthesis on unmount
  useEffect(() => {
    return () => {
      speechService.cancel();
    };
  }, []);

  const handleToggleAutoRead = () => {
    const nextVal = !autoReadReplies;
    setAutoReadReplies(nextVal);
    try {
      localStorage.setItem("padhai_chat_autoread", String(nextVal));
    } catch {}
    if (!nextVal) {
      speechService.cancel();
      setSpeakingIdx(null);
    }
  };

  const handleToggleMessageSpeech = (idx: number, text: string) => {
    if (speakingIdx === idx) {
      if (speechService.isSpeaking()) {
        if (speechService.isPaused()) {
          speechService.resume();
          setIsSpeechPaused(false);
        } else {
          speechService.pause();
          setIsSpeechPaused(true);
        }
      } else {
        setSpeakingIdx(null);
        setIsSpeechPaused(false);
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
  }, [messages, sending, streamingContent]);

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

    if (typeof api.streamChatMessage === "function") {
      let accumulatedReply = "";
      let currentAgent: string | undefined = undefined;
      let currentRouteSource: string | undefined = undefined;
      let currentChip: { confirmation_chip?: string | null; follow_up_chip?: string | null } | null = null;
      let citations: string[] = [];
      let sources: SourceReference[] | undefined = undefined;

      setStreamingContent("");
      setStreamingMeta({});

      try {
        await api.streamChatMessage(
          course.id,
          {
            message: textToSend,
            user_tone_setting: toneSetting,
            intent: explicitIntent,
            academic_integrity: academicIntegrity,
          },
          {
            onAgent: (agent) => {
              currentAgent = agent;
              setStreamingMeta((prev) => ({ ...prev, agent }));
            },
            onRouteSource: (source) => {
              currentRouteSource = source;
              setStreamingMeta((prev) => ({ ...prev, route_source: source }));
            },
            onChip: (chipData) => {
              currentChip = chipData;
              setStreamingMeta((prev) => ({ ...prev, chip: chipData }));
            },
            onToken: (tok) => {
              accumulatedReply += tok;
              setStreamingContent(accumulatedReply);
            },
            onReplace: (replacementText) => {
              accumulatedReply = replacementText;
              setStreamingContent(accumulatedReply);
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
          tone: toneSetting,
          is_sufficient:
            !accumulatedReply.includes("do not contain sufficient evidence") &&
            !accumulatedReply.includes("could not verify"),
          agent: currentAgent,
          route_source: currentRouteSource,
          confirmation_chip: currentChip ? (currentChip as any).confirmation_chip : undefined,
          follow_up_chip: currentChip ? (currentChip as any).follow_up_chip : undefined,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingContent("");
        setStreamingMeta({});

        if (autoReadReplies) {
          speechService.speak(assistantMsg.clean_answer || assistantMsg.content);
        }
      } catch (err) {
        // Fallback to sendChatMessage if streamChatMessage fails or is mocked to fail
        if (typeof api.sendChatMessage === "function") {
          try {
            const reply = await api.sendChatMessage(course.id, textToSend, toneSetting, explicitIntent);
            const assistantMsg: ChatMessage = {
              role: "assistant",
              content: reply.reply,
              clean_answer: reply.clean_answer || reply.reply,
              sources: reply.sources,
              citations: reply.citations,
              tone: reply.tone,
              is_sufficient: reply.is_sufficient,
              grounding_status: reply.grounding_status,
              agent: reply.agent,
              route_source: reply.route_source,
              confirmation_chip: reply.confirmation_chip,
              follow_up_chip: reply.follow_up_chip,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setStreamingContent("");

            if (autoReadReplies) {
              speechService.speak(assistantMsg.clean_answer || assistantMsg.content);
            }
            return;
          } catch {
            // let outer catch handle it
          }
        }
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Could not reach tutor service. Please check your connection or provider settings.");
        }
      } finally {
        setSending(false);
      }
    } else {
      // Fallback path when streamChatMessage is not present
      try {
        const reply = await api.sendChatMessage(course.id, textToSend, toneSetting, explicitIntent);
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: reply.reply,
          clean_answer: reply.clean_answer || reply.reply,
          sources: reply.sources,
          citations: reply.citations,
          tone: reply.tone,
          is_sufficient: reply.is_sufficient,
          grounding_status: reply.grounding_status,
          agent: reply.agent,
          route_source: reply.route_source,
          confirmation_chip: reply.confirmation_chip,
          follow_up_chip: reply.follow_up_chip,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        if (autoReadReplies) {
          speechService.speak(assistantMsg.clean_answer || assistantMsg.content);
        }
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Could not reach tutor service. Please check your connection or provider settings.");
        }
      } finally {
        setSending(false);
      }
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

  const handleCitationClick = (citationStr: string, sources?: SourceReference[]) => {
    // Match page number from "[doc p.12]" or "Page 12"
    const match = citationStr.match(/\d+/);
    const pageNum = match ? parseInt(match[0], 10) : 1;
    const matchingSource = sources?.find((s) => s.page === pageNum);

    setSelectedCitation({
      document_name: matchingSource?.document_name || "Course Document",
      page: pageNum,
      excerpt: matchingSource?.excerpt,
    });
  };

  const quickPrompts = [
    "Summarize the key learning concepts in these materials.",
    "What are the most challenging formulas or principles here?",
    "Give me 3 practice questions based on what we studied.",
  ];

  return (
    <div className="flex flex-col h-[700px] bg-surface rounded-2xl border border-line shadow-card overflow-hidden relative">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-line bg-subtle/80 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary-light border border-primary/25 flex items-center justify-center p-0.5 shadow-sm">
            <PlaceholderMascot state={sending ? "studying" : "idle"} isTalking={sending} className="w-9 h-9" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-heading">Ask {MASCOT_NAME}</h2>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-accent-light text-accent border border-accent/25">
                Grounded RAG
              </span>
            </div>
            <p className="text-xs text-muted">
              Answers are strictly grounded in your uploaded course materials with citations.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Academic Integrity Toggle */}
          <button
            type="button"
            onClick={() => setAcademicIntegrity(!academicIntegrity)}
            title={
              academicIntegrity
                ? "Academic Integrity ON: Guides you through homework and exams with first principles rather than raw answers"
                : "Academic Integrity OFF"
            }
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition ${
              academicIntegrity
                ? "bg-accent-light text-accent border-accent/25 hover:opacity-90"
                : "bg-surface text-muted border-line hover:bg-codeblock"
            }`}
          >
            <ShieldCheck className={`w-3.5 h-3.5 ${academicIntegrity ? "text-accent" : "text-muted"}`} />
            <span className="hidden md:inline">Integrity Mode</span>
          </button>

          {/* Voice Auto-Read Toggle */}
          <button
            type="button"
            onClick={handleToggleAutoRead}
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition ${
              autoReadReplies
                ? "bg-primary-light border-primary/25 text-primary"
                : "bg-surface text-muted border-line hover:bg-codeblock"
            }`}
            title="Automatically read aloud new tutor responses"
          >
            {autoReadReplies ? (
              <Volume2 className="w-3.5 h-3.5 text-primary" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-muted" />
            )}
            <span className="hidden md:inline">Auto-Read</span>
          </button>

          {/* Tone Setting selector */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs">
            <span className="text-muted text-[11px] font-semibold">Persona Tone:</span>
            <select
              value={toneSetting}
              onChange={(e) => setToneSetting(e.target.value as ToneSetting)}
              className="bg-surface text-heading border border-line rounded-xl px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
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
              className="p-2 rounded-xl text-muted hover:text-error hover:bg-error-light transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-subtle/40">
        {loadingHistory && (
          <div className="flex items-center justify-center h-full text-muted gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-primary" />
            <span className="text-xs font-semibold">Loading conversation history...</span>
          </div>
        )}

        {!loadingHistory && messages.length === 0 && !streamingContent && (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 py-8">
            <div className="w-14 h-14 rounded-2xl bg-primary-light border border-primary/20 flex items-center justify-center text-primary">
              <Bot className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-heading">How can {MASCOT_NAME} help?</h3>
              <p className="text-xs text-muted leading-relaxed">
                Ask any question about your notes, formulas, or textbook chapters.
                Answers cite exact document pages and refuse to fabricate facts.
              </p>
            </div>

            <div className="pt-2 w-full space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted text-left">
                Suggested questions:
              </p>
              {quickPrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSendMessage(prompt)}
                  className="w-full text-left text-xs p-3 rounded-xl bg-surface border border-line hover:border-primary text-body hover:text-heading transition flex items-center justify-between gap-2 group shadow-sm"
                >
                  <span>{prompt}</span>
                  <CornerDownLeft className="w-3.5 h-3.5 text-muted group-hover:text-primary shrink-0" />
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
                    ? "bg-codeblock text-body border border-line"
                    : "bg-primary text-white shadow-sm"
                }`}
              >
                {isUser ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[85%] rounded-2xl p-4 space-y-3 text-xs leading-relaxed ${
                  isUser
                    ? "bg-primary text-white rounded-tr-sm shadow-sm"
                    : "bg-surface text-body border border-line rounded-tl-sm shadow-sm"
                }`}
              >
                {/* Router Badge if multi-agent */}
                {!isUser && msg.agent && (
                  <div className="flex items-center gap-2 pb-1 border-b border-line text-[10px] text-muted">
                    <span className="font-bold uppercase tracking-wider text-primary">
                      {msg.agent}
                    </span>
                    {msg.route_source && (
                      <span className="px-1.5 py-0.5 rounded bg-codeblock text-muted text-[9px] border border-line">
                        via {msg.route_source}
                      </span>
                    )}
                  </div>
                )}

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

                {/* Interactive Confirmation Chip */}
                {!isUser && msg.confirmation_chip && (
                  <div className="pt-2">
                    <button
                      onClick={() => handleSendMessage(msg.confirmation_chip!, "confirm")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-xs shadow-sm transition cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{msg.confirmation_chip}</span>
                    </button>
                  </div>
                )}

                {/* Follow-up Suggestion Chip */}
                {!isUser && msg.follow_up_chip && !msg.confirmation_chip && (
                  <div className="pt-1">
                    <button
                      onClick={() => handleSendMessage(msg.follow_up_chip!)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-subtle hover:bg-codeblock border border-line text-body hover:text-heading text-xs font-medium transition cursor-pointer"
                    >
                      <span>💡 {msg.follow_up_chip}</span>
                    </button>
                  </div>
                )}

                {/* Refusal notification if context insufficient */}
                {msg.is_sufficient === false && (
                  <div className="p-2.5 rounded-xl bg-warning-light border border-warning/25 text-warning text-[11px] flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                    <span>
                      Grounded Retrieval Note: The uploaded materials do not contain sufficient evidence to answer this query.
                    </span>
                  </div>
                )}

                {/* Structured Sources Section with Clickable Excerpt Preview */}
                {!isUser && msg.sources && msg.sources.length > 0 && (
                  <div className="pt-3 border-t border-line space-y-2">
                    <span className="text-[10px] uppercase font-bold text-muted flex items-center gap-1.5 tracking-wider">
                      <BookOpen className="w-3 h-3 text-primary" />
                      Sources:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {msg.sources.map((src, sIdx) => (
                        <button
                          key={sIdx}
                          type="button"
                          onClick={() =>
                            setSelectedCitation({
                              document_name: src.document_name,
                              page: src.page,
                              excerpt: src.excerpt,
                            })
                          }
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-subtle hover:bg-codeblock border border-line hover:border-primary/40 text-[11px] font-mono text-body transition cursor-pointer"
                        >
                          <span className="text-primary font-semibold">{src.document_name}</span>
                          <span className="text-muted">Page {src.page}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fallback Citation Badges if structured sources not available */}
                {!isUser && (!msg.sources || msg.sources.length === 0) && msg.citations && msg.citations.length > 0 && (
                  <div className="pt-2 border-t border-line flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] uppercase font-bold text-muted flex items-center gap-1">
                      <BookOpen className="w-3 h-3 text-primary" />
                      Sources:
                    </span>
                    {msg.citations.map((cite, cIdx) => (
                      <button
                        key={cIdx}
                        type="button"
                        onClick={() => handleCitationClick(cite, msg.sources)}
                        className="px-2 py-0.5 rounded-md bg-primary-light hover:opacity-90 border border-primary/25 text-[10px] font-mono text-primary transition cursor-pointer"
                      >
                        {cite}
                      </button>
                    ))}
                  </div>
                )}

                {/* Assistant message footer: speaker controls & tone tag */}
                {!isUser && (
                  <div className="pt-2 border-t border-line flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleMessageSpeech(idx, msg.clean_answer || msg.content)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg transition font-medium cursor-pointer ${
                          speakingIdx === idx
                            ? "bg-primary-light text-primary border border-primary/25"
                            : "text-muted hover:text-heading hover:bg-subtle"
                        }`}
                        title={speakingIdx === idx ? (isSpeechPaused ? "Resume speech" : "Pause speech") : "Listen to answer"}
                        aria-label="Listen to answer"
                      >
                        {speakingIdx === idx && !isSpeechPaused ? (
                          <>
                            <Pause className="w-3.5 h-3.5 text-primary animate-pulse" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3.5 h-3.5 text-primary" />
                            <span>{speakingIdx === idx ? "Resume" : "Listen"}</span>
                          </>
                        )}
                      </button>

                      {speakingIdx === idx && (
                        <button
                          type="button"
                          onClick={handleStopSpeech}
                          className="p-1 rounded-md text-muted hover:text-error hover:bg-error-light transition"
                          title="Stop speaking"
                          aria-label="Stop speaking"
                        >
                          <Square className="w-3 h-3 text-error" />
                        </button>
                      )}
                    </div>

                    {msg.tone && (
                      <div className="text-[10px] text-muted text-right">
                        Tone: <span className="capitalize text-body">{msg.tone}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Live Streaming Message Bubble */}
        {sending && (
          <div className="flex items-start gap-3.5">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-white shrink-0 shadow-sm">
              <Bot className="w-4 h-4" />
            </div>
            <div className="max-w-[85%] bg-surface text-body border border-line rounded-2xl rounded-tl-sm p-4 space-y-3 text-xs leading-relaxed shadow-sm">
              {streamingMeta.agent && (
                <div className="flex items-center gap-2 pb-1 border-b border-line text-[10px] text-muted">
                  <span className="font-bold uppercase tracking-wider text-primary">
                    {streamingMeta.agent}
                  </span>
                  {streamingMeta.route_source && (
                    <span className="px-1.5 py-0.5 rounded bg-codeblock text-muted text-[9px] border border-line">
                      via {streamingMeta.route_source}
                    </span>
                  )}
                </div>
              )}

              {streamingContent ? (
                <div className="whitespace-pre-wrap font-sans leading-relaxed">
                  {streamingContent}
                  <span className="inline-block w-1.5 h-3.5 bg-primary animate-pulse ml-0.5 align-middle" />
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted">
                  <RefreshCw className="w-4 h-4 text-primary animate-spin" />
                  <span className="text-xs">
                    Searching course chunks and routing request...
                  </span>
                </div>
              )}

              {/* Streaming Confirmation Chip */}
              {streamingMeta.chip?.confirmation_chip && (
                <div className="pt-2">
                  <button
                    onClick={() => handleSendMessage(streamingMeta.chip!.confirmation_chip!, "confirm")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-xs shadow-sm"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{streamingMeta.chip.confirmation_chip}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Citation Excerpt Modal Popover */}
      {selectedCitation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fadeIn">
          <div className="max-w-lg w-full rounded-2xl border border-line bg-surface p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2 text-primary font-semibold text-sm">
                <BookOpen className="w-4 h-4 text-primary" />
                <span>
                  {selectedCitation.document_name} &bull; Page {selectedCitation.page}
                </span>
              </div>
              <button
                onClick={() => setSelectedCitation(null)}
                className="p-1.5 rounded-lg text-muted hover:text-heading hover:bg-subtle transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 rounded-xl bg-codeblock border border-line text-xs text-body leading-relaxed font-mono">
              {selectedCitation.excerpt ? (
                <p className="italic">"{selectedCitation.excerpt}"</p>
              ) : (
                <p className="text-muted italic">
                  Citation grounded in page {selectedCitation.page} of uploaded document.
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setSelectedCitation(null)}
                className="px-4 py-1.5 rounded-xl bg-subtle hover:bg-codeblock text-heading border border-line text-xs font-semibold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="px-6 py-3 bg-error-light border-t border-error/25 text-error text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-error shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">{error}</p>
            {error.toLowerCase().includes("api key") && (
              <p className="text-muted text-[11px] leading-relaxed">
                Tip: Configure <code className="text-primary font-mono">GROQ_API_KEY</code>, <code className="text-primary font-mono">OPENROUTER_API_KEY</code>, or <code className="text-primary font-mono">GOOGLE_API_KEY</code> in your root <code className="text-primary font-mono">.env</code> file, then restart the development server.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Speech Recognition Error Banner */}
      {speechRecError && (
        <div className="px-6 py-2.5 bg-warning-light border-t border-warning/25 text-warning text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-warning shrink-0" />
            <span className="leading-tight">{speechRecError}</span>
          </div>
          <button
            type="button"
            onClick={resetTranscript}
            className="text-[11px] underline hover:text-heading font-medium ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Live Speech Recognition Listening Bar */}
      {isListening && (
        <div className="px-6 py-2.5 bg-error-light border-t border-error/25 text-error text-xs flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-error animate-ping" />
            <span className="font-semibold truncate">
              Listening... Speak your question for {MASCOT_NAME}
            </span>
          </div>
          <button
            type="button"
            onClick={stopListening}
            className="px-2.5 py-1 rounded-lg bg-error/15 hover:bg-error/25 text-error text-[11px] font-bold transition shrink-0 ml-2"
          >
            Stop Listening
          </button>
        </div>
      )}

      {/* Input Box Footer */}
      <div className="p-4 border-t border-line bg-surface space-y-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-end gap-2.5"
        >
          {/* Microphone Voice Button */}
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            className={`h-11 px-3.5 rounded-2xl border transition flex items-center gap-1.5 shrink-0 select-none ${
              isListening
                ? "bg-error-light border-error/50 text-error animate-pulse"
                : "bg-subtle border-line text-muted hover:text-heading hover:border-primary/40"
            }`}
            title={
              !isSpeechRecSupported
                ? "Speech recognition is not supported in this browser"
                : isListening
                ? "Click to stop dictating"
                : "Click to ask question with your voice"
            }
            aria-label={isListening ? "Stop microphone" : "Start microphone"}
          >
            {isListening ? (
              <>
                <MicOff className="w-4 h-4 text-error" />
                <span className="text-xs font-semibold hidden sm:inline">Listening</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span className="text-xs font-semibold hidden sm:inline">Voice</span>
              </>
            )}
          </button>

          <div className="flex-1 relative">
            <textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              placeholder={`Ask ${MASCOT_NAME} a question about your course materials... (Press Enter to send)`}
              rows={2}
              className="w-full bg-subtle border border-line rounded-2xl px-4 py-3 text-xs text-heading placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary focus:bg-surface resize-none transition"
            />
          </div>

          <button
            type="submit"
            disabled={sending || !inputMessage.trim()}
            className="h-11 px-5 rounded-2xl bg-primary hover:bg-primary-hover text-white font-bold text-xs transition shadow-sm flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <span>Ask</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>

        <p className="text-[10px] text-muted px-1 leading-normal">
          Dictate or type questions. Voice recognition uses browser speech services; questions are strictly grounded in your course documents.
        </p>
      </div>
    </div>
  );
};
