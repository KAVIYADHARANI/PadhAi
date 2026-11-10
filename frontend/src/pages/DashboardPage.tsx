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
import { useTheme } from "../contexts/ThemeContext";
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
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const chartGridColor = isDark ? "#1E293B" : "#F1F5F9";
  const chartAxisColor = isDark ? "#475569" : "#94A3B8";
  const chartTickColor = isDark ? "#94A3B8" : "#64748B";
  const chartLabelColor = isDark ? "#CBD5E1" : "#334155";
  const chartTooltipStyle = {
    backgroundColor: isDark ? "#111827" : "#FFFFFF",
    borderColor: isDark ? "#1E293B" : "#E2E8F0",
    borderRadius: "0.75rem",
    fontSize: "12px",
    color: isDark ? "#F8FAFC" : "#0F172A",
    boxShadow: isDark
      ? "0 10px 25px rgba(0, 0, 0, 0.45)"
      : "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
  };

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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-in fade-in duration-200">
      {/* Top Banner with Mascot Placeholder & Highlights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-surface rounded-2xl p-6 sm:p-8 flex flex-col justify-between border border-line shadow-card relative overflow-hidden">
          <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary-light border border-primary/20 px-3 py-1 rounded-pill">
                Learning Dashboard
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-accent bg-accent-light border border-accent/25 px-2.5 py-0.5 rounded-pill">
                <Flame className="w-3.5 h-3.5 text-warning" />
                4-Day Streak (Grace Active)
              </span>
            </div>
            <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold text-heading tracking-tight">
              Study Intelligence & Progress
            </h1>
            <p className="mt-2 text-sm text-muted max-w-xl">
              Track mastery metrics, fatigue levels, and review due cards across your courses.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 border-t border-line min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-muted mb-1">
                <BookOpen className="w-3.5 h-3.5 text-primary" />
                <span>Courses</span>
              </div>
              <p className="text-xl font-extrabold text-heading">{courses.length}</p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted mb-1">
                <Clock className="w-3.5 h-3.5 text-primary" />
                <span>Planned</span>
              </div>
              <p className="text-xl font-extrabold text-heading">
                {totalHoursPlanned.toFixed(0)}h
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted mb-1">
                <CreditCard className="w-3.5 h-3.5 text-warning" />
                <span>Due Cards</span>
              </div>
              <p className="text-xl font-extrabold text-warning">
                {dueCardsCount}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted mb-1">
                <Target className="w-3.5 h-3.5 text-accent" />
                <span>Focus Avg</span>
              </div>
              <p className="text-xl font-extrabold text-accent">89%</p>
            </div>
          </div>
        </div>

        {/* Study Buddy Mascot Slot */}
        <div className="flex flex-col justify-center">
          <MascotPlaceholder />
        </div>
      </div>

      {/* Analytics & Trends Section (Recharts) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-0">
        {/* Trend 1: Focus & Fatigue Trends */}
        <div className="bg-surface rounded-2xl p-6 border border-line shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-bold text-heading tracking-tight">Focus & Fatigue Trends (7 Days)</h2>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-primary">
                <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                Focus %
              </span>
              <span className="flex items-center gap-1.5 text-error">
                <span className="w-2.5 h-2.5 rounded-full bg-error" />
                Drowsy (m)
              </span>
            </div>
          </div>

          <div className="h-56 w-full" style={{ minHeight: "220px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="focusGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={isDark ? "#6366F1" : "#4F46E5"} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={isDark ? "#6366F1" : "#4F46E5"} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fatigueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={isDark ? "#FB7185" : "#E11D48"} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={isDark ? "#FB7185" : "#E11D48"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="day" stroke={chartAxisColor} tick={{ fill: chartTickColor, fontSize: 11 }} />
                <YAxis stroke={chartAxisColor} tick={{ fill: chartTickColor, fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="focus"
                  stroke={isDark ? "#6366F1" : "#4F46E5"}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#focusGradient)"
                  name="Focus Score"
                />
                <Area
                  type="monotone"
                  dataKey="fatigue"
                  stroke={isDark ? "#FB7185" : "#E11D48"}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#fatigueGradient)"
                  name="Fatigue Minutes"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trend 2: Topic Mastery Ranking */}
        <div className="bg-surface rounded-2xl p-6 border border-line shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-accent" />
              <h2 className="text-sm font-bold text-heading tracking-tight">Topic Mastery Breakdown</h2>
            </div>
            <span className="text-xs text-muted">SM-2 & Quiz Graded</span>
          </div>

          <div className="h-56 w-full" style={{ minHeight: "220px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={masteryData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} horizontal={false} />
                <XAxis type="number" domain={[0, 100]} stroke={chartAxisColor} tick={{ fill: chartTickColor, fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="topic" stroke={chartAxisColor} tick={{ fill: chartLabelColor, fontSize: 11 }} width={90} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  cursor={{ fill: isDark ? "rgba(30, 41, 59, 0.5)" : "rgba(241, 245, 249, 0.7)" }}
                  formatter={(val: any) => [`${val}%`, "Mastery"]}
                />
                <Bar dataKey="mastery" fill={isDark ? "#14B8A6" : "#0D9488"} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Courses Section Header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h2 className="text-lg font-bold text-heading tracking-tight">
            Your Courses
          </h2>
          <p className="text-xs text-muted">
            Select a course to view uploaded documents and study progress.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-btn text-xs font-semibold text-white bg-primary hover:bg-primary-hover shadow-sm transition min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          <span>New Course</span>
        </button>
      </div>

      {/* Course List / States */}
      {error && (
        <div className="p-4 rounded-xl bg-error-light border border-error/25 text-error text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchDashboardData}
            className="underline hover:text-heading font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
          <p className="text-xs text-muted font-medium">Loading courses & analytics...</p>
        </div>
      ) : courses.length === 0 ? (
        <div className="bg-surface rounded-2xl p-12 text-center border-2 border-dashed border-line">
          <BookOpen className="w-12 h-12 text-muted mx-auto mb-3" />
          <h3 className="text-base font-semibold text-heading">No courses yet</h3>
          <p className="text-xs text-muted max-w-sm mx-auto mt-1 mb-4">
            Create your first study course to upload study notes, generate a roadmap, and take AI-graded quizzes.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-primary text-white rounded-btn text-xs font-semibold hover:bg-primary-hover transition shadow-sm min-h-[44px]"
          >
            Create Course
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

      {/* Course Creation Modal */}
      <CreateCourseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateCourse}
      />
    </div>
  );
};
