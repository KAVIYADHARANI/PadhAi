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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-dropdown border border-[#E2E8F0] relative text-[#334155]">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#64748B] hover:text-[#0F172A] p-1 rounded-lg hover:bg-[#F1F5F9] transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-[#EEF2FF] border border-indigo-100 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-[#4F46E5]" />
          </div>
          <h2 className="text-xl font-bold text-[#0F172A]">Create New Course</h2>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-[#FFF1F2] border border-rose-200 text-[#E11D48] text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
              Course Title
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Operating Systems & Architecture"
              className="w-full px-3.5 py-2.5 rounded-btn bg-[#F8FAFC] border border-[#E2E8F0] text-[#0F172A] placeholder-[#64748B] text-sm focus:outline-none focus:border-[#4F46E5] focus:bg-white transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                Target Days
              </label>
              <input
                type="number"
                min={1}
                max={365}
                required
                value={goalDays}
                onChange={(e) => setGoalDays(parseInt(e.target.value) || 1)}
                className="w-full px-3.5 py-2.5 rounded-btn bg-[#F8FAFC] border border-[#E2E8F0] text-[#0F172A] text-sm focus:outline-none focus:border-[#4F46E5] focus:bg-white transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
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
                className="w-full px-3.5 py-2.5 rounded-btn bg-[#F8FAFC] border border-[#E2E8F0] text-[#0F172A] text-sm focus:outline-none focus:border-[#4F46E5] focus:bg-white transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
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
                      ? "bg-[#EEF2FF] text-[#4F46E5] border-[#4F46E5] shadow-sm"
                      : "bg-[#F8FAFC] text-[#64748B] border-[#E2E8F0] hover:bg-[#F1F5F9]"
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-3 flex items-center justify-end gap-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-btn text-xs font-semibold text-[#64748B] hover:text-[#0F172A] bg-white border border-[#E2E8F0] hover:bg-[#F8FAFC] transition min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 px-5 py-2 rounded-btn text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] shadow-sm transition disabled:opacity-50 min-h-[44px]"
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
