import React, { useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  BookMarked,
  Calendar,
  Clock,
  HelpCircle,
  Layers,
  MessageSquare,
  Sparkles,
  X,
} from "lucide-react";
import { MASCOT_NAME } from "../brand";
import { Buddy } from "../components/buddy/Buddy";
import { PlaceholderMascot } from "../components/buddy/PlaceholderMascot";
import { CompanionChat } from "../components/buddy/CompanionChat";
import { ChatView } from "../components/ChatView";
import { DocumentUpload } from "../components/DocumentUpload";
import { FlashcardsView } from "../components/FlashcardsView";
import { LessonView } from "../components/LessonView";
import { ProgressView } from "../components/ProgressView";
import { QuizView } from "../components/QuizView";
import { RoadmapView } from "../components/RoadmapView";
import { Course, RoadmapItem } from "../types";

interface CoursePageProps {
  course: Course;
  onBack: () => void;
}

type CourseTab = "materials" | "roadmap" | "chat" | "quiz" | "flashcards" | "progress";

export const CoursePage: React.FC<CoursePageProps> = ({ course, onBack }) => {
  const [activeTab, setActiveTab] = useState<CourseTab>("materials");
  const [targetQuizTopicId, setTargetQuizTopicId] = useState<number | null>(null);
  const [activeLesson, setActiveLesson] = useState<{
    item: RoadmapItem;
    taskId: string;
  } | null>(null);
  const [isFloatingChatOpen, setIsFloatingChatOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.location.search.includes("open_chat=true");
    }
    return false;
  });

  const currentLessonData = activeLesson
    ? {
        item: activeLesson.item,
        taskId: activeLesson.taskId,
        lessonTitle:
          activeLesson.item.tasks.find((t) => t.id === activeLesson.taskId)?.task ||
          activeLesson.item.title,
      }
    : null;

  const handleStartPracticeForTopic = (topicId: number) => {
    setActiveLesson(null);
    setTargetQuizTopicId(topicId);
    setActiveTab("quiz");
  };

  const handleTabChange = (tab: CourseTab) => {
    setActiveLesson(null);
    setActiveTab(tab);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Back to Dashboard Navigation */}
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold text-[#64748B] hover:text-[#0F172A] transition group py-1.5 px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F46E5] rounded-lg"
        >
          <ArrowLeft className="w-4 h-4 transform group-hover:-translate-x-1 transition-transform" />
          <span>Back to Dashboard</span>
        </button>
      </div>

      {/* Course Hero Card */}
      <div className="bg-white border border-[#E2E8F0] shadow-sm rounded-card p-6 sm:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-pill bg-[#EEF2FF] text-[#4F46E5] border border-indigo-100">
                {course.level} Level
              </span>
              <span className="text-xs text-[#64748B]">
                Created {new Date(course.created_at).toLocaleDateString()}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight">
              {course.name}
            </h1>
          </div>

          {/* Goal Timeline & Daily Target Stat Tiles */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
              <div className="w-9 h-9 rounded-lg bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5] shrink-0">
                <Calendar className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-[#64748B] uppercase font-semibold tracking-wider">Goal Timeline</p>
                <p className="text-sm font-bold text-[#0F172A]">{course.goal_days} Days</p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
              <div className="w-9 h-9 rounded-lg bg-[#F0FDFA] flex items-center justify-center text-[#0D9488] shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-[#64748B] uppercase font-semibold tracking-wider">Daily Target</p>
                <p className="text-sm font-bold text-[#0F172A]">{course.hours_per_day} Hours</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Underline-Style Navigation Tabs */}
      <div className="border-b border-[#E2E8F0] flex items-center gap-4 sm:gap-6 overflow-x-auto scrollbar-none">
        <button
          onClick={() => handleTabChange("materials")}
          className={`flex items-center gap-2 pb-3 text-xs sm:text-sm transition font-medium border-b-2 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F46E5] rounded-t-sm ${
            activeTab === "materials"
              ? "border-[#4F46E5] text-[#4F46E5] font-semibold"
              : "border-transparent text-[#64748B] hover:text-[#0F172A]"
          }`}
        >
          <BookMarked className="w-4 h-4" />
          <span>Knowledge Base</span>
        </button>

        <button
          onClick={() => handleTabChange("roadmap")}
          className={`flex items-center gap-2 pb-3 text-xs sm:text-sm transition font-medium border-b-2 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F46E5] rounded-t-sm ${
            activeTab === "roadmap"
              ? "border-[#4F46E5] text-[#4F46E5] font-semibold"
              : "border-transparent text-[#64748B] hover:text-[#0F172A]"
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Study Roadmap</span>
        </button>

        <button
          onClick={() => handleTabChange("chat")}
          className={`flex items-center gap-2 pb-3 text-xs sm:text-sm transition font-medium border-b-2 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F46E5] rounded-t-sm ${
            activeTab === "chat"
              ? "border-[#4F46E5] text-[#4F46E5] font-semibold"
              : "border-transparent text-[#64748B] hover:text-[#0F172A]"
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Ask {MASCOT_NAME}</span>
        </button>

        <button
          onClick={() => handleTabChange("quiz")}
          className={`flex items-center gap-2 pb-3 text-xs sm:text-sm transition font-medium border-b-2 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F46E5] rounded-t-sm ${
            activeTab === "quiz"
              ? "border-[#4F46E5] text-[#4F46E5] font-semibold"
              : "border-transparent text-[#64748B] hover:text-[#0F172A]"
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          <span>Practice Quiz</span>
        </button>

        <button
          onClick={() => handleTabChange("flashcards")}
          className={`flex items-center gap-2 pb-3 text-xs sm:text-sm transition font-medium border-b-2 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F46E5] rounded-t-sm ${
            activeTab === "flashcards"
              ? "border-[#4F46E5] text-[#4F46E5] font-semibold"
              : "border-transparent text-[#64748B] hover:text-[#0F172A]"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Flashcards</span>
        </button>

        <button
          onClick={() => handleTabChange("progress")}
          className={`flex items-center gap-2 pb-3 text-xs sm:text-sm transition font-medium border-b-2 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F46E5] rounded-t-sm ${
            activeTab === "progress"
              ? "border-[#4F46E5] text-[#4F46E5] font-semibold"
              : "border-transparent text-[#64748B] hover:text-[#0F172A]"
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Mastery & Progress</span>
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "materials" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-w-0">
          <div className="lg:col-span-2 space-y-6 min-w-0">
            <div className="flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-[#4F46E5]" />
              <h2 className="text-base font-bold text-[#0F172A]">Course Knowledge Base</h2>
            </div>

            <DocumentUpload courseId={course.id} />
          </div>

          <div className="space-y-6 min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#4F46E5]" />
              <h2 className="text-base font-bold text-[#0F172A]">Companion Readiness</h2>
            </div>

            <div className="bg-white rounded-card p-5 border border-[#E2E8F0] shadow-sm flex flex-col items-center min-w-0">
              <Buddy
                courseId={course.id}
                currentLesson={currentLessonData}
                onNavigateToQuiz={() => setActiveTab("quiz")}
                onNavigateToChat={() => setActiveTab("chat")}
                onNavigateToFlashcards={() => setActiveTab("flashcards")}
              />
            </div>

            <div className="bg-white rounded-card p-5 border border-[#E2E8F0] shadow-sm text-xs text-[#64748B] space-y-2 min-w-0">
              <h3 className="font-semibold text-[#0F172A]">Document Ingestion Pipeline</h3>
              <p className="break-words leading-relaxed">
                Uploaded PDFs and notes are segmented into semantic chunks with BGE-M3 vector embeddings for
                grounded tutoring, roadmap synthesis, and interactive quizzes.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "roadmap" &&
        (activeLesson ? (
          <LessonView
            course={course}
            roadmapItem={activeLesson.item}
            taskId={activeLesson.taskId}
            onBackToRoadmap={() => setActiveLesson(null)}
          />
        ) : (
          <RoadmapView
            course={course}
            onGoToMaterials={() => handleTabChange("materials")}
            onOpenLesson={(item, taskId) => setActiveLesson({ item, taskId })}
          />
        ))}

      {activeTab === "chat" && (
        <ChatView
          course={course}
        />
      )}

      {activeTab === "quiz" && (
        <QuizView
          courseId={course.id}
          initialTopicId={targetQuizTopicId}
          onViewProgress={() => setActiveTab("progress")}
        />
      )}

      {activeTab === "flashcards" && (
        <FlashcardsView
          courseId={course.id}
          onNavigateToQuiz={() => setActiveTab("quiz")}
        />
      )}

      {activeTab === "progress" && (
        <ProgressView
          courseId={course.id}
          onPracticeTopic={handleStartPracticeForTopic}
        />
      )}

      {/* Floating Study Companion Launcher Button & Panel */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end">
        {/* Open Chat Panel */}
        {isFloatingChatOpen && (
          <div className="mb-3 animate-in slide-in-from-bottom-4 duration-200">
            <CompanionChat
              courseId={course.id}
              currentLesson={currentLessonData}
              onClose={() => setIsFloatingChatOpen(false)}
              onMinimize={() => setIsFloatingChatOpen(false)}
              onRequestBreak={() => {}}
              onNavigateToQuiz={() => {
                setIsFloatingChatOpen(false);
                setActiveTab("quiz");
              }}
              onNavigateToFlashcards={() => {
                setIsFloatingChatOpen(false);
                setActiveTab("flashcards");
              }}
            />
          </div>
        )}

        {/* 56px Indigo Floating Launcher Button */}
        <button
          type="button"
          onClick={() => setIsFloatingChatOpen(!isFloatingChatOpen)}
          className="w-14 h-14 rounded-full bg-[#4F46E5] hover:bg-[#4338CA] text-white shadow-lg shadow-indigo-500/25 flex items-center justify-center transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300 relative group"
          title={`Chat with ${MASCOT_NAME}`}
          aria-label={`Chat with ${MASCOT_NAME}`}
        >
          {isFloatingChatOpen ? (
            <X className="w-6 h-6" />
          ) : (
            <div className="relative">
              <PlaceholderMascot state="idle" className="w-8 h-8 pointer-events-none" />
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#0D9488] border-2 border-white" />
            </div>
          )}
        </button>
      </div>
    </div>
  );
};
