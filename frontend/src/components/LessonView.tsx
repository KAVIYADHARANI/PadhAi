import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  HelpCircle,
  Lightbulb,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  Video,
  XCircle,
} from "lucide-react";
import { MASCOT_NAME } from "../brand";
import { api, ApiError } from "../services/api";
import {
  Course,
  Lesson,
  LessonProgress,
  RoadmapItem,
  SourceReference,
} from "../types";

interface LessonViewProps {
  course: Course;
  roadmapItem: RoadmapItem;
  taskId: string;
  onBackToRoadmap: () => void;
  onLessonCompleted?: () => void;
}

type TabType =
  | "notes"
  | "examples"
  | "resources"
  | "videos"
  | "exercises"
  | "quiz"
  | "tutor"
  | "reflection";

export const LessonView: React.FC<LessonViewProps> = ({
  course,
  roadmapItem,
  taskId,
  onBackToRoadmap,
  onLessonCompleted,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [generating, setGenerating] = useState<boolean>(false);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [progress, setProgress] = useState<LessonProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("notes");

  // In-flight request guards to prevent duplicate concurrent calls
  const loadingTaskRef = useRef<string | null>(null);
  const generatingTaskRef = useRef<string | null>(null);

  // Exercise state: revealed hints and solutions
  const [revealedHints, setRevealedHints] = useState<Record<string, number>>({});
  const [revealedSolutions, setRevealedSolutions] = useState<Record<string, boolean>>({});

  // Quiz state: selected options & submitted answers
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState<boolean>(false);

  // Reflection state
  const [reflectionText, setReflectionText] = useState<string>("");
  const [savingReflection, setSavingReflection] = useState<boolean>(false);

  // Tutor chat inside lesson
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string; sources?: SourceReference[] }>
  >([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatLoading, setChatLoading] = useState<boolean>(false);

  // Active video embed modal
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  // Copied code feedback
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  const task = roadmapItem.tasks.find((t) => t.id === taskId);
  const taskTitle = task?.task || roadmapItem.title;

  const loadLessonData = useCallback(async () => {
    // Guard against simultaneous duplicate loads for this task
    if (loadingTaskRef.current === taskId || generatingTaskRef.current === taskId) {
      return;
    }
    loadingTaskRef.current = taskId;
    setLoading(true);
    setError(null);

    try {
      // 1. Try to fetch existing lesson
      try {
        const lessonRes = await api.getLesson(course.id, roadmapItem.id, taskId);
        setLesson(lessonRes);
        const progressRes = await api.getLessonProgress(course.id, roadmapItem.id, taskId);
        setProgress(progressRes);
        setReflectionText(progressRes.reflection || "");
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // Auto-generate on first open if not already generating
          if (generatingTaskRef.current === taskId) {
            return;
          }
          generatingTaskRef.current = taskId;
          setGenerating(true);
          try {
            const generatedRes = await api.generateLesson(course.id, roadmapItem.id, taskId, false);
            setLesson(generatedRes);
            const progressRes = await api.getLessonProgress(course.id, roadmapItem.id, taskId);
            setProgress(progressRes);
          } finally {
            generatingTaskRef.current = null;
            setGenerating(false);
          }
        } else {
          throw err;
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load study lesson. Please try again.");
      }
    } finally {
      loadingTaskRef.current = null;
      setLoading(false);
      setGenerating(false);
    }
  }, [course.id, roadmapItem.id, taskId]);

  useEffect(() => {
    loadLessonData();
  }, [loadLessonData]);

  const handleRegenerateLesson = async () => {
    if (generatingTaskRef.current === taskId) {
      return;
    }
    generatingTaskRef.current = taskId;
    setGenerating(true);
    setError(null);
    try {
      const regenerated = await api.generateLesson(course.id, roadmapItem.id, taskId, true);
      setLesson(regenerated);
      const progressRes = await api.getLessonProgress(course.id, roadmapItem.id, taskId);
      setProgress(progressRes);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to regenerate lesson notes.");
      }
    } finally {
      generatingTaskRef.current = null;
      setGenerating(false);
    }
  };

  const handleToggleSectionComplete = async (sectionId: string) => {
    if (!progress) return;
    const isCompleted = progress.sections_completed.includes(sectionId);
    try {
      const updated = await api.updateLessonProgress(course.id, roadmapItem.id, taskId, {
        section_id: sectionId,
        section_completed: !isCompleted,
      });
      setProgress(updated);
    } catch (err) {
      console.error("Failed to update section progress", err);
    }
  };

  const handleRevealHint = (exerciseId: string, totalHints: number) => {
    setRevealedHints((prev) => {
      const current = prev[exerciseId] || 0;
      return { ...prev, [exerciseId]: Math.min(current + 1, totalHints) };
    });
  };

  const handleToggleSolution = (exerciseId: string) => {
    setRevealedSolutions((prev) => ({ ...prev, [exerciseId]: !prev[exerciseId] }));
  };

  const handleMarkExerciseComplete = async (exerciseId: string) => {
    try {
      const updated = await api.updateLessonProgress(course.id, roadmapItem.id, taskId, {
        exercise_id: exerciseId,
        exercise_attempt: { solved: true, answer: "Solved by student" },
      });
      setProgress(updated);
    } catch (err) {
      console.error("Failed to record exercise attempt", err);
    }
  };

  const handleSelectQuizOption = (questionId: string, option: string) => {
    if (quizSubmitted) return;
    setQuizAnswers((prev) => ({ ...prev, [questionId]: option }));
  };

  const handleSubmitQuiz = async () => {
    if (!lesson) return;
    const questions = lesson.content.self_check_questions || [];
    let correctCount = 0;
    for (const q of questions) {
      if (quizAnswers[q.id] === q.answer) {
        correctCount += 1;
      }
    }
    const score = questions.length > 0 ? (correctCount / questions.length) * 100 : 0;
    setQuizSubmitted(true);

    try {
      const updated = await api.updateLessonProgress(course.id, roadmapItem.id, taskId, {
        quiz_score: score,
        quiz_completed: true,
      });
      setProgress(updated);
    } catch (err) {
      console.error("Failed to persist quiz score", err);
    }
  };

  const handleSaveReflection = async () => {
    setSavingReflection(true);
    try {
      const updated = await api.updateLessonProgress(course.id, roadmapItem.id, taskId, {
        reflection: reflectionText,
      });
      setProgress(updated);
    } catch (err) {
      console.error("Failed to save reflection", err);
    } finally {
      setSavingReflection(false);
    }
  };

  const handleToggleLessonComplete = async () => {
    if (!progress) return;
    const newStatus = !progress.completed;
    try {
      const updated = await api.updateLessonProgress(course.id, roadmapItem.id, taskId, {
        completed: newStatus,
        add_time_seconds: 300,
      });
      setProgress(updated);
      if (newStatus && onLessonCompleted) {
        onLessonCompleted();
      }
    } catch (err) {
      console.error("Failed to toggle lesson completion", err);
    }
  };

  const handleSendTutorChat = async (presetPrompt?: string) => {
    const textToSend = (presetPrompt || chatInput).trim();
    if (!textToSend || chatLoading) return;

    setChatMessages((prev) => [...prev, { role: "user", content: textToSend }]);
    if (!presetPrompt) setChatInput("");
    setChatLoading(true);

    try {
      const replyRes = await api.sendLessonChatMessage(course.id, roadmapItem.id, taskId, {
        message: textToSend,
        current_section_title: lesson?.content.sections?.[0]?.title,
      });
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: replyRes.clean_answer || replyRes.reply,
          sources: replyRes.sources,
        },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I could not connect right now. Please ensure course materials are ready and try again.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleCopyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(id);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Calculate completion percentage
  const totalSections = lesson?.content.sections?.length || 1;
  const completedSectionsCount = progress?.sections_completed?.length || 0;
  const sectionPercent = Math.min(100, Math.round((completedSectionsCount / totalSections) * 60));
  const exercisePercent = (progress?.exercises_completed && Object.keys(progress.exercises_completed).length > 0) ? 20 : 0;
  const quizPercent = progress?.quiz_completed ? 20 : 0;
  const overallPercent = progress?.completed ? 100 : sectionPercent + exercisePercent + quizPercent;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-fadeIn text-body">
      {/* Top Breadcrumb & Navigation Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
        <button
          onClick={onBackToRoadmap}
          className="inline-flex items-center gap-2 text-xs font-semibold text-muted hover:text-heading transition group w-fit min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4 transform group-hover:-translate-x-1 transition-transform" />
          <span>Back to Study Roadmap</span>
        </button>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleRegenerateLesson}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-surface border border-line text-body hover:text-heading hover:bg-subtle transition disabled:opacity-50 min-h-[44px]"
            title="Regenerate lesson notes and update research"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${generating ? "animate-spin" : ""}`} />
            <span>{generating ? "Regenerating..." : "Regenerate Notes"}</span>
          </button>

          <button
            onClick={handleToggleLessonComplete}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold transition border min-h-[44px] ${
              progress?.completed
                ? "bg-accent-light text-accent border-accent/30"
                : "bg-primary text-white border-primary hover:bg-primary-hover"
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{progress?.completed ? "Lesson Completed" : "Mark Complete"}</span>
          </button>
        </div>
      </div>

      {/* Hero Banner: Lesson Details & Progress */}
      <div className="bg-surface rounded-3xl p-6 sm:p-8 border border-line shadow-sm relative overflow-hidden space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[10px] font-extrabold uppercase px-3 py-1 rounded-full bg-primary-light text-primary border border-primary/25">
                Day {roadmapItem.day}
              </span>
              <span className="text-xs font-semibold text-muted">
                {roadmapItem.topic_name}
              </span>
              <span className="text-muted">•</span>
              <div className="flex items-center gap-1 text-xs text-muted">
                <Clock className="w-3.5 h-3.5 text-primary" />
                <span>~{task?.estimated_minutes || 30} mins allocated</span>
              </div>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-heading tracking-tight">
              {lesson?.title || taskTitle}
            </h1>

            <p className="text-xs sm:text-sm text-body max-w-3xl leading-relaxed">
              {lesson?.content.introduction ||
                "Deep-dive interactive study lesson with structured notes, verified resources, and practical exercises."}
            </p>
          </div>

          {/* Progress Card */}
          <div className="bg-subtle p-4 rounded-2xl border border-line shrink-0 w-full lg:w-64 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-muted">Lesson Mastery</span>
              <span className="font-extrabold text-primary">{overallPercent}%</span>
            </div>
            <div className="w-full bg-codeblock rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-[#4F46E5] to-[#0D9488] h-2 rounded-full transition-all duration-500"
                style={{ width: `${overallPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted pt-1">
              <span>{completedSectionsCount}/{totalSections} Sections</span>
              <span>{progress?.quiz_completed ? "Quiz Passed" : "Quiz Pending"}</span>
            </div>
          </div>
        </div>

        {/* Learning Objectives pills */}
        {roadmapItem.learning_objectives && roadmapItem.learning_objectives.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-line">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted">
              Target Learning Objectives
            </p>
            <div className="flex flex-wrap gap-2">
              {roadmapItem.learning_objectives.map((obj, i) => (
                <span
                  key={i}
                  className="text-xs px-3 py-1 rounded-xl bg-subtle border border-line text-body flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>{obj}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-line pb-1 overflow-x-auto scrollbar-none">
        {[
          { key: "notes", label: "Study Notes", icon: BookOpen },
          { key: "examples", label: "Worked Examples", icon: Lightbulb },
          { key: "resources", label: "Web Docs", icon: ExternalLink, count: lesson?.web_resources?.length },
          { key: "videos", label: "Video Tutorials", icon: Video, count: lesson?.youtube_resources?.length },
          { key: "exercises", label: "Practice Exercises", icon: Code2, count: lesson?.exercises?.length },
          { key: "quiz", label: "Knowledge Check", icon: HelpCircle },
          { key: "tutor", label: `Ask ${MASCOT_NAME}`, icon: MessageSquare },
          { key: "reflection", label: "Reflection", icon: Target },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as TabType)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition border shrink-0 min-h-[44px] ${
                isActive
                  ? "bg-primary-light border-primary/30 text-primary"
                  : "bg-transparent border-transparent text-muted hover:text-heading hover:bg-subtle"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {typeof tab.count === "number" && tab.count > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-codeblock text-body border border-line font-semibold">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Loading & Generating Banner */}
      {(loading || generating) && (
        <div className="bg-surface p-10 rounded-3xl border border-line flex flex-col items-center justify-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-primary-light border border-primary/25 flex items-center justify-center animate-spin">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-base font-bold text-heading">
              {generating ? "Generating Grounded Study Lesson..." : "Loading Lesson..."}
            </h3>
            <p className="text-xs text-muted max-w-sm">
              Retrieving your course materials, discovering real tutorials, and structuring step-by-step explanations.
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="p-4 rounded-2xl bg-error-light border border-error/25 text-error text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={loadLessonData}
            className="px-3 py-1 rounded-xl bg-surface border border-error/30 hover:bg-subtle text-error font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* Tab 1: Comprehensive Study Notes */}
      {!loading && !generating && lesson && activeTab === "notes" && (
        <div className="space-y-6">
          {/* Prerequisites callout */}
          {lesson.content.prerequisites && lesson.content.prerequisites.length > 0 && (
            <div className="p-4 rounded-2xl bg-subtle border border-line text-xs space-y-1.5">
              <p className="font-bold text-primary uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                Assumed Prerequisites
              </p>
              <ul className="list-disc list-inside space-y-1 text-body">
                {lesson.content.prerequisites.map((p, idx) => (
                  <li key={idx}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Step-by-Step Sections */}
          <div className="space-y-4">
            {lesson.content.sections.map((section, idx) => {
              const isDone = progress?.sections_completed?.includes(section.id);

              return (
                <div
                  key={section.id || idx}
                  className={`bg-surface rounded-2xl p-6 border transition-all duration-300 space-y-4 shadow-sm ${
                    isDone ? "border-accent/35 bg-accent-light/25" : "border-line"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-lg bg-primary-light border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {idx + 1}
                      </span>
                      <h2 className="text-base sm:text-lg font-bold text-heading">
                        {section.title}
                      </h2>
                    </div>

                    <button
                      onClick={() => handleToggleSectionComplete(section.id)}
                      className={`px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border w-fit ${
                        isDone
                          ? "bg-accent-light text-accent border-accent/25"
                          : "bg-subtle text-muted border-line hover:text-heading"
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{isDone ? "Read" : "Mark as Read"}</span>
                    </button>
                  </div>

                  {/* Section Content */}
                  <div className="text-xs sm:text-sm text-body leading-relaxed whitespace-pre-line space-y-3">
                    {section.content}
                  </div>

                  {/* Code snippet if present */}
                  {section.code_snippet && (
                    <div className="rounded-xl overflow-hidden border border-line bg-codeblock">
                      <div className="flex items-center justify-between px-3 py-1.5 bg-subtle border-b border-line text-[10px] text-muted">
                        <span className="font-mono">Code Snippet / Formula</span>
                        <button
                          onClick={() => handleCopyCode(section.code_snippet!, section.id)}
                          className="flex items-center gap-1 hover:text-heading"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{copiedIndex === section.id ? "Copied!" : "Copy"}</span>
                        </button>
                      </div>
                      <pre className="p-3 text-xs font-mono text-emerald-700 dark:text-emerald-300 overflow-x-auto">
                        {section.code_snippet}
                      </pre>
                    </div>
                  )}

                  {/* Key concepts */}
                  {section.key_concepts && section.key_concepts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {section.key_concepts.map((kc, i) => (
                        <span
                          key={i}
                          className="text-[10px] font-semibold px-2.5 py-0.5 rounded-md bg-subtle border border-line text-body"
                        >
                          {kc}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Citations */}
                  {section.source_citations && section.source_citations.length > 0 && (
                    <div className="pt-2 text-[11px] text-muted flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-muted">Source:</span>
                      {section.source_citations.map((c, i) => (
                        <span key={i} className="text-primary font-mono">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Key Terminology & Definitions */}
          {lesson.content.key_terms && lesson.content.key_terms.length > 0 && (
            <div className="bg-surface rounded-2xl p-6 border border-line space-y-4 shadow-sm">
              <h3 className="text-sm font-bold uppercase tracking-wider text-heading flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" />
                Key Terminology & Definitions
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {lesson.content.key_terms.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-subtle border border-line space-y-1"
                  >
                    <p className="text-xs font-bold text-primary font-mono">{item.term}</p>
                    <p className="text-xs text-body leading-relaxed">{item.definition}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Common Misconceptions */}
          {lesson.content.misconceptions && lesson.content.misconceptions.length > 0 && (
            <div className="bg-surface rounded-2xl p-6 border border-line space-y-4 shadow-sm">
              <h3 className="text-sm font-bold uppercase tracking-wider text-heading flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-warning" />
                Common Pitfalls & Misconceptions
              </h3>
              <div className="space-y-3">
                {lesson.content.misconceptions.map((m, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-subtle border border-line space-y-2 text-xs"
                  >
                    <div className="flex items-start gap-2 text-error">
                      <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">Misconception: </span>
                        <span>{m.misconception}</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 text-accent">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">Correction: </span>
                        <span>{m.correction}</span>
                      </div>
                    </div>
                    <p className="text-muted pl-6 leading-relaxed">{m.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lesson Summary & Takeaways */}
          <div className="bg-surface rounded-2xl p-6 border border-line space-y-4 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-heading flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-accent" />
              Lesson Summary & Takeaways
            </h3>
            <p className="text-xs sm:text-sm text-body leading-relaxed">
              {lesson.content.summary}
            </p>
            <ul className="space-y-1.5 pt-2">
              {lesson.content.takeaways.map((t, idx) => (
                <li key={idx} className="text-xs text-body flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 shrink-0" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Sources Provenance Drawer */}
          {lesson.sources && lesson.sources.length > 0 && (
            <div className="p-4 rounded-2xl bg-subtle border border-line text-xs space-y-2">
              <p className="font-bold text-muted text-[11px] uppercase tracking-wider">
                Grounded Course Document Sources
              </p>
              <div className="flex flex-wrap gap-2">
                {lesson.sources.map((s, idx) => (
                  <span
                    key={idx}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-surface border border-line text-body"
                  >
                    {s.document_name} • Page {s.page}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Worked Examples */}
      {!loading && !generating && lesson && activeTab === "examples" && (
        <div className="space-y-4">
          {lesson.content.worked_examples.map((example, idx) => (
            <div
              key={idx}
              className="bg-surface rounded-2xl p-6 border border-line space-y-4 shadow-sm"
            >
              <div className="flex items-center gap-2 pb-2 border-b border-line">
                <Lightbulb className="w-4 h-4 text-primary" />
                <h3 className="text-base font-bold text-heading">Example {idx + 1}</h3>
              </div>

              <div className="p-4 rounded-xl bg-subtle border border-line text-xs sm:text-sm text-heading">
                <p className="font-semibold text-muted text-[11px] uppercase mb-1">
                  Problem Statement
                </p>
                <p>{example.problem}</p>
              </div>

              <div className="space-y-2 text-xs sm:text-sm">
                <p className="font-semibold text-muted text-[11px] uppercase">
                  Step-by-Step Solution
                </p>
                <div className="space-y-2">
                  {example.step_by_step_solution.map((step, sIdx) => (
                    <div
                      key={sIdx}
                      className="flex items-start gap-3 p-3 rounded-xl bg-subtle border border-line"
                    >
                      <span className="w-5 h-5 rounded-full bg-primary-light text-primary border border-primary/25 flex items-center justify-center text-[10px] font-bold shrink-0">
                        {sIdx + 1}
                      </span>
                      <span className="text-body leading-relaxed">{step}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-accent-light border border-accent/25 text-xs text-accent">
                <span className="font-bold">Why this works: </span>
                <span>{example.explanation}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 3: Curated Web Resources */}
      {!loading && !generating && lesson && activeTab === "resources" && (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Authoritative documentation, official references, and technical articles curated for this lesson.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {lesson.web_resources.map((res, idx) => (
              <div
                key={idx}
                className="bg-surface rounded-2xl p-5 border border-line hover:border-primary/40 transition flex flex-col justify-between space-y-4 shadow-sm"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-primary-light text-primary border border-primary/25">
                      {res.domain}
                    </span>
                    <span className="text-[10px] text-muted font-semibold uppercase">
                      {res.level}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-heading line-clamp-2">{res.title}</h3>

                  <p className="text-xs text-body leading-relaxed line-clamp-3">
                    {res.snippet}
                  </p>
                </div>

                <div className="space-y-3 pt-3 border-t border-line">
                  <div className="text-[11px] text-muted">
                    <span className="text-primary font-semibold">Objective: </span>
                    <span>{res.learning_objective}</span>
                  </div>

                  <a
                    href={res.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl text-xs font-bold bg-subtle border border-line hover:border-primary text-heading transition"
                  >
                    <span>Read Documentation</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: YouTube Video Tutorials */}
      {!loading && !generating && lesson && activeTab === "videos" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-muted">
              Verified video tutorials and visual walkthroughs covering this lesson.
            </p>
            <a
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                `${roadmapItem.topic_name} ${taskTitle} tutorial`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
            >
              <span>Search YouTube Directly</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {lesson.youtube_resources.length === 0 ? (
            <div className="bg-surface p-8 rounded-2xl border border-line text-center space-y-3 shadow-sm">
              <Video className="w-8 h-8 text-muted mx-auto" />
              <p className="text-sm font-bold text-heading">No Direct API Videos Configured</p>
              <p className="text-xs text-muted max-w-md mx-auto">
                To enable automatic in-app video embeds, add your YouTube Data API v3 key in <code className="text-primary">.env</code>. You can still search verified tutorials directly:
              </p>
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                  `${roadmapItem.topic_name} ${taskTitle} tutorial`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-primary text-white hover:bg-primary-hover transition"
              >
                <span>Find Tutorials on YouTube</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {lesson.youtube_resources.map((video, idx) => (
                <div
                  key={idx}
                  className="bg-surface rounded-2xl overflow-hidden border border-line hover:border-primary/40 transition flex flex-col justify-between shadow-sm"
                >
                  <div className="relative group cursor-pointer" onClick={() => setActiveVideoId(video.video_id)}>
                    <img
                      src={video.thumbnail_url}
                      alt={video.title}
                      className="w-full h-40 object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-80 group-hover:opacity-100 transition">
                      <div className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                        <Play className="w-5 h-5 ml-0.5 fill-current" />
                      </div>
                    </div>
                    <span className="absolute bottom-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded bg-black/80 text-white">
                      {video.duration}
                    </span>
                  </div>

                  <div className="p-4 space-y-2 flex-1 flex flex-col justify-between">
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-muted">{video.channel_name}</p>
                      <h3 className="text-xs sm:text-sm font-bold text-heading line-clamp-2">
                        {video.title}
                      </h3>
                      <p className="text-[11px] text-muted line-clamp-2">
                        {video.relevance_reason}
                      </p>
                    </div>

                    <button
                      onClick={() => setActiveVideoId(video.video_id)}
                      className="w-full py-1.5 rounded-xl text-xs font-bold bg-subtle border border-line hover:border-primary text-heading transition mt-2"
                    >
                      Watch Tutorial
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Video Modal Player */}
          {activeVideoId && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
              <div className="w-full max-w-4xl bg-surface rounded-3xl overflow-hidden border border-line shadow-2xl space-y-4 p-4">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-sm font-bold text-heading">Video Tutorial Player</h3>
                  <button
                    onClick={() => setActiveVideoId(null)}
                    className="p-1.5 rounded-xl hover:bg-subtle text-muted hover:text-heading"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
                <div className="relative aspect-video rounded-2xl overflow-hidden bg-black">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${activeVideoId}?autoplay=1`}
                    title="YouTube tutorial player"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full h-full border-0"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Practical Practice Exercises */}
      {!loading && !generating && lesson && activeTab === "exercises" && (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Apply your knowledge with tailored practical exercises. Reveal progressive hints as needed.
          </p>

          <div className="space-y-4">
            {lesson.content.exercises.map((exercise, idx) => {
              const currentHints = revealedHints[exercise.id] || 0;
              const showSolution = revealedSolutions[exercise.id] || false;
              const isAttempted = progress?.exercises_completed?.[exercise.id]?.solved;

              return (
                <div
                  key={exercise.id || idx}
                  className="bg-surface rounded-2xl p-6 border border-line space-y-4 shadow-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Code2 className="w-4 h-4 text-primary" />
                      <h3 className="text-sm sm:text-base font-bold text-heading">
                        Exercise {idx + 1}: {exercise.exercise_type.toUpperCase()}
                      </h3>
                      <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-codeblock text-body border border-line">
                        {exercise.difficulty}
                      </span>
                    </div>

                    <button
                      onClick={() => handleMarkExerciseComplete(exercise.id)}
                      className={`px-3 py-1 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition ${
                        isAttempted
                          ? "bg-accent-light text-accent border-accent/25"
                          : "bg-subtle text-body border-line hover:text-heading"
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{isAttempted ? "Attempted" : "Mark as Solved"}</span>
                    </button>
                  </div>

                  <p className="text-xs sm:text-sm text-heading leading-relaxed font-medium">
                    {exercise.prompt}
                  </p>

                  {/* Progressive Hints */}
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      {currentHints < exercise.hints.length && (
                        <button
                          onClick={() => handleRevealHint(exercise.id, exercise.hints.length)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-primary-light border border-primary/25 text-primary hover:opacity-90 transition"
                        >
                          <Lightbulb className="w-3.5 h-3.5" />
                          <span>Get Hint {currentHints + 1} of {exercise.hints.length}</span>
                        </button>
                      )}

                      <button
                        onClick={() => handleToggleSolution(exercise.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-subtle border border-line text-body hover:text-heading transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>{showSolution ? "Hide Solution" : "Reveal Solution"}</span>
                      </button>
                    </div>

                    {/* Render Revealed Hints */}
                    {exercise.hints.slice(0, currentHints).map((hint, hIdx) => (
                      <div
                        key={hIdx}
                        className="p-3 rounded-xl bg-warning-light border border-warning/25 text-xs text-warning flex items-start gap-2"
                      >
                        <Lightbulb className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">Hint {hIdx + 1}: </span>
                          <span>{hint}</span>
                        </div>
                      </div>
                    ))}

                    {/* Render Solution */}
                    {showSolution && (
                      <div className="p-4 rounded-xl bg-accent-light border border-accent/25 space-y-2 text-xs text-accent">
                        <p className="font-bold">Official Solution:</p>
                        <pre className="font-mono bg-codeblock text-heading border border-line p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                          {exercise.solution}
                        </pre>
                        <p className="text-[11px] opacity-90">{exercise.explanation}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 6: Knowledge Check (Quiz) */}
      {!loading && !generating && lesson && activeTab === "quiz" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-heading">Lesson Knowledge Check</h2>
              <p className="text-xs text-muted">
                Answer these questions to assess your understanding of the lesson objectives.
              </p>
            </div>

            {progress?.quiz_score !== null && progress?.quiz_score !== undefined && (
              <div className="px-3 py-1 rounded-xl bg-primary-light border border-primary/25 text-xs font-bold text-primary">
                Score: {progress.quiz_score}%
              </div>
            )}
          </div>

          <div className="space-y-4">
            {lesson.content.self_check_questions.map((q, idx) => {
              const selected = quizAnswers[q.id];
              const isCorrect = selected === q.answer;

              return (
                <div
                  key={q.id || idx}
                  className="bg-surface rounded-2xl p-6 border border-line space-y-4 shadow-sm"
                >
                  <p className="text-xs sm:text-sm font-semibold text-heading">
                    {idx + 1}. {q.question}
                  </p>

                  <div className="grid grid-cols-1 gap-2">
                    {q.options.map((opt, oIdx) => {
                      const isOptionSelected = selected === opt;
                      let optionStyle =
                        "bg-subtle border-line hover:border-primary/40 text-body";

                      if (quizSubmitted) {
                        if (opt === q.answer) {
                          optionStyle = "bg-accent-light border-accent text-heading font-semibold";
                        } else if (isOptionSelected && !isCorrect) {
                          optionStyle = "bg-error-light border-error text-heading font-semibold";
                        }
                      } else if (isOptionSelected) {
                        optionStyle = "bg-primary-light border-primary text-heading font-semibold";
                      }

                      return (
                        <button
                          key={oIdx}
                          onClick={() => handleSelectQuizOption(q.id, opt)}
                          className={`text-left p-3 rounded-xl border text-xs font-medium transition flex items-center justify-between ${optionStyle}`}
                        >
                          <span>{opt}</span>
                          {quizSubmitted && opt === q.answer && (
                            <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Feedback on submit */}
                  {quizSubmitted && (
                    <div
                      className={`p-3 rounded-xl text-xs border ${
                        isCorrect
                          ? "bg-accent-light border-accent/25 text-accent"
                          : "bg-error-light border-error/25 text-error"
                      }`}
                    >
                      <p className="font-bold">{isCorrect ? "Correct!" : "Not quite."}</p>
                      <p className="text-[11px] mt-0.5 opacity-95">{q.explanation}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!quizSubmitted ? (
            <button
              onClick={handleSubmitQuiz}
              disabled={Object.keys(quizAnswers).length === 0}
              className="w-full py-3 rounded-xl font-bold text-xs bg-primary hover:bg-primary-hover text-white transition disabled:opacity-50"
            >
              Submit Knowledge Check
            </button>
          ) : (
            <button
              onClick={() => {
                setQuizSubmitted(false);
                setQuizAnswers({});
              }}
              className="w-full py-3 rounded-xl font-bold text-xs bg-subtle border border-line hover:bg-codeblock text-heading transition"
            >
              Retry Knowledge Check
            </button>
          )}
        </div>
      )}

      {/* Tab 7: Ask Companion Tutor (Lesson Aware) */}
      {!loading && !generating && lesson && activeTab === "tutor" && (
        <div className="bg-surface rounded-3xl p-6 border border-line space-y-4 shadow-sm">
          <div className="flex items-center gap-2 pb-3 border-b border-line">
            <Sparkles className="w-4 h-4 text-primary" />
            <div>
              <h2 className="text-sm font-bold text-heading">Ask {MASCOT_NAME} for this Lesson</h2>
              <p className="text-[11px] text-muted">
                Grounded in your course documents, lesson notes, and current study goals.
              </p>
            </div>
          </div>

          {/* Quick prompt chips */}
          <div className="flex flex-wrap gap-2 pt-1">
            {[
              "Explain this like I'm a beginner",
              "Give me a real-world example",
              "Walk me through this step by step",
              "What is the most common mistake here?",
              "Summarize the key takeaway",
            ].map((chip, idx) => (
              <button
                key={idx}
                onClick={() => handleSendTutorChat(chip)}
                className="text-[11px] px-3 py-1.5 rounded-xl bg-subtle border border-line text-body hover:text-heading hover:border-primary/40 transition"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Chat Messages Log */}
          <div className="min-h-[240px] max-h-[380px] overflow-y-auto space-y-3 p-3 rounded-2xl bg-subtle border border-line">
            {chatMessages.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-center text-xs text-muted space-y-1">
                <MessageSquare className="w-8 h-8 text-muted/60 mb-1" />
                <p className="font-semibold text-heading">Ready to help you understand {lesson.title}</p>
                <p>Click a suggestion above or ask any question about this lesson.</p>
              </div>
            ) : (
              chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${
                    msg.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary text-white rounded-br-none"
                        : "bg-surface border border-line text-body rounded-bl-none shadow-sm"
                    }`}
                  >
                    <p className="whitespace-pre-line">{msg.content}</p>

                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-line text-[10px] text-primary">
                        <span>Grounded in: </span>
                        {msg.sources.map((s, sIdx) => (
                          <span key={sIdx} className="font-mono">
                            [{s.document_name} p.{s.page}]
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {chatLoading && (
              <div className="flex items-center gap-2 text-xs text-muted p-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
                <span>{MASCOT_NAME} is thinking...</span>
              </div>
            )}
          </div>

          {/* Input Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendTutorChat();
            }}
            className="flex items-center gap-2 pt-2"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={`Ask a question about ${lesson.title}...`}
              disabled={chatLoading}
              className="flex-1 px-4 py-2.5 rounded-xl bg-subtle border border-line text-xs sm:text-sm text-heading placeholder:text-muted focus:outline-none focus:border-primary focus:bg-surface transition"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || chatLoading}
              className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white transition disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {/* Tab 8: Reflection & Completion */}
      {!loading && !generating && lesson && activeTab === "reflection" && (
        <div className="bg-surface rounded-3xl p-6 sm:p-8 border border-line space-y-6 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-heading">
              Lesson Reflection & Self-Assessment
            </h2>
            <p className="text-xs text-muted">
              Summarizing what you learned in your own words solidifies long-term memory retention.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-body">
              What was the most important concept or insight you learned today?
            </label>
            <textarea
              rows={4}
              value={reflectionText}
              onChange={(e) => setReflectionText(e.target.value)}
              placeholder="e.g., In-order traversal of a BST always yields sorted keys because left subtree is always smaller than the root..."
              className="w-full p-4 rounded-2xl bg-subtle border border-line text-xs sm:text-sm text-heading placeholder:text-muted focus:outline-none focus:border-primary focus:bg-surface transition"
            />
            <div className="flex justify-end">
              <button
                onClick={handleSaveReflection}
                disabled={savingReflection}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-subtle hover:bg-codeblock text-heading border border-line transition"
              >
                {savingReflection ? "Saving..." : "Save Reflection"}
              </button>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-subtle border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-heading">Complete Lesson Milestone</h3>
              <p className="text-xs text-muted">
                Marking this lesson complete updates your course roadmap and topic mastery progress.
              </p>
            </div>

            <button
              onClick={handleToggleLessonComplete}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition border flex items-center justify-center gap-2 ${
                progress?.completed
                  ? "bg-accent-light text-accent border-accent/25"
                  : "bg-primary text-white border-transparent hover:bg-primary-hover"
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{progress?.completed ? "Completed! Mark Unfinished" : "Mark Lesson Complete"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
