import React, { useState } from "react";
import { Clock, Calendar, ChevronRight, Trash2 } from "lucide-react";
import { Course } from "../types";

interface CourseCardProps {
  course: Course;
  onSelect: (course: Course) => void;
  onDelete: (courseId: number) => Promise<void>;
}

export const CourseCard: React.FC<CourseCardProps> = ({
  course,
  onSelect,
  onDelete,
}) => {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete course "${course.name}"?`)) {
      return;
    }
    setDeleting(true);
    try {
      await onDelete(course.id);
    } finally {
      setDeleting(false);
    }
  };

  const getLevelBadge = (level: string) => {
    switch (level.toLowerCase()) {
      case "advanced":
        return "bg-rose-500/10 text-rose-300 border-rose-500/20";
      case "intermediate":
        return "bg-amber-500/10 text-amber-300 border-amber-500/20";
      default:
        return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
    }
  };

  return (
    <div
      onClick={() => onSelect(course)}
      className="glass-card rounded-2xl p-5 cursor-pointer group transition-all relative flex flex-col justify-between hover:-translate-y-1"
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <span
            className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${getLevelBadge(
              course.level
            )}`}
          >
            {course.level}
          </span>

          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors"
            title="Delete Course"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <h3 className="mt-3 text-lg font-bold text-white group-hover:text-brand-300 transition-colors line-clamp-2">
          {course.name}
        </h3>
      </div>

      <div className="mt-5 pt-4 border-t border-slate-800/80">
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-brand-400" />
            <span>{course.goal_days} days goal</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-brand-400" />
            <span>{course.hours_per_day} hrs/day</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs font-semibold text-brand-400 group-hover:text-brand-300">
          <span>Enter Course</span>
          <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </div>
  );
};
