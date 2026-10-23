import React from "react";
import { ArrowLeft, Calendar, Clock, BookMarked, Sparkles } from "lucide-react";
import { Course } from "../types";
import { DocumentUpload } from "../components/DocumentUpload";
import { MascotPlaceholder } from "../components/MascotPlaceholder";

interface CoursePageProps {
  course: Course;
  onBack: () => void;
}

export const CoursePage: React.FC<CoursePageProps> = ({ course, onBack }) => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fadeIn">
      {/* Back button */}
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition group"
        >
          <ArrowLeft className="w-4 h-4 transform group-hover:-translate-x-1 transition-transform" />
          <span>Back to Dashboard</span>
        </button>
      </div>

      {/* Course Banner Header */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 relative overflow-hidden border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-300 border border-brand-500/20">
                {course.level} Level
              </span>
              <span className="text-xs text-slate-400">
                Created {new Date(course.created_at).toLocaleDateString()}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {course.name}
            </h1>
          </div>

          <div className="flex items-center gap-4 bg-slate-900/60 p-3 rounded-2xl border border-slate-800 shrink-0">
            <div className="flex items-center gap-2 px-3 py-1">
              <Calendar className="w-4 h-4 text-brand-400" />
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Goal Timeline</p>
                <p className="text-sm font-bold text-white">{course.goal_days} Days</p>
              </div>
            </div>

            <div className="h-8 w-px bg-slate-800" />

            <div className="flex items-center gap-2 px-3 py-1">
              <Clock className="w-4 h-4 text-brand-400" />
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Daily Target</p>
                <p className="text-sm font-bold text-white">{course.hours_per_day} Hours</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Document Upload and Processing Status */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-brand-400" />
            <h2 className="text-base font-bold text-white">Course Knowledge Base</h2>
          </div>

          <DocumentUpload courseId={course.id} />
        </div>

        {/* Right Col: Study Companion Status */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-400" />
            <h2 className="text-base font-bold text-white">Companion Readiness</h2>
          </div>

          <MascotPlaceholder status="standby" />

          <div className="glass-card rounded-2xl p-5 border border-slate-800/80 text-xs text-slate-400 space-y-2">
            <h3 className="font-semibold text-white">Document Ingestion Pipeline</h3>
            <p>
              Once PDFs or notes are uploaded, the ingestion worker segments them into semantic chunks
              and generates BGE-M3 vector embeddings for grounded tutor chat.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
