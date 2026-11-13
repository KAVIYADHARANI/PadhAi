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
        return "bg-error-light text-error border-error/25";
      case "intermediate":
        return "bg-warning-light text-warning border-warning/25";
      default:
        return "bg-accent-light text-accent border-accent/25";
    }
  };

  return (
    <div
      onClick={() => onSelect(course)}
      className="bg-surface rounded-2xl p-5 cursor-pointer group transition-all relative flex flex-col justify-between border border-line shadow-card hover:shadow-card-hover hover:border-primary hover:-translate-y-0.5 min-h-[180px]"
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <span
            className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-pill border ${getLevelBadge(
              course.level
            )}`}
          >
            {course.level}
          </span>

          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-muted hover:text-error p-1.5 rounded-lg hover:bg-error-light transition-colors"
            title="Delete Course"
            aria-label="Delete Course"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <h3 className="mt-3 text-lg font-bold text-heading group-hover:text-primary transition-colors line-clamp-2">
          {course.name}
        </h3>
      </div>

      <div className="mt-5 pt-4 border-t border-line">
        <div className="grid grid-cols-2 gap-2 text-xs text-muted">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-primary" />
            <span>{course.goal_days} days goal</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-primary" />
            <span>{course.hours_per_day} hrs/day</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs font-semibold text-primary group-hover:text-primary-hover">
          <span>Enter Course</span>
          <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </div>
  );
};
