import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  HelpCircle,
  Loader2,
  RotateCcw,
  Sparkles,
  Trophy,
  XCircle,
} from "lucide-react";
import { api } from "../services/api";
import { AttemptResult, QuizQuestion, Topic } from "../types";
import { PRODUCT_NAME } from "../brand";

interface QuizViewProps {
  courseId: number;
  initialTopicId?: number | null;
  onViewProgress?: () => void;
}

export const QuizView: React.FC<QuizViewProps> = ({
  courseId,
  initialTopicId = null,
  onViewProgress,
}) => {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(initialTopicId);
  const [loadingTopics, setLoadingTopics] = useState(true);

  // Active Quiz State
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [currentResult, setCurrentResult] = useState<AttemptResult | null>(null);

  // Quiz Scorecard Summary
  const [quizComplete, setQuizComplete] = useState(false);
  const [history, setHistory] = useState<AttemptResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reprocessingTopics, setReprocessingTopics] = useState(false);

  const handleReprocessTopics = async () => {
    try {
      setReprocessingTopics(true);
      setError(null);
      const updated = await api.reprocessCourseTopics(courseId);
      setTopics(updated);
      if (updated.length > 0) {
        setSelectedTopicId(updated[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to re-extract topics.");
    } finally {
      setReprocessingTopics(false);
    }
  };

  // Load course topics on mount
  useEffect(() => {
    let isMounted = true;
    async function loadTopics() {
      try {
        setLoadingTopics(true);
        setError(null);
        const data = await api.getCourseTopics(courseId);
        if (isMounted) {
          setTopics(data);
          if (data.length > 0 && !selectedTopicId) {
            setSelectedTopicId(data[0].id);
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load course topics.");
        }
      } finally {
        if (isMounted) {
          setLoadingTopics(false);
        }
      }
    }
    loadTopics();
    return () => {
      isMounted = false;
    };
  }, [courseId]);

  // If initialTopicId changes prop, update
  useEffect(() => {
    if (initialTopicId) {
      setSelectedTopicId(initialTopicId);
    }
  }, [initialTopicId]);

  const handleStartQuiz = async (topicIdToUse?: number) => {
    const tid = topicIdToUse ?? selectedTopicId;
    if (!tid) return;

    try {
      setLoadingQuiz(true);
      setError(null);
      setCurrentResult(null);
      setHistory([]);
      setQuizComplete(false);
      setCurrentIndex(0);
      setSelectedOption(null);

      const res = await api.generateQuiz(courseId, tid, 5);
      if (res.questions.length === 0) {
        setError("No questions could be generated. Please ensure course documents are uploaded.");
        return;
      }
      setQuestions(res.questions);
      setQuestionStartTime(Date.now());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start quiz.");
    } finally {
      setLoadingQuiz(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!selectedOption || submitting || !questions[currentIndex]) return;

    const currentQ = questions[currentIndex];
    const elapsedMs = Math.max(500, Date.now() - questionStartTime);

    try {
      setSubmitting(true);
      setError(null);
      const result = await api.submitAttempt({
        question_id: currentQ.id,
        selected_answer: selectedOption,
        time_ms: elapsedMs,
      });

      setCurrentResult(result);
      setHistory((prev) => [...prev, result]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit answer.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleNextQuestion = () => {
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedOption(null);
      setCurrentResult(null);
      setQuestionStartTime(Date.now());
    } else {
      setQuizComplete(true);
    }
  };

  const currentQ = questions[currentIndex];
  const selectedTopic = topics.find((t) => t.id === selectedTopicId);

  // Render 1: Loading Topics
  if (loadingTopics) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-[#64748B] space-y-3">
        <Loader2 className="w-8 h-8 text-[#4F46E5] animate-spin" />
        <p className="text-xs font-medium">Loading course syllabus topics...</p>
      </div>
    );
  }

  // Render 2: No topics available yet
  if (topics.length === 0) {
    return (
      <div className="bg-white border border-[#E2E8F0] shadow-card rounded-2xl p-8 text-center max-w-xl mx-auto space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-[#EEF2FF] border border-indigo-100 text-[#4F46E5] flex items-center justify-center mx-auto">
          <HelpCircle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-[#0F172A]">No Topics Available Yet</h3>
        <p className="text-xs text-[#64748B] leading-relaxed">
          Upload PDF textbooks or study materials in the Knowledge Base tab. {PRODUCT_NAME} will segment them
          into syllabus topics and prepare interactive practice quizzes for you.
        </p>
      </div>
    );
  }

  // Render 3: Completed Scorecard
  if (quizComplete) {
    const totalCount = history.length;
    const correctCount = history.filter((h) => h.correct).length;
    const accuracy = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
    const latestMastery =
      history.length > 0 ? Math.round(history[history.length - 1].new_mastery_score * 100) : 0;

    return (
      <div className="bg-white border border-[#E2E8F0] shadow-card rounded-2xl p-8 max-w-2xl mx-auto space-y-6 text-center animate-in fade-in duration-200">
        <div className="w-16 h-16 rounded-2xl bg-[#EEF2FF] border border-indigo-100 text-[#4F46E5] flex items-center justify-center mx-auto">
          <Trophy className="w-8 h-8" />
        </div>

        <div>
          <span className="text-xs font-bold text-[#4F46E5] uppercase tracking-wider">
            Quiz Completed
          </span>
          <h2 className="text-2xl font-extrabold text-[#0F172A] mt-1">
            {selectedTopic?.name ?? "Topic Assessment"}
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-4 bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0]">
          <div>
            <p className="text-[11px] text-[#64748B] font-semibold uppercase">Score</p>
            <p className="text-2xl font-black text-[#0F172A]">
              {correctCount} / {totalCount}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-[#64748B] font-semibold uppercase">Accuracy</p>
            <p className="text-2xl font-black text-[#0D9488]">{accuracy}%</p>
          </div>
          <div>
            <p className="text-[11px] text-[#64748B] font-semibold uppercase">Topic Mastery</p>
            <p className="text-2xl font-black text-[#4F46E5]">{latestMastery}%</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            onClick={() => handleStartQuiz()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-btn bg-[#4F46E5] hover:bg-[#4338CA] text-white text-xs font-bold transition shadow-sm min-h-[44px]"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Practice Topic Again</span>
          </button>
          {onViewProgress && (
            <button
              onClick={onViewProgress}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-btn bg-white hover:bg-[#F8FAFC] text-[#334155] text-xs font-semibold transition border border-[#E2E8F0] min-h-[44px]"
            >
              <span>View Course Mastery</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Group topics by module
  const groupedTopics = topics.reduce<Record<string, Topic[]>>((acc, t) => {
    const mod = t.module_name || "General Concepts";
    if (!acc[mod]) acc[mod] = [];
    acc[mod].push(t);
    return acc;
  }, {});

  // Render 4: Topic Selection Screen (before quiz start)
  if (questions.length === 0) {
    return (
      <div className="bg-white border border-[#E2E8F0] shadow-card rounded-2xl p-6 sm:p-8 max-w-2xl mx-auto space-y-6 animate-in fade-in duration-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EEF2FF] border border-indigo-100 text-[#4F46E5] flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#0F172A]">Select Topic for Practice Quiz</h2>
              <p className="text-xs text-[#64748B]">
                Questions are strictly grounded in your course materials.
              </p>
            </div>
          </div>

          <button
            onClick={handleReprocessTopics}
            disabled={reprocessingTopics}
            title="Re-extract syllabus topics from uploaded documents"
            className="text-xs font-semibold text-[#64748B] hover:text-[#4F46E5] flex items-center gap-1.5 p-2 rounded-xl hover:bg-[#F1F5F9] transition disabled:opacity-50 min-h-[44px]"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${reprocessingTopics ? "animate-spin" : ""}`} />
            <span>Re-extract Topics</span>
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-[#FFF1F2] border border-rose-200 text-[#E11D48] text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          <label className="text-xs font-semibold text-[#0F172A] block">Syllabus Curriculum Modules</label>
          <div className="space-y-4 max-h-[380px] overflow-y-auto pr-1">
            {Object.entries(groupedTopics).map(([moduleName, moduleTopics]) => (
              <div key={moduleName} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#4F46E5]">
                    {moduleName}
                  </span>
                  <div className="h-px bg-[#E2E8F0] flex-1" />
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {moduleTopics.map((t) => {
                    const isSelected = selectedTopicId === t.id;
                    const pagesText = t.pages && t.pages.length > 0 ? ` • Pages ${t.pages.join(", ")}` : "";
                    const chunkText = t.chunks_count ? `${t.chunks_count} source sections` : "1 section";

                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTopicId(t.id)}
                        className={`p-4 rounded-xl text-left text-xs transition border flex flex-col gap-2 min-h-[44px] ${
                          isSelected
                            ? "bg-[#EEF2FF] border-[#4F46E5] text-[#0F172A] shadow-card ring-1 ring-[#4F46E5]"
                            : "bg-white hover:bg-[#F8FAFC] hover:-translate-y-0.5 hover:shadow-card-hover border-[#E2E8F0] text-[#334155]"
                        }`}
                      >
                        <div className="flex items-start justify-between w-full gap-2">
                          <span
                            className="font-bold text-[#0F172A] text-sm leading-snug line-clamp-2"
                            title={t.name}
                          >
                            {t.name}
                          </span>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-[#4F46E5] shrink-0 mt-0.5" />
                          )}
                        </div>

                        {t.learning_objective && (
                          <p className="text-xs text-[#64748B] leading-relaxed font-normal">
                            {t.learning_objective}
                          </p>
                        )}

                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-pill bg-[#F1F5F9] text-[#64748B] text-[11px] font-medium border border-[#E2E8F0]">
                            {chunkText}{pagesText}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={() => handleStartQuiz()}
          disabled={!selectedTopicId || loadingQuiz}
          className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-btn bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white text-xs font-bold transition shadow-sm min-h-[44px]"
        >
          {loadingQuiz ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Generating Grounded Questions...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Start 5-Question Quiz</span>
            </>
          )}
        </button>
      </div>
    );
  }

  // Render 5: Active Quiz taking (one question at a time)
  return (
    <div className="bg-white border border-[#E2E8F0] shadow-card rounded-2xl p-6 sm:p-8 max-w-3xl mx-auto space-y-6 animate-in fade-in duration-200">
      {/* Quiz Progress Header */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4">
        <div>
          <span className="text-[11px] font-bold text-[#4F46E5] uppercase tracking-wider">
            {selectedTopic?.name}
          </span>
          <h2 className="text-sm font-semibold text-[#0F172A]">
            Question {currentIndex + 1} of {questions.length}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium px-2.5 py-0.5 rounded-pill bg-[#F1F5F9] border border-[#E2E8F0] text-[#64748B]">
            Difficulty {currentQ.difficulty.toFixed(1)}x
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-[#FFF1F2] border border-rose-200 text-[#E11D48] text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Question Stem - Neutral Language */}
      <div className="bg-[#F8FAFC] p-5 rounded-xl border border-[#E2E8F0]">
        <p className="text-base sm:text-lg font-semibold text-[#0F172A] leading-relaxed">
          {currentQ.stem}
        </p>
      </div>

      {/* Options List */}
      <div className="space-y-3">
        {currentQ.options.map((opt, optIdx) => {
          const isSelected = selectedOption === opt;
          const isSubmitted = currentResult !== null;
          const isCorrectAnswer = isSubmitted && opt === currentResult.answer;
          const isUserChoiceWrong = isSubmitted && isSelected && !currentResult.correct;

          let btnStyles =
            "bg-white hover:bg-[#F8FAFC] hover:border-slate-300 border-[#E2E8F0] text-[#334155]";

          if (isSubmitted) {
            if (isCorrectAnswer) {
              btnStyles = "bg-[#F0FDFA] border-[#0D9488] text-[#0F172A] font-bold";
            } else if (isUserChoiceWrong) {
              btnStyles = "bg-[#FFF1F2] border-[#E11D48] text-[#0F172A] font-bold";
            } else {
              btnStyles = "bg-[#F8FAFC] border-[#E2E8F0] text-[#94A3B8]";
            }
          } else if (isSelected) {
            btnStyles = "bg-[#EEF2FF] border-[#4F46E5] text-[#0F172A] font-semibold ring-1 ring-[#4F46E5]";
          }

          return (
            <button
              key={optIdx}
              onClick={() => !isSubmitted && setSelectedOption(opt)}
              disabled={isSubmitted || submitting}
              className={`w-full flex items-center justify-between p-4 rounded-xl text-left text-xs transition border min-h-[44px] ${btnStyles}`}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-lg bg-[#F1F5F9] text-[#334155] font-bold flex items-center justify-center text-[11px] shrink-0 border border-[#E2E8F0]">
                  {String.fromCharCode(65 + optIdx)}
                </span>
                <span className="leading-relaxed">{opt}</span>
              </div>

              {isSubmitted && isCorrectAnswer && (
                <CheckCircle2 className="w-4 h-4 text-[#0D9488] shrink-0 ml-2" />
              )}
              {isSubmitted && isUserChoiceWrong && (
                <XCircle className="w-4 h-4 text-[#E11D48] shrink-0 ml-2" />
              )}
            </button>
          );
        })}
      </div>

      {/* Graded Feedback Panel (Appears after submission) */}
      {currentResult && (
        <div
          className={`p-5 rounded-xl border text-xs space-y-3 animate-in fade-in duration-200 ${
            currentResult.correct
              ? "bg-[#F0FDFA] border-teal-200 text-[#0F172A]"
              : "bg-[#FFF1F2] border-rose-200 text-[#0F172A]"
          }`}
        >
          <div className="flex items-center justify-between font-bold">
            <div className="flex items-center gap-2">
              {currentResult.correct ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-[#0D9488]" />
                  <span className="text-[#0D9488]">Correct!</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-[#E11D48]" />
                  <span className="text-[#E11D48]">Incorrect</span>
                </>
              )}
            </div>

            <span className="text-xs font-semibold text-[#64748B]">
              New Topic Mastery: {Math.round(currentResult.new_mastery_score * 100)}%
            </span>
          </div>

          <p className="text-[#334155] leading-relaxed font-normal">
            {currentResult.explanation}
          </p>

          {currentResult.source_chunk_ids.length > 0 && (
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-[10px] uppercase font-bold text-[#64748B]">Grounded in:</span>
              {currentResult.source_chunk_ids.map((cid) => (
                <span
                  key={cid}
                  className="px-2 py-0.5 rounded-pill bg-white text-[#334155] text-[11px] font-mono border border-[#E2E8F0]"
                >
                  chunk #{cid}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action Footer */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {!currentResult ? (
          <button
            onClick={handleSubmitAnswer}
            disabled={!selectedOption || submitting}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-btn bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white text-xs font-bold transition shadow-sm min-h-[44px]"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Grading Answer...</span>
              </>
            ) : (
              <span>Submit Answer</span>
            )}
          </button>
        ) : (
          <button
            onClick={handleNextQuestion}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-btn bg-[#4F46E5] hover:bg-[#4338CA] text-white text-xs font-bold transition shadow-sm min-h-[44px]"
          >
            <span>
              {currentIndex + 1 < questions.length ? "Next Question" : "Complete Quiz"}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
