import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
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
}

export const RoadmapView: React.FC<RoadmapViewProps> = ({
  course,
  onGoToMaterials,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [generating, setGenerating] = useState<boolean>(false);
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

  const handleToggleTask = async (
    item: RoadmapItem,
    taskId: string,
    currentStatus: boolean
  ) => {
    setUpdatingTaskId(taskId);
    try {
      const updated = await api.updateRoadmapItem(course.id, item.id, {
        task_id: taskId,
        task_completed: !currentStatus,
      });

      // Update local roadmap items
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
      console.error("Failed to update task status:", err);
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
      <div className="glass-panel rounded-3xl p-12 text-center border border-slate-800 space-y-4">
        <RefreshCw className="w-8 h-8 text-brand-400 animate-spin mx-auto" />
        <p className="text-sm font-semibold text-slate-300">
          Loading your personalized study roadmap...
        </p>
      </div>
    );
  }

  const hasRoadmap = roadmap && roadmap.items && roadmap.items.length > 0;

  return (
    <div className="space-y-6">
      {/* Error notification */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">{error}</p>
            {error.toLowerCase().includes("api key") && (
              <p className="text-slate-400 text-[11px] pt-1 leading-relaxed">
                Tip: Configure <code className="text-brand-300 font-mono">GROQ_API_KEY</code>, <code className="text-brand-300 font-mono">OPENROUTER_API_KEY</code>, or <code className="text-brand-300 font-mono">GOOGLE_API_KEY</code> in your root <code className="text-brand-300 font-mono">.env</code> file, then restart the development server.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Case 1: Ingestion in progress */}
      {inProgressDocs.length > 0 && !hasRoadmap && (
        <div className="glass-panel rounded-3xl p-8 border border-amber-500/20 bg-amber-500/5 space-y-4 text-center">
          <RefreshCw className="w-10 h-10 text-amber-400 animate-spin mx-auto" />
          <h3 className="text-lg font-bold text-white">Ingestion in Progress</h3>
          <p className="text-xs text-slate-300 max-w-md mx-auto">
            {inProgressDocs.length} document(s) are currently being processed into
            semantic chunks and embeddings. Your study roadmap will be ready to
            generate as soon as processing finishes.
          </p>
          <button
            onClick={loadData}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition border border-amber-500/30"
          >
            Check Status
          </button>
        </div>
      )}

      {/* Case 2: Insufficient materials (no ready docs) */}
      {readyDocs.length === 0 && inProgressDocs.length === 0 && !hasRoadmap && (
        <div className="glass-panel rounded-3xl p-8 sm:p-12 border border-slate-800 text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mx-auto text-brand-400">
            <Calendar className="w-7 h-7" />
          </div>
          <div className="space-y-2 max-w-md mx-auto">
            <h3 className="text-xl font-bold text-white">Source Material Needed</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              To build a structured syllabus roadmap, {MASCOT_NAME} needs course notes,
              textbook chapters, or lecture slides. Upload your materials in the
              Knowledge Base to start.
            </p>
          </div>
          <div>
            <button
              onClick={onGoToMaterials}
              className="px-6 py-3 rounded-2xl text-xs font-bold bg-gradient-to-r from-brand-500 to-indigo-600 text-white hover:from-brand-600 hover:to-indigo-700 transition shadow-lg shadow-brand-500/25 inline-flex items-center gap-2"
            >
              <span>Go to Knowledge Base</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Case 3: Ready to generate roadmap for the first time */}
      {readyDocs.length > 0 && !hasRoadmap && inProgressDocs.length === 0 && (
        <div className="glass-panel rounded-3xl p-8 sm:p-12 border border-slate-800 text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-brand-500/20 to-indigo-500/20 border border-brand-500/30 flex items-center justify-center mx-auto text-brand-400">
            <Sparkles className="w-8 h-8" />
          </div>
          <div className="space-y-2 max-w-lg mx-auto">
            <h3 className="text-2xl font-extrabold text-white">
              Create Your Personalized Study Roadmap
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              {MASCOT_NAME} will analyze {readyDocs.length} uploaded document(s),
              sequence the key topics logically over your target of{" "}
              <strong className="text-brand-300">{course.goal_days} days</strong> at{" "}
              <strong className="text-brand-300">{course.hours_per_day} hours/day</strong>,
              and produce actionable daily study milestones.
            </p>
          </div>

          <div className="inline-flex items-center gap-6 px-6 py-3 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-brand-400" />
              <span>{course.goal_days} Study Days</span>
            </div>
            <div className="h-4 w-px bg-slate-800" />
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand-400" />
              <span>{course.hours_per_day} Hours/Day</span>
            </div>
            <div className="h-4 w-px bg-slate-800" />
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-brand-400" />
              <span className="capitalize">{course.level} Level</span>
            </div>
          </div>

          <div>
            <button
              onClick={() => handleGenerateRoadmap(false)}
              disabled={generating}
              className="px-8 py-3.5 rounded-2xl text-xs font-bold bg-gradient-to-r from-brand-500 to-indigo-600 text-white hover:from-brand-600 hover:to-indigo-700 transition shadow-lg shadow-brand-500/25 inline-flex items-center gap-2 disabled:opacity-50"
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
        <div className="space-y-6 animate-fadeIn">
          {/* Progress Header Card */}
          <div className="glass-panel rounded-3xl p-6 sm:p-8 border border-slate-800 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-300 border border-brand-500/20">
                  Personalized Study Plan
                </span>
                <h2 className="text-2xl font-extrabold text-white mt-1">
                  Daily Learning Milestones
                </h2>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowConfirmRegenerate(true)}
                  disabled={generating}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 transition border border-slate-700 flex items-center gap-2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${generating ? "animate-spin" : ""}`} />
                  <span>Regenerate Plan</span>
                </button>
              </div>
            </div>

            {/* Regeneration confirmation warning banner */}
            {showConfirmRegenerate && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fadeIn">
                <div className="space-y-1">
                  <p className="font-bold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                    Reset existing progress?
                  </p>
                  <p className="text-amber-300/80">
                    Regenerating will rebuild the schedule based on your current course
                    materials. Any checked tasks and milestones will be reset.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setShowConfirmRegenerate(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleGenerateRoadmap(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400"
                  >
                    Yes, Regenerate
                  </button>
                </div>
              </div>
            )}

            {/* Completion Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-brand-400" />
                  Roadmap Completion
                </span>
                <span className="font-bold text-brand-300">
                  {roadmap.percent_complete}%
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-3 p-0.5 border border-slate-800 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-brand-500 to-indigo-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(3, roadmap.percent_complete)}%` }}
                />
              </div>
            </div>

            {/* Metric counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
              <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p className="text-[10px] uppercase font-bold text-slate-400">Days Finished</p>
                <p className="text-lg font-extrabold text-white">
                  {roadmap.completed_days} / {roadmap.total_days}
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p className="text-[10px] uppercase font-bold text-slate-400">Tasks Completed</p>
                <p className="text-lg font-extrabold text-white">
                  {roadmap.completed_tasks} / {roadmap.total_tasks}
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p className="text-[10px] uppercase font-bold text-slate-400">Daily Study Target</p>
                <p className="text-lg font-extrabold text-white">{course.hours_per_day} hrs</p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p className="text-[10px] uppercase font-bold text-slate-400">Total Milestones</p>
                <p className="text-lg font-extrabold text-white">{roadmap.items.length}</p>
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
                  className={`glass-panel rounded-2xl p-5 sm:p-6 border transition-all duration-300 ${
                    isDayComplete
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-800/80">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border ${
                            isDayComplete
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                              : "bg-brand-500/20 text-brand-300 border-brand-500/30"
                          }`}
                        >
                          Day {item.day}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-400">
                          {item.topic_name}
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-white">
                        {item.title}
                      </h3>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 px-3 py-1 rounded-xl bg-slate-900 border border-slate-800">
                        <Clock className="w-3.5 h-3.5 text-brand-400" />
                        <span>~{item.estimated_minutes} mins</span>
                      </div>

                      <button
                        onClick={() => handleToggleDay(item)}
                        className={`px-3 py-1 rounded-xl text-xs font-bold transition border flex items-center gap-1.5 ${
                          isDayComplete
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                            : "bg-slate-800 text-slate-300 border-slate-700 hover:text-white"
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{isDayComplete ? "Completed" : "Mark Done"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Learning Objectives */}
                  {item.learning_objectives && item.learning_objectives.length > 0 && (
                    <div className="pt-4 pb-3 space-y-1.5">
                      <p className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
                        Learning Objectives
                      </p>
                      <ul className="space-y-1">
                        {item.learning_objectives.map((obj, idx) => (
                          <li
                            key={idx}
                            className="text-xs text-slate-300 flex items-start gap-2"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 mt-1.5 shrink-0" />
                            <span>{obj}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Tasks Checklist */}
                  <div className="pt-3 space-y-2">
                    <p className="text-[11px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
                      <ListTodo className="w-3.5 h-3.5 text-brand-400" />
                      Study Tasks Checklist
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {item.tasks.map((task) => {
                        const isTaskUpdating = updatingTaskId === task.id;

                        return (
                          <label
                            key={task.id}
                            className={`flex items-start justify-between gap-3 p-3 rounded-xl border transition cursor-pointer ${
                              task.completed
                                ? "bg-emerald-500/10 border-emerald-500/20 text-slate-400 line-through"
                                : "bg-slate-900/50 border-slate-800 hover:border-slate-700 text-slate-200"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={task.completed}
                                disabled={isTaskUpdating}
                                onChange={() =>
                                  handleToggleTask(item, task.id, task.completed)
                                }
                                className="mt-0.5 rounded border-slate-700 text-brand-500 focus:ring-brand-400 focus:ring-offset-slate-900"
                              />
                              <span className="text-xs font-medium leading-relaxed">
                                {task.task}
                              </span>
                            </div>

                            <span className="text-[10px] font-semibold text-slate-400 px-2 py-0.5 rounded-md bg-slate-800/80 shrink-0">
                              {task.estimated_minutes}m
                            </span>
                          </label>
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
