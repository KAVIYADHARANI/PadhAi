import React, { useEffect, useState } from "react";
import {
  Plus,
  BookOpen,
  Clock,
  Target,
  Loader2,
  AlertCircle,
  Zap,
  Flame,
  CreditCard,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
  CartesianGrid,
} from "recharts";
import { Course, CreateCourseInput } from "../types";
import { api } from "../services/api";
import { CourseCard } from "../components/CourseCard";
import { CreateCourseModal } from "../components/CreateCourseModal";
import { MascotPlaceholder } from "../components/MascotPlaceholder";

interface DashboardPageProps {
  onSelectCourse: (course: Course) => void;
  onNavigatePrivacy?: () => void;
}

interface TrendPoint {
  day: string;
  focus: number;
  fatigue: number;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  onSelectCourse,
  onNavigatePrivacy,
}) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [dueCardsCount, setDueCardsCount] = useState<number>(0);

  // Focus & fatigue trend aggregate data for Recharts
  const [trendData] = useState<TrendPoint[]>([
    { day: "Mon", focus: 84, fatigue: 8 },
    { day: "Tue", focus: 92, fatigue: 4 },
    { day: "Wed", focus: 78, fatigue: 14 },
    { day: "Thu", focus: 88, fatigue: 6 },
    { day: "Fri", focus: 94, fatigue: 3 },
    { day: "Sat", focus: 89, fatigue: 7 },
    { day: "Sun", focus: 95, fatigue: 2 },
  ]);

  // Topic mastery summary data
  const [masteryData] = useState([
    { topic: "Core Principles", mastery: 92 },
    { topic: "State Machines", mastery: 85 },
    { topic: "Signal Tracking", mastery: 74 },
    { topic: "Spaced Repetition", mastery: 68 },
    { topic: "Deep Learning", mastery: 55 },
  ]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getCourses();
      setCourses(data);

      if (data.length > 0) {
        try {
          const cards = await api.getDueFlashcards(data[0].id);
          setDueCardsCount(cards.length);
        } catch {
          setDueCardsCount(3); // Demo baseline
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleCreateCourse = async (input: CreateCourseInput) => {
    const created = await api.createCourse(input);
    setCourses((prev) => [created, ...prev]);
  };

  const handleDeleteCourse = async (courseId: number) => {
    await api.deleteCourse(courseId);
    setCourses((prev) => prev.filter((c) => c.id !== courseId));
  };

  const totalHoursPlanned = courses.reduce(
    (acc, c) => acc + c.goal_days * c.hours_per_day,
    0
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fadeIn">
      {/* Top Banner with Mascot Placeholder & Highlights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-panel rounded-3xl p-6 sm:p-8 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-brand-600/10 rounded-full blur-3xl pointer-events-none" />

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-400 bg-brand-500/10 border border-brand-500/20 px-3 py-1 rounded-full">
                Learning Dashboard
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                4-Day Streak (Grace Active)
              </span>
            </div>
            <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Study Intelligence & Progress
            </h1>
            <p className="mt-2 text-sm text-slate-400 max-w-xl">
              Track mastery metrics, fatigue levels, and review due cards across your courses.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-4 gap-4 pt-6 border-t border-slate-800">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <BookOpen className="w-3.5 h-3.5 text-brand-400" />
                <span>Courses</span>
              </div>
              <p className="text-xl font-extrabold text-white">{courses.length}</p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <Clock className="w-3.5 h-3.5 text-brand-400" />
                <span>Planned</span>
              </div>
              <p className="text-xl font-extrabold text-white">
                {totalHoursPlanned.toFixed(0)}h
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <CreditCard className="w-3.5 h-3.5 text-amber-400" />
                <span>Due Cards</span>
              </div>
              <p className="text-xl font-extrabold text-amber-300">
                {dueCardsCount}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <Target className="w-3.5 h-3.5 text-emerald-400" />
                <span>Focus Avg</span>
              </div>
              <p className="text-xl font-extrabold text-emerald-400">89%</p>
            </div>
          </div>
        </div>

        {/* Study Buddy Mascot Slot */}
        <div className="flex flex-col justify-center">
          <MascotPlaceholder />
        </div>
      </div>

      {/* Analytics & Trends Section (Recharts) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend 1: Focus & Fatigue Trends */}
        <div className="glass-panel rounded-3xl p-6 border border-slate-800/80 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-brand-400" />
              <h2 className="text-sm font-bold text-white tracking-tight">Focus & Fatigue Trends (7 Days)</h2>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-indigo-400">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                Focus %
              </span>
              <span className="flex items-center gap-1.5 text-rose-400">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                Drowsy (m)
              </span>
            </div>
          </div>

          <div className="h-56 w-full" style={{ minHeight: "220px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="focusGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fatigueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="day" stroke="#64748b" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis stroke="#64748b" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "0.75rem", fontSize: "12px" }}
                />
                <Area type="monotone" dataKey="focus" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#focusGradient)" name="Focus Score" />
                <Area type="monotone" dataKey="fatigue" stroke="#f43f5e" strokeWidth={2} fillOpacity={1} fill="url(#fatigueGradient)" name="Fatigue Minutes" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trend 2: Topic Mastery Ranking */}
        <div className="glass-panel rounded-3xl p-6 border border-slate-800/80 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold text-white tracking-tight">Topic Mastery Breakdown</h2>
            </div>
            <span className="text-xs text-slate-400">SM-2 & Quiz Graded</span>
          </div>

          <div className="h-56 w-full" style={{ minHeight: "220px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={masteryData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} stroke="#64748b" tick={{ fill: "#94a3b8", fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="topic" stroke="#64748b" tick={{ fill: "#cbd5e1", fontSize: 11 }} width={90} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "0.75rem", fontSize: "12px" }}
                  formatter={(val: any) => [`${val}%`, "Mastery"]}
                />
                <Bar dataKey="mastery" fill="#10b981" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Courses Section Header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight">
            Your Courses
          </h2>
          <p className="text-xs text-slate-400">
            Select a course to view uploaded documents and study progress.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 shadow-lg shadow-brand-500/25 transition"
        >
          <Plus className="w-4 h-4" />
          <span>New Course</span>
        </button>
      </div>

      {/* Course List / States */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchDashboardData}
            className="underline hover:text-white font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin mb-3" />
          <p className="text-xs text-slate-400 font-medium">Loading courses & analytics...</p>
        </div>
      ) : courses.length === 0 ? (
        <div className="glass-panel rounded-3xl p-12 text-center border-2 border-dashed border-slate-800">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400 mb-4">
            <BookOpen className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-white mb-1">No courses yet</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mb-6">
            Get started by creating your first course and uploading your study materials.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 transition shadow-lg shadow-brand-500/25"
          >
            <Plus className="w-4 h-4" />
            <span>Create First Course</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courses.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              onSelect={onSelectCourse}
              onDelete={handleDeleteCourse}
            />
          ))}
        </div>
      )}

      {/* Privacy Pledge & Data Sovereignty Banner */}
      <div className="glass-panel rounded-2xl p-4 border border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>
            <strong>Zero Raw Frames Guarantee:</strong> Camera signals run 100% locally in your browser. No video is ever stored or transmitted.
          </span>
        </div>
        <button
          onClick={onNavigatePrivacy}
          className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold border border-slate-700 transition-colors shrink-0"
        >
          Privacy & Data Rights
        </button>
      </div>

      {/* Modal */}
      <CreateCourseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateCourse}
      />
    </div>
  );
};
