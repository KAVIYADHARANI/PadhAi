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
      <div className="flex flex-col items-center justify-center p-12 text-slate-400 space-y-3">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
        <p className="text-xs">Loading course syllabus topics...</p>
      </div>
    );
  }

  // Render 2: No topics available yet
  if (topics.length === 0) {
    return (
      <div className="glass-panel rounded-3xl p-8 text-center max-w-xl mx-auto space-y-4">
        <HelpCircle className="w-12 h-12 text-slate-500 mx-auto" />
        <h3 className="text-lg font-bold text-white">No Topics Available Yet</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
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
      <div className="glass-panel rounded-3xl p-8 max-w-2xl mx-auto space-y-6 text-center animate-fadeIn">
        <div className="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center mx-auto">
          <Trophy className="w-8 h-8" />
        </div>

        <div>
          <span className="text-xs font-bold text-brand-400 uppercase tracking-wider">
            Quiz Completed
          </span>
          <h2 className="text-2xl font-extrabold text-white mt-1">
            {selectedTopic?.name ?? "Topic Assessment"}
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
          <div>
            <p className="text-[11px] text-slate-400 font-semibold uppercase">Score</p>
            <p className="text-2xl font-black text-white">
              {correctCount} / {totalCount}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-400 font-semibold uppercase">Accuracy</p>
            <p className="text-2xl font-black text-emerald-400">{accuracy}%</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-400 font-semibold uppercase">Topic Mastery</p>
            <p className="text-2xl font-black text-brand-400">{latestMastery}%</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            onClick={() => handleStartQuiz()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold transition shadow-lg shadow-brand-500/20"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Practice Topic Again</span>
          </button>
          {onViewProgress && (
            <button
              onClick={onViewProgress}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition border border-slate-700"
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
      <div className="glass-panel rounded-3xl p-6 sm:p-8 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Select Topic for Practice Quiz</h2>
              <p className="text-xs text-slate-400">
                Questions are strictly grounded in your course materials.
              </p>
            </div>
          </div>

          <button
            onClick={handleReprocessTopics}
            disabled={reprocessingTopics}
            title="Re-extract syllabus topics from uploaded documents"
            className="text-[11px] font-semibold text-slate-400 hover:text-brand-300 flex items-center gap-1.5 p-2 rounded-xl hover:bg-slate-800/60 transition disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${reprocessingTopics ? "animate-spin" : ""}`} />
            <span>Re-extract Topics</span>
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          <label className="text-xs font-semibold text-slate-300 block">Syllabus Curriculum Modules</label>
          <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
            {Object.entries(groupedTopics).map(([moduleName, moduleTopics]) => (
              <div key={moduleName} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand-400">
                    {moduleName}
                  </span>
                  <div className="h-px bg-slate-800 flex-1" />
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {moduleTopics.map((t) => {
                    const isSelected = selectedTopicId === t.id;
                    const pagesText = t.pages && t.pages.length > 0 ? ` • Pages ${t.pages.join(", ")}` : "";
                    const chunkText = t.chunks_count ? `${t.chunks_count} source sections` : "1 section";

                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTopicId(t.id)}
                        className={`p-3.5 rounded-xl text-left text-xs transition border flex flex-col gap-1.5 ${
                          isSelected
                            ? "bg-brand-500/15 border-brand-500/40 text-white shadow-md shadow-brand-500/10"
                            : "bg-slate-900/40 hover:bg-slate-800/60 border-slate-800 text-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="font-bold text-slate-100 text-sm">{t.name}</span>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-brand-400 shrink-0 ml-2" />
                          )}
                        </div>

                        {t.learning_objective && (
                          <p className="text-[11px] text-slate-400 leading-relaxed font-normal">
                            {t.learning_objective}
                          </p>
                        )}

                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                          <span>{chunkText}{pagesText}</span>
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
          className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-bold transition shadow-lg shadow-brand-500/20"
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
    <div className="glass-panel rounded-3xl p-6 sm:p-8 max-w-3xl mx-auto space-y-6 animate-fadeIn">
      {/* Quiz Progress Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
        <div>
          <span className="text-[11px] font-bold text-brand-400 uppercase tracking-wider">
            {selectedTopic?.name}
          </span>
          <h2 className="text-sm font-semibold text-slate-300">
            Question {currentIndex + 1} of {questions.length}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
            Difficulty {currentQ.difficulty.toFixed(1)}x
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Question Stem - Neutral Language */}
      <div className="bg-slate-900/40 p-5 rounded-2xl border border-slate-800/70">
        <p className="text-base sm:text-lg font-semibold text-white leading-relaxed">
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
            "bg-slate-900/50 hover:bg-slate-800/60 border-slate-800 text-slate-200";

          if (isSubmitted) {
            if (isCorrectAnswer) {
              btnStyles = "bg-emerald-500/15 border-emerald-500/40 text-emerald-200 font-bold";
            } else if (isUserChoiceWrong) {
              btnStyles = "bg-rose-500/15 border-rose-500/40 text-rose-200 font-bold";
            } else {
              btnStyles = "bg-slate-900/20 border-slate-800/40 text-slate-500";
            }
          } else if (isSelected) {
            btnStyles = "bg-brand-500/15 border-brand-500/40 text-white font-semibold ring-1 ring-brand-500/40";
          }

          return (
            <button
              key={optIdx}
              onClick={() => !isSubmitted && setSelectedOption(opt)}
              disabled={isSubmitted || submitting}
              className={`w-full flex items-center justify-between p-4 rounded-xl text-left text-xs transition border ${btnStyles}`}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-lg bg-slate-800/80 text-slate-300 font-bold flex items-center justify-center text-[11px] shrink-0">
                  {String.fromCharCode(65 + optIdx)}
                </span>
                <span>{opt}</span>
              </div>

              {isSubmitted && isCorrectAnswer && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 ml-2" />
              )}
              {isSubmitted && isUserChoiceWrong && (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0 ml-2" />
              )}
            </button>
          );
        })}
      </div>

      {/* Graded Feedback Panel (Appears after submission) */}
      {currentResult && (
        <div
          className={`p-5 rounded-2xl border text-xs space-y-3 animate-fadeIn ${
            currentResult.correct
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-200"
              : "bg-rose-500/10 border-rose-500/20 text-rose-200"
          }`}
        >
          <div className="flex items-center justify-between font-bold">
            <div className="flex items-center gap-2">
              {currentResult.correct ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Correct!</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-rose-400" />
                  <span>Incorrect</span>
                </>
              )}
            </div>

            <span className="text-[11px] font-semibold text-slate-300">
              New Topic Mastery: {Math.round(currentResult.new_mastery_score * 100)}%
            </span>
          </div>

          <p className="text-slate-300 leading-relaxed font-normal">
            {currentResult.explanation}
          </p>

          {currentResult.source_chunk_ids.length > 0 && (
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-[10px] uppercase font-bold text-slate-400">Grounded in:</span>
              {currentResult.source_chunk_ids.map((cid) => (
                <span
                  key={cid}
                  className="px-2 py-0.5 rounded-md bg-slate-800/80 text-slate-300 text-[10px] font-mono border border-slate-700"
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
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-bold transition shadow-lg shadow-brand-500/20"
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
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold transition shadow-lg shadow-brand-500/20"
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
