import React, { useEffect, useState } from "react";
import { Plus, BookOpen, Clock, Target, Loader2, AlertCircle } from "lucide-react";
import { Course, CreateCourseInput } from "../types";
import { api } from "../services/api";
import { CourseCard } from "../components/CourseCard";
import { CreateCourseModal } from "../components/CreateCourseModal";
import { MascotPlaceholder } from "../components/MascotPlaceholder";

interface DashboardPageProps {
  onSelectCourse: (course: Course) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onSelectCourse }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchCourses = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getCourses();
      setCourses(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load courses");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
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
            <span className="text-xs font-bold uppercase tracking-wider text-brand-400 bg-brand-500/10 border border-brand-500/20 px-3 py-1 rounded-full">
              Learning Dashboard
            </span>
            <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Personalized Study Tracks
            </h1>
            <p className="mt-2 text-sm text-slate-400 max-w-xl">
              Create structured courses from your textbooks, lecture notes, and syllabus materials.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-4 pt-6 border-t border-slate-800">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <BookOpen className="w-3.5 h-3.5 text-brand-400" />
                <span>Active Courses</span>
              </div>
              <p className="text-xl font-extrabold text-white">{courses.length}</p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <Clock className="w-3.5 h-3.5 text-brand-400" />
                <span>Planned Hours</span>
              </div>
              <p className="text-xl font-extrabold text-white">
                {totalHoursPlanned.toFixed(0)}h
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <Target className="w-3.5 h-3.5 text-brand-400" />
                <span>Avg Goal Days</span>
              </div>
              <p className="text-xl font-extrabold text-white">
                {courses.length > 0
                  ? (
                      courses.reduce((acc, c) => acc + c.goal_days, 0) / courses.length
                    ).toFixed(0)
                  : 0}d
              </p>
            </div>
          </div>
        </div>

        {/* Study Buddy Mascot Reserved Slot */}
        <div className="flex flex-col justify-center">
          <MascotPlaceholder />
        </div>
      </div>

      {/* Courses Section Header */}
      <div className="flex items-center justify-between">
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
            onClick={fetchCourses}
            className="underline hover:text-white font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin mb-3" />
          <p className="text-xs text-slate-400 font-medium">Loading courses...</p>
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

      {/* Modal */}
      <CreateCourseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateCourse}
      />
    </div>
  );
};
