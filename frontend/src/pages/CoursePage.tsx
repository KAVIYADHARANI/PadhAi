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

  const navTabs: Array<{ id: CourseTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "materials", label: "Knowledge Base", icon: BookMarked },
    { id: "roadmap", label: "Study Roadmap", icon: Calendar },
    { id: "chat", label: `Ask ${MASCOT_NAME}`, icon: MessageSquare },
    { id: "quiz", label: "Practice Quiz", icon: HelpCircle },
    { id: "flashcards", label: "Flashcards", icon: Layers },
    { id: "progress", label: "Mastery & Progress", icon: BarChart3 },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Back to Dashboard Navigation */}
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold text-muted hover:text-heading transition group py-1.5 px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <ArrowLeft className="w-4 h-4 transform group-hover:-translate-x-1 transition-transform" />
          <span>Back to Dashboard</span>
        </button>
      </div>

      {/* Course Hero Card */}
      <div className="bg-surface border border-line shadow-sm rounded-card p-6 sm:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-pill bg-primary-light text-primary border border-primary/20">
                {course.level} Level
              </span>
              <span className="text-xs text-muted">
                Created {new Date(course.created_at).toLocaleDateString()}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-heading tracking-tight">
              {course.name}
            </h1>
          </div>

          {/* Goal Timeline & Daily Target Stat Tiles */}
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-subtle border border-line">
              <div className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center text-primary shrink-0">
                <Calendar className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-muted uppercase font-semibold tracking-wider">Goal Timeline</p>
                <p className="text-sm font-bold text-heading">{course.goal_days} Days</p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-subtle border border-line">
              <div className="w-9 h-9 rounded-lg bg-accent-light flex items-center justify-center text-accent shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-muted uppercase font-semibold tracking-wider">Daily Target</p>
                <p className="text-sm font-bold text-heading">{course.hours_per_day} Hours</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Underline-Style Navigation Tabs */}
      <div className="border-b border-line flex items-center gap-4 sm:gap-6 overflow-x-auto scrollbar-none">
        {navTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 pb-3 text-xs sm:text-sm transition font-medium border-b-2 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-t-sm ${
                isActive
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-muted hover:text-heading"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "materials" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-w-0">
          <div className="lg:col-span-2 space-y-6 min-w-0">
            <div className="flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-primary" />
              <h2 className="text-base font-bold text-heading">Course Knowledge Base</h2>
            </div>

            <DocumentUpload courseId={course.id} />
          </div>

          <div className="space-y-6 min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="text-base font-bold text-heading">Companion Readiness</h2>
            </div>

            <div className="bg-surface rounded-card p-5 border border-line shadow-sm flex flex-col items-center min-w-0">
              <Buddy
                courseId={course.id}
                currentLesson={currentLessonData}
                onNavigateToQuiz={() => setActiveTab("quiz")}
                onNavigateToChat={() => setActiveTab("chat")}
                onNavigateToFlashcards={() => setActiveTab("flashcards")}
              />
            </div>

            <div className="bg-surface rounded-card p-5 border border-line shadow-sm text-xs text-muted space-y-2 min-w-0">
              <h3 className="font-semibold text-heading">Document Ingestion Pipeline</h3>
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
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 flex flex-col items-end">
        {/* Open Chat Panel */}
        {isFloatingChatOpen && (
          <div className="fixed inset-x-0 bottom-0 sm:static sm:mb-3 z-50 animate-in slide-in-from-bottom-4 duration-200">
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
          className="w-14 h-14 rounded-full bg-primary hover:bg-primary-hover text-white shadow-lg shadow-indigo-500/25 flex items-center justify-center transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 relative group"
          title={`Chat with ${MASCOT_NAME}`}
          aria-label={`Chat with ${MASCOT_NAME}`}
        >
          {isFloatingChatOpen ? (
            <X className="w-6 h-6" />
          ) : (
            <div className="relative">
              <PlaceholderMascot state="idle" className="w-8 h-8 pointer-events-none" />
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-accent border-2 border-surface" />
            </div>
          )}
        </button>
      </div>
    </div>
  );
};
