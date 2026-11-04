import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Flame,
  ListTodo,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import { MASCOT_NAME } from "../brand";
import { api, ApiError } from "../services/api";
import { Course, Document, RoadmapItem, RoadmapProgress } from "../types";

interface RoadmapViewProps {
  course: Course;
  onGoToMaterials: () => void;
  onOpenLesson?: (item: RoadmapItem, taskId: string) => void;
}

export const RoadmapView: React.FC<RoadmapViewProps> = ({
  course,
  onGoToMaterials,
  onOpenLesson,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [generating, setGenerating] = useState<boolean>(false);
  const [replanning, setReplanning] = useState<boolean>(false);
  const [roadmap, setRoadmap] = useState<RoadmapProgress | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmRegenerate, setShowConfirmRegenerate] = useState<boolean>(false);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [roadmapRes, docsRes] = await Promise.all([
        api.getCourseRoadmap(course.id),
        api.getCourseDocuments(course.id),
      ]);
      setRoadmap(roadmapRes);
      setDocuments(docsRes);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load study roadmap.");
      }
    } finally {
      setLoading(false);
    }
  }, [course.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleGenerateRoadmap = async (overwrite = false) => {
    setGenerating(true);
    setError(null);
    setShowConfirmRegenerate(false);
    try {
      const res = await api.generateCourseRoadmap(course.id, overwrite);
      setRoadmap(res);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to generate roadmap. Please check your uploaded materials.");
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleReplanRoadmap = async () => {
    setReplanning(true);
    setError(null);
    try {
      const res = await api.replanCourseRoadmap(course.id);
      setRoadmap(res);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to re-plan roadmap from mastery.");
      }
    } finally {
      setReplanning(false);
    }
  };

  const handleToggleTask = async (
    item: RoadmapItem,
    taskId: string,
    currentCompleted: boolean
  ) => {
    setUpdatingTaskId(taskId);
    try {
      const updated = await api.updateRoadmapItem(course.id, item.id, {
        task_id: taskId,
        task_completed: !currentCompleted,
      });

      setRoadmap((prev) => {
        if (!prev) return prev;
        const newItems = prev.items.map((i) => (i.id === item.id ? updated : i));
        let totalTasks = 0;
        let completedTasks = 0;
        let completedDays = 0;

        for (const it of newItems) {
          if (it.completed) completedDays += 1;
          for (const t of it.tasks) {
            totalTasks += 1;
            if (t.completed) completedTasks += 1;
          }
        }

        const percent =
          totalTasks > 0
            ? Math.round((completedTasks / totalTasks) * 1000) / 10
            : 0;

        return {
          ...prev,
          completed_days: completedDays,
          completed_tasks: completedTasks,
          total_tasks: totalTasks,
          percent_complete: percent,
          items: newItems,
        };
      });
    } catch (err) {
      console.error("Failed to toggle task completion:", err);
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const handleToggleDay = async (item: RoadmapItem) => {
    try {
      const updated = await api.updateRoadmapItem(course.id, item.id, {
        completed: !item.completed,
      });

      setRoadmap((prev) => {
        if (!prev) return prev;
        const newItems = prev.items.map((i) => (i.id === item.id ? updated : i));
        let totalTasks = 0;
        let completedTasks = 0;
        let completedDays = 0;

        for (const it of newItems) {
          if (it.completed) completedDays += 1;
          for (const t of it.tasks) {
            totalTasks += 1;
            if (t.completed) completedTasks += 1;
          }
        }

        const percent =
          totalTasks > 0
            ? Math.round((completedTasks / totalTasks) * 1000) / 10
            : 0;

        return {
          ...prev,
          completed_days: completedDays,
          completed_tasks: completedTasks,
          total_tasks: totalTasks,
          percent_complete: percent,
          items: newItems,
        };
      });
    } catch (err) {
      console.error("Failed to update day status:", err);
    }
  };

  // Inspect ingestion readiness
  const readyDocs = documents.filter((d) => d.status === "ready");
  const inProgressDocs = documents.filter((d) =>
    ["queued", "processing"].includes(d.status)
  );

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border border-[#E2E8F0] shadow-card space-y-4">
        <RefreshCw className="w-8 h-8 text-[#4F46E5] animate-spin mx-auto" />
        <p className="text-sm font-semibold text-[#0F172A]">
          Loading your personalized study roadmap...
        </p>
      </div>
    );
  }

  const hasRoadmap = roadmap && roadmap.items && roadmap.items.length > 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Error notification */}
      {error && (
        <div className="p-4 rounded-xl bg-[#FFF1F2] border border-rose-200 text-[#E11D48] text-xs flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-[#E11D48] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">{error}</p>
          </div>
        </div>
      )}

      {/* Case 1: Ingestion in progress */}
      {inProgressDocs.length > 0 && !hasRoadmap && (
        <div className="bg-white rounded-2xl p-8 border border-amber-200 bg-[#FFFBEB]/40 space-y-4 text-center shadow-card">
          <RefreshCw className="w-10 h-10 text-[#D97706] animate-spin mx-auto" />
          <h3 className="text-lg font-bold text-[#0F172A]">Ingestion in Progress</h3>
          <p className="text-xs text-[#64748B] max-w-md mx-auto">
            {inProgressDocs.length} document(s) are currently being processed into
            semantic chunks and embeddings. Your study roadmap will be ready to
            generate as soon as processing finishes.
          </p>
          <button
            onClick={loadData}
            className="px-4 py-2 rounded-btn text-xs font-bold bg-[#FFFBEB] text-[#D97706] hover:bg-amber-100 transition border border-amber-300 min-h-[44px]"
          >
            Check Status
          </button>
        </div>
      )}

      {/* Case 2: Insufficient materials (no ready docs) */}
      {readyDocs.length === 0 && inProgressDocs.length === 0 && !hasRoadmap && (
        <div className="bg-white rounded-2xl p-8 sm:p-12 border border-[#E2E8F0] shadow-card text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-[#EEF2FF] border border-indigo-100 flex items-center justify-center mx-auto text-[#4F46E5]">
            <Calendar className="w-7 h-7" />
          </div>
          <div className="space-y-2 max-w-md mx-auto">
            <h3 className="text-xl font-bold text-[#0F172A]">Source Material Needed</h3>
            <p className="text-xs text-[#64748B] leading-relaxed">
              To build a structured syllabus roadmap, {MASCOT_NAME} needs course notes,
              textbook chapters, or lecture slides. Upload your materials in the
              Knowledge Base to start.
            </p>
          </div>
          <div>
            <button
              onClick={onGoToMaterials}
              className="px-6 py-3 rounded-btn text-xs font-bold bg-[#4F46E5] text-white hover:bg-[#4338CA] transition shadow-sm inline-flex items-center gap-2 min-h-[44px]"
            >
              <span>Go to Knowledge Base</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Case 3: Ready to generate roadmap for the first time */}
      {readyDocs.length > 0 && !hasRoadmap && inProgressDocs.length === 0 && (
        <div className="bg-white rounded-2xl p-8 sm:p-12 border border-[#E2E8F0] shadow-card text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-[#EEF2FF] border border-indigo-100 flex items-center justify-center mx-auto text-[#4F46E5]">
            <Sparkles className="w-8 h-8" />
          </div>
          <div className="space-y-2 max-w-lg mx-auto">
            <h3 className="text-2xl font-extrabold text-[#0F172A]">
              Create Your Personalized Study Roadmap
            </h3>
            <p className="text-xs text-[#64748B] leading-relaxed">
              {MASCOT_NAME} will analyze {readyDocs.length} uploaded document(s),
              sequence the key topics logically over your target of{" "}
              <strong className="text-[#4F46E5]">{course.goal_days} days</strong> at{" "}
              <strong className="text-[#4F46E5]">{course.hours_per_day} hours/day</strong>,
              and produce actionable daily study milestones.
            </p>
          </div>

          <div className="inline-flex items-center gap-6 px-6 py-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#334155]">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#4F46E5]" />
              <span>{course.goal_days} Study Days</span>
            </div>
            <div className="h-4 w-px bg-[#E2E8F0]" />
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#4F46E5]" />
              <span>{course.hours_per_day} Hours/Day</span>
            </div>
            <div className="h-4 w-px bg-[#E2E8F0]" />
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-[#4F46E5]" />
              <span className="capitalize">{course.level} Level</span>
            </div>
          </div>

          <div>
            <button
              onClick={() => handleGenerateRoadmap(false)}
              disabled={generating}
              className="px-8 py-3.5 rounded-btn text-xs font-bold bg-[#4F46E5] text-white hover:bg-[#4338CA] transition shadow-sm inline-flex items-center gap-2 disabled:opacity-50 min-h-[44px]"
            >
              {generating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Synthesizing Syllabus Topics & Roadmap...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Roadmap with {MASCOT_NAME}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Case 4: Roadmap exists */}
      {hasRoadmap && (
        <div className="space-y-6">
          {/* Progress Header Card */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 border border-[#E2E8F0] shadow-card space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-pill bg-[#EEF2FF] text-[#4F46E5] border border-indigo-100">
                  Personalized Study Plan
                </span>
                <h2 className="text-2xl font-extrabold text-[#0F172A] mt-1">
                  Daily Learning Milestones
                </h2>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleReplanRoadmap}
                  disabled={replanning || generating}
                  title="Preserves completed milestones and optimizes remaining days using your latest topic mastery"
                  className="px-3.5 py-2 rounded-btn text-xs font-bold text-[#4F46E5] hover:text-[#4338CA] bg-[#EEF2FF] hover:bg-indigo-100 transition border border-indigo-200 flex items-center gap-1.5 min-h-[38px]"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${replanning ? "animate-spin" : ""}`} />
                  <span>{replanning ? "Re-planning..." : "Re-plan from Mastery"}</span>
                </button>
                <button
                  onClick={() => setShowConfirmRegenerate(true)}
                  disabled={generating || replanning}
                  className="px-3.5 py-2 rounded-btn text-xs font-bold text-[#64748B] hover:text-[#0F172A] bg-white hover:bg-[#F8FAFC] transition border border-[#E2E8F0] flex items-center gap-1.5 min-h-[38px]"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${generating ? "animate-spin" : ""}`} />
                  <span>Regenerate Plan</span>
                </button>
              </div>
            </div>

            {/* Regeneration confirmation warning banner */}
            {showConfirmRegenerate && (
              <div className="p-4 rounded-xl bg-[#FFFBEB] border border-amber-200 text-[#D97706] text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in">
                <div className="space-y-1">
                  <p className="font-bold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-[#D97706]" />
                    Reset existing progress?
                  </p>
                  <p className="text-[#D97706]/90">
                    Regenerating will rebuild the schedule based on your current course
                    materials. Any checked tasks and milestones will be reset.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setShowConfirmRegenerate(false)}
                    className="px-3 py-1.5 rounded-btn text-xs font-semibold bg-white text-[#64748B] hover:text-[#0F172A] border border-[#E2E8F0]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleGenerateRoadmap(true)}
                    className="px-3 py-1.5 rounded-btn text-xs font-bold bg-[#D97706] text-white hover:bg-amber-700 shadow-sm"
                  >
                    Yes, Regenerate
                  </button>
                </div>
              </div>
            )}

            {/* Completion Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#0F172A] flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-[#D97706]" />
                  Roadmap Completion
                </span>
                <span className="font-bold text-[#4F46E5]">
                  {roadmap.percent_complete}%
                </span>
              </div>
              <div className="w-full bg-[#E2E8F0] rounded-full h-3 p-0.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-[#4F46E5] to-[#0D9488] h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(3, roadmap.percent_complete)}%` }}
                />
              </div>
            </div>

            {/* Metric counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
              <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <p className="text-[10px] uppercase font-bold text-[#64748B]">Days Finished</p>
                <p className="text-lg font-extrabold text-[#0F172A]">
                  {roadmap.completed_days} / {roadmap.total_days}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <p className="text-[10px] uppercase font-bold text-[#64748B]">Tasks Completed</p>
                <p className="text-lg font-extrabold text-[#0F172A]">
                  {roadmap.completed_tasks} / {roadmap.total_tasks}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <p className="text-[10px] uppercase font-bold text-[#64748B]">Daily Study Target</p>
                <p className="text-lg font-extrabold text-[#0F172A]">{course.hours_per_day} hrs</p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <p className="text-[10px] uppercase font-bold text-[#64748B]">Total Milestones</p>
                <p className="text-lg font-extrabold text-[#0F172A]">{roadmap.items.length}</p>
              </div>
            </div>
          </div>

          {/* Daily Milestone Cards Timeline */}
          <div className="space-y-4">
            {roadmap.items.map((item) => {
              const isDayComplete = item.completed;

              return (
                <div
                  key={item.id}
                  className={`bg-white rounded-2xl p-5 sm:p-6 border transition-all duration-300 shadow-sm ${
                    isDayComplete
                      ? "border-teal-200 bg-[#F0FDFA]/40"
                      : "border-[#E2E8F0] hover:shadow-card-hover"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-[#E2E8F0]">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-pill border ${
                            isDayComplete
                              ? "bg-[#F0FDFA] text-[#0D9488] border-teal-200"
                              : "bg-[#EEF2FF] text-[#4F46E5] border-indigo-200"
                          }`}
                        >
                          Day {item.day}
                        </span>
                        <span className="text-[11px] font-semibold text-[#64748B]">
                          {item.topic_name}
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-[#0F172A]">
                        {item.title}
                      </h3>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5 text-xs text-[#64748B] px-3 py-1 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                        <Clock className="w-3.5 h-3.5 text-[#4F46E5]" />
                        <span>~{item.estimated_minutes} mins</span>
                      </div>

                      <button
                        onClick={() => handleToggleDay(item)}
                        className={`px-3 py-1.5 rounded-btn text-xs font-bold transition border flex items-center gap-1.5 min-h-[38px] ${
                          isDayComplete
                            ? "bg-[#F0FDFA] text-[#0D9488] border-teal-200"
                            : "bg-white text-[#334155] border-[#E2E8F0] hover:bg-[#F8FAFC]"
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#0D9488]" />
                        <span>{isDayComplete ? "Completed" : "Mark Done"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Learning Objectives */}
                  {item.learning_objectives && item.learning_objectives.length > 0 && (
                    <div className="pt-4 pb-3 space-y-1.5">
                      <p className="text-[11px] uppercase font-bold text-[#64748B] tracking-wider">
                        Learning Objectives
                      </p>
                      <ul className="space-y-1">
                        {item.learning_objectives.map((obj, idx) => (
                          <li
                            key={idx}
                            className="text-xs text-[#334155] flex items-start gap-2"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-[#4F46E5] mt-1.5 shrink-0" />
                            <span>{obj}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Tasks Checklist */}
                  <div className="pt-3 space-y-2">
                    <p className="text-[11px] uppercase font-bold text-[#64748B] tracking-wider flex items-center gap-1.5">
                      <ListTodo className="w-3.5 h-3.5 text-[#4F46E5]" />
                      Study Tasks Checklist
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {item.tasks.map((task) => {
                        const isTaskUpdating = updatingTaskId === task.id;

                        return (
                          <div
                            key={task.id}
                            className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition ${
                              task.completed
                                ? "bg-[#F0FDFA] border-teal-200 text-[#64748B]"
                                : "bg-[#F8FAFC] border-[#E2E8F0] hover:border-slate-300 text-[#0F172A]"
                            }`}
                          >
                            <label className="flex items-start gap-3 cursor-pointer flex-1">
                              <input
                                type="checkbox"
                                checked={task.completed}
                                disabled={isTaskUpdating}
                                onChange={() =>
                                  handleToggleTask(item, task.id, task.completed)
                                }
                                className="mt-0.5 rounded border-[#E2E8F0] text-[#4F46E5] focus:ring-[#4F46E5]"
                              />
                              <span
                                className={`text-xs font-medium leading-relaxed ${
                                  task.completed ? "line-through text-[#64748B]" : ""
                                }`}
                              >
                                {task.task}
                              </span>
                            </label>

                            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                              <span className="text-[10px] font-semibold text-[#64748B] px-2 py-0.5 rounded-pill bg-white border border-[#E2E8F0]">
                                {task.estimated_minutes}m
                              </span>

                              {onOpenLesson && (
                                <button
                                  type="button"
                                  onClick={() => onOpenLesson(item, task.id)}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-xs font-bold transition border min-h-[36px] ${
                                    task.completed
                                      ? "bg-white text-[#64748B] border-[#E2E8F0] hover:bg-[#F8FAFC]"
                                      : "bg-[#EEF2FF] text-[#4F46E5] border-indigo-200 hover:bg-indigo-100"
                                  }`}
                                >
                                  <BookOpen className="w-3.5 h-3.5" />
                                  <span>{task.completed ? "Review Lesson" : "Start Learning"}</span>
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
