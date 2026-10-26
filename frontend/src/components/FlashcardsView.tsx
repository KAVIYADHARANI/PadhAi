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
  { grade: 0, label: "Blackout", desc: "No idea", color: "bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30" },
  { grade: 1, label: "Incorrect", desc: "Remembered after", color: "bg-orange-500/20 text-orange-300 border-orange-500/30 hover:bg-orange-500/30" },
  { grade: 2, label: "Hard", desc: "Significant effort", color: "bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30" },
  { grade: 3, label: "Good", desc: "Recalled with effort", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30" },
  { grade: 4, label: "Easy", desc: "Brief hesitation", color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/30" },
  { grade: 5, label: "Perfect", desc: "Instant recall", color: "bg-brand-500/20 text-brand-300 border-brand-500/30 hover:bg-brand-500/30" },
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
    <div className="space-y-6 animate-fadeIn">
      {/* Top Header & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-brand-400" />
            <span>Spaced Repetition Flashcards</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Powered by the SM-2 learning algorithm for optimal active recall and retention.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-900/80 p-1 rounded-xl border border-slate-800 flex items-center">
            <button
              onClick={() => setMode("review")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                mode === "review"
                  ? "bg-brand-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Review Due ({dueCount})
            </button>
            <button
              onClick={() => setMode("browse")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                mode === "browse"
                  ? "bg-brand-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Browse All ({totalCount})
            </button>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-brand-500/20 text-brand-300 border border-brand-500/30 hover:bg-brand-500/30 transition disabled:opacity-50"
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
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Topic Filter Row */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-slate-500 font-medium shrink-0">Topic:</span>
        <button
          onClick={() => setSelectedTopicId(null)}
          className={`px-3 py-1 rounded-lg border shrink-0 transition ${
            selectedTopicId === null
              ? "bg-brand-500/20 border-brand-500/40 text-brand-300 font-semibold"
              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
          }`}
        >
          All Topics
        </button>
        {topics.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedTopicId(t.id)}
            className={`px-3 py-1 rounded-lg border shrink-0 transition ${
              selectedTopicId === t.id
                ? "bg-brand-500/20 border-brand-500/40 text-brand-300 font-semibold"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-brand-400" />
          <p className="text-xs">Loading flashcard deck...</p>
        </div>
      ) : mode === "review" ? (
        /* Review Mode */
        <div className="space-y-6">
          {dueCards.length > 0 && activeCard ? (
            <div className="max-w-2xl mx-auto space-y-4">
              {/* Progress counter */}
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-300">
                  Card {currentCardIndex + 1} of {dueCards.length} Due
                </span>
                <span className="flex items-center gap-1 text-brand-400">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Interval: {activeCard.interval_days}d · Reps: {activeCard.reps}</span>
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-brand-500 to-cyan-500 transition-all duration-300"
                  style={{
                    width: `${((currentCardIndex + 1) / dueCards.length) * 100}%`,
                  }}
                />
              </div>

              {/* The Flashcard (Interactive Flip) */}
              <div
                onClick={() => setIsFlipped((prev) => !prev)}
                className="cursor-pointer group relative min-h-[300px] glass-panel rounded-3xl p-8 border border-slate-800 hover:border-brand-500/40 transition-all duration-300 flex flex-col justify-between shadow-xl"
              >
                <div className="flex items-center justify-between text-xs text-slate-500 pb-4 border-b border-slate-800/60">
                  <span className="uppercase tracking-wider font-bold text-[10px] text-brand-400">
                    {isFlipped ? "Answer / Explanation" : "Active Recall Question"}
                  </span>
                  <span className="text-[11px] text-slate-400 group-hover:text-brand-300 transition">
                    Click card to {isFlipped ? "see question" : "reveal answer"}
                  </span>
                </div>

                <div className="my-auto py-6">
                  <p className="text-lg sm:text-xl font-medium text-white leading-relaxed text-center">
                    {isFlipped ? activeCard.back : activeCard.front}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Ease Factor: {activeCard.ease_factor.toFixed(2)}</span>
                  <span>Press Space or Click to Flip</span>
                </div>
              </div>

              {/* SM-2 Rating Controls (Shown after flip) */}
              {isFlipped ? (
                <div className="space-y-2 animate-fadeIn">
                  <p className="text-center text-xs font-semibold text-slate-400">
                    Rate how easily you recalled this answer:
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                    {QUALITY_RATINGS.map((r) => (
                      <button
                        key={r.grade}
                        onClick={() => handleReviewRating(r.grade)}
                        disabled={isSubmittingReview}
                        className={`p-3 rounded-2xl border text-center transition flex flex-col items-center justify-center gap-1 ${r.color}`}
                      >
                        <span className="text-xs font-bold">{r.label}</span>
                        <span className="text-[10px] opacity-75">{r.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <button
                    onClick={() => setIsFlipped(true)}
                    className="px-6 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-200 hover:text-white hover:border-brand-500/40 transition"
                  >
                    Reveal Answer
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Empty or Completed State */
            <div className="glass-panel rounded-3xl p-10 text-center max-w-xl mx-auto border border-slate-800 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-white">All caught up on reviews!</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                You have reviewed all due cards for this course. {MASCOT_NAME} recommends testing your recall
                with a practice quiz or generating new flashcards for upcoming roadmap tasks.
              </p>
              {sessionCompletedCount > 0 && (
                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-xs text-brand-300 font-semibold inline-block">
                  Cards completed this session: {sessionCompletedCount}
                </div>
              )}
              <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="px-4 py-2.5 rounded-xl bg-brand-500 text-white font-bold text-xs hover:bg-brand-600 transition flex items-center gap-2 shadow-lg shadow-brand-500/25"
                >
                  <Plus className="w-4 h-4" />
                  <span>Generate New Cards</span>
                </button>
                {onNavigateToQuiz && (
                  <button
                    onClick={onNavigateToQuiz}
                    className="px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-bold text-xs hover:text-white transition flex items-center gap-2"
                  >
                    <Zap className="w-4 h-4 text-amber-400" />
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
                    className="glass-card rounded-2xl p-5 border border-slate-800/80 flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span
                          className={`px-2 py-0.5 rounded-full font-bold uppercase tracking-wider text-[10px] ${
                            isDue
                              ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {isDue ? "Due Now" : `Due ${new Date(card.due_date).toLocaleDateString()}`}
                        </span>
                        <button
                          onClick={() => handleDeleteCard(card.id)}
                          className="text-slate-500 hover:text-red-400 transition p-1"
                          title="Delete card"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-sm font-semibold text-white">{card.front}</p>
                      <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
                        {card.back}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500">
                      <span>Reps: {card.reps} · Interval: {card.interval_days}d</span>
                      <span>Ease: {card.ease_factor.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 glass-panel rounded-2xl text-center text-slate-400 border border-slate-800">
              <BookOpen className="w-8 h-8 mx-auto text-slate-600 mb-2" />
              <p className="text-xs">No flashcards found for this topic filter.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
