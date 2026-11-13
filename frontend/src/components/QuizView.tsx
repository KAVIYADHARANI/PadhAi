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
      <div className="flex flex-col items-center justify-center p-12 text-muted space-y-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-xs font-medium">Loading course syllabus topics...</p>
      </div>
    );
  }

  // Render 2: No topics available yet
  if (topics.length === 0) {
    return (
      <div className="bg-surface border border-line shadow-card rounded-2xl p-8 text-center max-w-xl mx-auto space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-primary-light border border-primary/20 text-primary flex items-center justify-center mx-auto">
          <HelpCircle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-heading">No Topics Available Yet</h3>
        <p className="text-xs text-muted leading-relaxed">
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
      <div className="bg-surface border border-line shadow-card rounded-2xl p-8 max-w-2xl mx-auto space-y-6 text-center animate-in fade-in duration-200">
        <div className="w-16 h-16 rounded-2xl bg-primary-light border border-primary/20 text-primary flex items-center justify-center mx-auto">
          <Trophy className="w-8 h-8" />
        </div>

        <div>
          <span className="text-xs font-bold text-primary uppercase tracking-wider">
            Quiz Completed
          </span>
          <h2 className="text-2xl font-extrabold text-heading mt-1">
            {selectedTopic?.name ?? "Topic Assessment"}
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-4 bg-subtle p-4 rounded-xl border border-line">
          <div>
            <p className="text-[11px] text-muted font-semibold uppercase">Score</p>
            <p className="text-2xl font-black text-heading">
              {correctCount} / {totalCount}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted font-semibold uppercase">Accuracy</p>
            <p className="text-2xl font-black text-accent">{accuracy}%</p>
          </div>
          <div>
            <p className="text-[11px] text-muted font-semibold uppercase">Topic Mastery</p>
            <p className="text-2xl font-black text-primary">{latestMastery}%</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            onClick={() => handleStartQuiz()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-btn bg-primary hover:bg-primary-hover text-white text-xs font-bold transition shadow-sm min-h-[44px]"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Practice Topic Again</span>
          </button>
          {onViewProgress && (
            <button
              onClick={onViewProgress}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-btn bg-surface hover:bg-subtle text-body text-xs font-semibold transition border border-line min-h-[44px]"
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
      <div className="bg-surface border border-line shadow-card rounded-2xl p-6 sm:p-8 max-w-2xl mx-auto space-y-6 animate-in fade-in duration-200">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-light border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-heading">Select Topic for Practice Quiz</h2>
              <p className="text-xs text-muted">
                Questions are strictly grounded in your course materials.
              </p>
            </div>
          </div>

          <button
            onClick={handleReprocessTopics}
            disabled={reprocessingTopics}
            title="Re-extract syllabus topics from uploaded documents"
            className="text-xs font-semibold text-muted hover:text-primary flex items-center gap-1.5 p-2 rounded-xl hover:bg-codeblock transition disabled:opacity-50 min-h-[44px] shrink-0"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${reprocessingTopics ? "animate-spin" : ""}`} />
            <span>Re-extract Topics</span>
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-error-light border border-error/25 text-error text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          <label className="text-xs font-semibold text-heading block">Syllabus Curriculum Modules</label>
          <div className="space-y-4 max-h-[380px] overflow-y-auto pr-1">
            {Object.entries(groupedTopics).map(([moduleName, moduleTopics]) => (
              <div key={moduleName} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                    {moduleName}
                  </span>
                  <div className="h-px bg-line flex-1" />
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
                            ? "bg-primary-light border-primary text-heading shadow-card ring-1 ring-primary"
                            : "bg-surface hover:bg-subtle hover:-translate-y-0.5 hover:shadow-card-hover border-line text-body"
                        }`}
                      >
                        <div className="flex items-start justify-between w-full gap-2">
                          <span
                            className="font-bold text-heading text-sm leading-snug line-clamp-2"
                            title={t.name}
                          >
                            {t.name}
                          </span>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          )}
                        </div>

                        {t.learning_objective && (
                          <p className="text-xs text-muted leading-relaxed font-normal">
                            {t.learning_objective}
                          </p>
                        )}

                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-pill bg-codeblock text-muted text-[11px] font-medium border border-line">
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
          className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-btn bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-bold transition shadow-sm min-h-[44px]"
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
    <div className="bg-surface border border-line shadow-card rounded-2xl p-6 sm:p-8 max-w-3xl mx-auto space-y-6 animate-in fade-in duration-200">
      {/* Quiz Progress Header */}
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <span className="text-[11px] font-bold text-primary uppercase tracking-wider">
            {selectedTopic?.name}
          </span>
          <h2 className="text-sm font-semibold text-heading">
            Question {currentIndex + 1} of {questions.length}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium px-2.5 py-0.5 rounded-pill bg-codeblock border border-line text-muted">
            Difficulty {currentQ.difficulty.toFixed(1)}x
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-error-light border border-error/25 text-error text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Question Stem - Neutral Language */}
      <div className="bg-subtle p-5 rounded-xl border border-line">
        <p className="text-base sm:text-lg font-semibold text-heading leading-relaxed">
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
            "bg-surface hover:bg-subtle hover:border-primary/40 border-line text-body";

          if (isSubmitted) {
            if (isCorrectAnswer) {
              btnStyles = "bg-accent-light border-accent text-heading font-bold";
            } else if (isUserChoiceWrong) {
              btnStyles = "bg-error-light border-error text-heading font-bold";
            } else {
              btnStyles = "bg-subtle border-line text-muted";
            }
          } else if (isSelected) {
            btnStyles = "bg-primary-light border-primary text-heading font-semibold ring-1 ring-primary";
          }

          return (
            <button
              key={optIdx}
              onClick={() => !isSubmitted && setSelectedOption(opt)}
              disabled={isSubmitted || submitting}
              className={`w-full flex items-center justify-between p-4 rounded-xl text-left text-xs transition border min-h-[44px] ${btnStyles}`}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-lg bg-codeblock text-body font-bold flex items-center justify-center text-[11px] shrink-0 border border-line">
                  {String.fromCharCode(65 + optIdx)}
                </span>
                <span className="leading-relaxed">{opt}</span>
              </div>

              {isSubmitted && isCorrectAnswer && (
                <CheckCircle2 className="w-4 h-4 text-accent shrink-0 ml-2" />
              )}
              {isSubmitted && isUserChoiceWrong && (
                <XCircle className="w-4 h-4 text-error shrink-0 ml-2" />
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
              ? "bg-accent-light border-accent/30 text-heading"
              : "bg-error-light border-error/30 text-heading"
          }`}
        >
          <div className="flex items-center justify-between font-bold">
            <div className="flex items-center gap-2">
              {currentResult.correct ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-accent" />
                  <span className="text-accent">Correct!</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-error" />
                  <span className="text-error">Incorrect</span>
                </>
              )}
            </div>

            <span className="text-xs font-semibold text-muted">
              New Topic Mastery: {Math.round(currentResult.new_mastery_score * 100)}%
            </span>
          </div>

          <p className="text-body leading-relaxed font-normal">
            {currentResult.explanation}
          </p>

          {currentResult.source_chunk_ids.length > 0 && (
            <div className="flex items-center gap-1.5 pt-1 flex-wrap">
              <span className="text-[10px] uppercase font-bold text-muted">Grounded in:</span>
              {currentResult.source_chunk_ids.map((cid) => (
                <span
                  key={cid}
                  className="px-2 py-0.5 rounded-pill bg-surface text-body text-[11px] font-mono border border-line"
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
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-btn bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-bold transition shadow-sm min-h-[44px]"
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
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-btn bg-primary hover:bg-primary-hover text-white text-xs font-bold transition shadow-sm min-h-[44px]"
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
