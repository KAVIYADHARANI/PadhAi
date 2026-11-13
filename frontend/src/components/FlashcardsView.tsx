import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  Layers,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { MASCOT_NAME } from "../brand";
import { api } from "../services/api";
import { Flashcard, Topic } from "../types";

interface FlashcardsViewProps {
  courseId: number;
  initialTopicId?: number | null;
  onNavigateToQuiz?: () => void;
}

type ViewMode = "review" | "browse";

const QUALITY_RATINGS = [
  { grade: 0, label: "Blackout", desc: "No idea", color: "bg-error-light text-error border-error/25 hover:opacity-90" },
  { grade: 1, label: "Incorrect", desc: "Remembered after", color: "bg-warning-light text-warning border-warning/25 hover:opacity-90" },
  { grade: 2, label: "Hard", desc: "Significant effort", color: "bg-warning-light text-warning border-warning/25 hover:opacity-90" },
  { grade: 3, label: "Good", desc: "Recalled with effort", color: "bg-accent-light text-accent border-accent/25 hover:opacity-90" },
  { grade: 4, label: "Easy", desc: "Brief hesitation", color: "bg-primary-light text-primary border-primary/25 hover:opacity-90" },
  { grade: 5, label: "Perfect", desc: "Instant recall", color: "bg-primary text-white border-primary hover:bg-primary-hover" },
];

export const FlashcardsView: React.FC<FlashcardsViewProps> = ({
  courseId,
  initialTopicId = null,
  onNavigateToQuiz,
}) => {
  const [mode, setMode] = useState<ViewMode>("review");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(initialTopicId);
  const [allCards, setAllCards] = useState<Flashcard[]>([]);
  const [dueCards, setDueCards] = useState<Flashcard[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [dueCount, setDueCount] = useState<number>(0);

  // Review session state
  const [currentCardIndex, setCurrentCardIndex] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [sessionCompletedCount, setSessionCompletedCount] = useState<number>(0);
  const [isSubmittingReview, setIsSubmittingReview] = useState<boolean>(false);

  // Status & loading
  const [loading, setLoading] = useState<boolean>(true);
  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load topics and cards
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [topicsRes, listRes, dueRes] = await Promise.all([
        api.getCourseTopics(courseId),
        api.getCourseFlashcards(courseId, selectedTopicId),
        api.getDueFlashcards(courseId),
      ]);
      setTopics(topicsRes);
      setAllCards(listRes.cards);
      setTotalCount(listRes.total_count);
      setDueCount(listRes.due_count);
      setDueCards(dueRes);
      setCurrentCardIndex(0);
      setIsFlipped(false);
    } catch {
      setError("Failed to load flashcards. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [courseId, selectedTopicId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const newCards = await api.generateFlashcards(courseId, selectedTopicId, 5);
      if (newCards.length > 0) {
        setSuccessMessage(`Successfully generated ${newCards.length} new flashcards!`);
        await loadData();
        setMode("review");
      } else {
        setSuccessMessage("All key concepts for this topic already have flashcards.");
      }
    } catch {
      setError("Failed to generate flashcards. Please check document chunks.");
    } finally {
      setGenerating(false);
    }
  };

  const handleReviewRating = async (quality: number) => {
    if (dueCards.length === 0 || isSubmittingReview) return;
    const currentCard = dueCards[currentCardIndex];
    if (!currentCard) return;

    setIsSubmittingReview(true);
    try {
      await api.reviewFlashcard(currentCard.id, quality);
      setSessionCompletedCount((prev) => prev + 1);

      // Advance to next card or complete
      if (currentCardIndex + 1 < dueCards.length) {
        setCurrentCardIndex((prev) => prev + 1);
        setIsFlipped(false);
      } else {
        // Refresh due deck upon finishing
        const updatedDue = await api.getDueFlashcards(courseId);
        setDueCards(updatedDue);
        setDueCount(updatedDue.length);
        setCurrentCardIndex(0);
        setIsFlipped(false);
      }
    } catch {
      setError("Failed to record card review. Please try again.");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleDeleteCard = async (cardId: number) => {
    try {
      await api.deleteFlashcard(cardId);
      setAllCards((prev) => prev.filter((c) => c.id !== cardId));
      setDueCards((prev) => prev.filter((c) => c.id !== cardId));
      setTotalCount((prev) => Math.max(0, prev - 1));
    } catch {
      setError("Failed to delete flashcard.");
    }
  };

  const activeCard = dueCards[currentCardIndex];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-line">
        <div>
          <h2 className="text-xl font-bold text-heading flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-primary" />
            <span>Spaced Repetition Flashcards</span>
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Powered by the SM-2 learning algorithm for optimal active recall and retention.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="bg-codeblock p-1 rounded-xl border border-line flex items-center">
            <button
              onClick={() => setMode("review")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition min-h-[36px] ${
                mode === "review"
                  ? "bg-surface text-primary shadow-sm"
                  : "text-muted hover:text-heading"
              }`}
            >
              Review Due ({dueCount})
            </button>
            <button
              onClick={() => setMode("browse")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition min-h-[36px] ${
                mode === "browse"
                  ? "bg-surface text-primary shadow-sm"
                  : "text-muted hover:text-heading"
              }`}
            >
              Browse All ({totalCount})
            </button>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-3.5 py-2 rounded-btn text-xs font-bold bg-primary text-white hover:bg-primary-hover transition disabled:opacity-50 min-h-[44px] shadow-sm"
          >
            {generating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>{generating ? "Generating..." : "Generate Cards"}</span>
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-3.5 rounded-xl bg-error-light border border-error/25 text-error text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-xl bg-accent-light border border-accent/25 text-accent text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Topic Filter Row */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-muted font-medium shrink-0">Topic:</span>
        <button
          onClick={() => setSelectedTopicId(null)}
          className={`px-3 py-1 rounded-pill border shrink-0 transition text-xs ${
            selectedTopicId === null
              ? "bg-primary-light border-primary text-primary font-semibold"
              : "bg-surface border-line text-muted hover:text-heading"
          }`}
        >
          All Topics
        </button>
        {topics.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedTopicId(t.id)}
            className={`px-3 py-1 rounded-pill border shrink-0 transition text-xs ${
              selectedTopicId === t.id
                ? "bg-primary-light border-primary text-primary font-semibold"
                : "bg-surface border-line text-muted hover:text-heading"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="p-12 text-center text-muted space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary" />
          <p className="text-xs">Loading flashcard deck...</p>
        </div>
      ) : mode === "review" ? (
        /* Review Mode */
        <div className="space-y-6">
          {dueCards.length > 0 && activeCard ? (
            <div className="max-w-2xl mx-auto space-y-4">
              {/* Progress counter */}
              <div className="flex items-center justify-between text-xs text-muted">
                <span className="font-semibold text-heading">
                  Card {currentCardIndex + 1} of {dueCards.length} Due
                </span>
                <span className="flex items-center gap-1 text-primary">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Interval: {activeCard.interval_days}d · Reps: {activeCard.reps}</span>
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 w-full bg-codeblock rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#4F46E5] to-[#0D9488] transition-all duration-300"
                  style={{
                    width: `${((currentCardIndex + 1) / dueCards.length) * 100}%`,
                  }}
                />
              </div>

              {/* The Flashcard (Interactive Flip) */}
              <div
                onClick={() => setIsFlipped((prev) => !prev)}
                className="cursor-pointer group relative min-h-[300px] bg-surface rounded-2xl p-8 border border-line hover:border-primary transition-all duration-300 flex flex-col justify-between shadow-card hover:shadow-card-hover"
              >
                <div className="flex items-center justify-between text-xs text-muted pb-4 border-b border-line">
                  <span className="uppercase tracking-wider font-bold text-[10px] text-primary">
                    {isFlipped ? "Answer / Explanation" : "Active Recall Question"}
                  </span>
                  <span className="text-[11px] text-muted group-hover:text-primary transition">
                    Click card to {isFlipped ? "see question" : "reveal answer"}
                  </span>
                </div>

                <div className="my-auto py-6">
                  <p className="text-lg sm:text-xl font-medium text-heading leading-relaxed text-center">
                    {isFlipped ? activeCard.back : activeCard.front}
                  </p>
                </div>

                <div className="pt-4 border-t border-line flex items-center justify-between text-[11px] text-muted">
                  <span>Ease Factor: {activeCard.ease_factor.toFixed(2)}</span>
                  <span>Click to Flip</span>
                </div>
              </div>

              {/* SM-2 Rating Controls (Shown after flip) */}
              {isFlipped ? (
                <div className="space-y-2 animate-in fade-in duration-200">
                  <p className="text-center text-xs font-semibold text-muted">
                    Rate how easily you recalled this answer:
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                    {QUALITY_RATINGS.map((r) => (
                      <button
                        key={r.grade}
                        onClick={() => handleReviewRating(r.grade)}
                        disabled={isSubmittingReview}
                        className={`p-3 rounded-xl border text-center transition flex flex-col items-center justify-center gap-1 min-h-[50px] ${r.color}`}
                      >
                        <span className="text-xs font-bold">{r.label}</span>
                        <span className="text-[10px] opacity-80">{r.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <button
                    onClick={() => setIsFlipped(true)}
                    className="px-6 py-2.5 rounded-btn bg-primary hover:bg-primary-hover text-xs font-bold text-white transition shadow-sm min-h-[44px]"
                  >
                    Reveal Answer
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Empty or Completed State */
            <div className="bg-surface rounded-2xl p-10 text-center max-w-xl mx-auto border border-line shadow-card space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-accent-light border border-accent/25 text-accent flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-heading">All caught up on reviews!</h3>
              <p className="text-xs text-muted leading-relaxed">
                You have reviewed all due cards for this course. {MASCOT_NAME} recommends testing your recall
                with a practice quiz or generating new flashcards for upcoming roadmap tasks.
              </p>
              {sessionCompletedCount > 0 && (
                <div className="p-3 bg-primary-light rounded-xl border border-primary/20 text-xs text-primary font-semibold inline-block">
                  Cards completed this session: {sessionCompletedCount}
                </div>
              )}
              <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="px-4 py-2.5 rounded-btn bg-primary text-white font-bold text-xs hover:bg-primary-hover transition flex items-center gap-2 shadow-sm min-h-[44px]"
                >
                  <Plus className="w-4 h-4" />
                  <span>Generate New Cards</span>
                </button>
                {onNavigateToQuiz && (
                  <button
                    onClick={onNavigateToQuiz}
                    className="px-4 py-2.5 rounded-btn bg-surface border border-line text-body font-bold text-xs hover:bg-subtle transition flex items-center gap-2 min-h-[44px]"
                  >
                    <Zap className="w-4 h-4 text-warning" />
                    <span>Take a Quiz</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Browse Mode: List of all cards */
        <div className="space-y-4">
          {allCards.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {allCards.map((card) => {
                const isDue = new Date(card.due_date) <= new Date();
                return (
                  <div
                    key={card.id}
                    className="bg-surface rounded-xl p-5 border border-line shadow-sm hover:shadow-card-hover transition flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span
                          className={`px-2.5 py-0.5 rounded-pill font-bold uppercase tracking-wider text-[10px] ${
                            isDue
                              ? "bg-warning-light text-warning border border-warning/25"
                              : "bg-codeblock text-muted"
                          }`}
                        >
                          {isDue ? "Due Now" : `Due ${new Date(card.due_date).toLocaleDateString()}`}
                        </span>
                        <button
                          onClick={() => handleDeleteCard(card.id)}
                          className="text-muted hover:text-error transition p-1"
                          title="Delete card"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-sm font-semibold text-heading">{card.front}</p>
                      <p className="text-xs text-muted line-clamp-3 leading-relaxed">
                        {card.back}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-line flex items-center justify-between text-[11px] text-muted">
                      <span>Reps: {card.reps} · Interval: {card.interval_days}d</span>
                      <span>Ease: {card.ease_factor.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 bg-surface rounded-xl text-center text-muted border border-line shadow-sm">
              <BookOpen className="w-8 h-8 mx-auto text-muted mb-2" />
              <p className="text-xs">No flashcards found for this topic filter.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
