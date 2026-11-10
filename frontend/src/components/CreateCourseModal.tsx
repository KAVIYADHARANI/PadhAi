import React, { useState } from "react";
import { X, Plus, Sparkles } from "lucide-react";
import { CreateCourseInput } from "../types";

interface CreateCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateCourseInput) => Promise<void>;
}

export const CreateCourseModal: React.FC<CreateCourseModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState("");
  const [goalDays, setGoalDays] = useState(14);
  const [hoursPerDay, setHoursPerDay] = useState(2.0);
  const [level, setLevel] = useState<"beginner" | "intermediate" | "advanced">(
    "intermediate"
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter a course name");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        goal_days: Number(goalDays),
        hours_per_day: Number(hoursPerDay),
        level,
      });
      setName("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create course");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-surface w-full max-w-md rounded-2xl p-6 shadow-dropdown border border-line relative text-body">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted hover:text-heading p-1 rounded-lg hover:bg-subtle transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-primary-light border border-primary/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-heading">Create New Course</h2>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-error-light border border-error/25 text-error text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-heading mb-1.5">
              Course Title
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Operating Systems & Architecture"
              className="w-full px-3.5 py-2.5 rounded-btn bg-subtle border border-line text-heading placeholder:text-muted text-sm focus:outline-none focus:border-primary focus:bg-surface transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-heading mb-1.5">
                Target Days
              </label>
              <input
                type="number"
                min={1}
                max={365}
                required
                value={goalDays}
                onChange={(e) => setGoalDays(parseInt(e.target.value) || 1)}
                className="w-full px-3.5 py-2.5 rounded-btn bg-subtle border border-line text-heading text-sm focus:outline-none focus:border-primary focus:bg-surface transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-heading mb-1.5">
                Hours / Day
              </label>
              <input
                type="number"
                min={0.5}
                max={12}
                step={0.5}
                required
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(parseFloat(e.target.value) || 0.5)}
                className="w-full px-3.5 py-2.5 rounded-btn bg-subtle border border-line text-heading text-sm focus:outline-none focus:border-primary focus:bg-surface transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-heading mb-1.5">
              Difficulty Level
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["beginner", "intermediate", "advanced"] as const).map((lvl) => (
                <button
                  type="button"
                  key={lvl}
                  onClick={() => setLevel(lvl)}
                  className={`py-2 text-xs font-semibold capitalize rounded-btn border transition-all ${
                    level === lvl
                      ? "bg-primary-light text-primary border-primary shadow-sm"
                      : "bg-subtle text-muted border-line hover:bg-codeblock"
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-3 flex items-center justify-end gap-3 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-btn text-xs font-semibold text-muted hover:text-heading bg-surface border border-line hover:bg-subtle transition min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 px-5 py-2 rounded-btn text-xs font-semibold text-white bg-primary hover:bg-primary-hover shadow-sm transition disabled:opacity-50 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>{submitting ? "Creating..." : "Create Course"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
