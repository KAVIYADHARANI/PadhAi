import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Flame,
  HelpCircle,
  Loader2,
  Sparkles,
  Target,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../services/api";
import { CourseProgress } from "../types";

interface ProgressViewProps {
  courseId: number;
  onPracticeTopic?: (topicId: number) => void;
}

export const ProgressView: React.FC<ProgressViewProps> = ({
  courseId,
  onPracticeTopic,
}) => {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadProgress() {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getCourseProgress(courseId);
        if (isMounted) {
          setProgress(data);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load progress data.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadProgress();
    return () => {
      isMounted = false;
    };
  }, [courseId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400 space-y-3">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
        <p className="text-xs">Computing deterministic topic mastery scores...</p>
      </div>
    );
  }

  if (error || !progress) {
    return (
      <div className="glass-panel rounded-3xl p-8 text-center max-w-xl mx-auto space-y-4">
        <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
        <h3 className="text-lg font-bold text-white">Progress Unavailable</h3>
        <p className="text-xs text-slate-400">{error || "Unable to retrieve course progress."}</p>
      </div>
    );
  }

  const { topics, weak_topics } = progress;

  if (topics.length === 0) {
    return (
      <div className="glass-panel rounded-3xl p-8 text-center max-w-xl mx-auto space-y-4">
        <HelpCircle className="w-12 h-12 text-slate-500 mx-auto" />
        <h3 className="text-lg font-bold text-white">No Topic Data Yet</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Upload course notes or textbooks in the Knowledge Base tab to generate syllabus topics and
          track your practice mastery.
        </p>
      </div>
    );
  }

  // Aggregate Metrics
  const totalAttempts = topics.reduce((acc, t) => acc + t.attempts_count, 0);
  const averageMastery =
    topics.length > 0
      ? Math.round((topics.reduce((acc, t) => acc + t.score, 0) / topics.length) * 100)
      : 0;
  const weakCount = weak_topics.length;

  // Chart Data Preparation
  const chartData = topics.map((t) => ({
    name: t.topic_name.length > 20 ? `${t.topic_name.substring(0, 18)}...` : t.topic_name,
    fullName: t.topic_name,
    mastery: Math.round(t.score * 100),
    attempts: t.attempts_count,
    topicId: t.topic_id,
  }));

  // Identify weak topic objects in rank order
  const weakTopicObjects = weak_topics
    .map((id) => topics.find((t) => t.topic_id === id))
    .filter((t): t is (typeof topics)[0] => t !== undefined);

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* 3 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-panel rounded-2xl p-5 border border-slate-800/80 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center shrink-0">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase">Average Mastery</p>
            <p className="text-2xl font-black text-white">{averageMastery}%</p>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-slate-800/80 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase">Total Attempts</p>
            <p className="text-2xl font-black text-white">{totalAttempts}</p>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-slate-800/80 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase">Focus Areas</p>
            <p className="text-2xl font-black text-rose-300">
              {weakCount} {weakCount === 1 ? "Topic" : "Topics"}
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid: Chart on Left, Ranked Weak Topics on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Recharts Mastery Bar Chart */}
        <div className="lg:col-span-2 glass-panel rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand-500/10 text-brand-400 flex items-center justify-center">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Topic Mastery Breakdown</h3>
                <p className="text-xs text-slate-400">
                  Computed via recency decay and question difficulty
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-[10px] font-semibold">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> &ge;80% Strong
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> 60-79% Review
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> &lt;60% Focus
              </span>
            </div>
          </div>

          <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <XAxis
                  dataKey="name"
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  domain={[0, 100]}
                  tickLine={false}
                  unit="%"
                />
                <Tooltip
                  cursor={{ fill: "rgba(51, 65, 85, 0.2)" }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="glass-card rounded-xl p-3 border border-slate-700 shadow-xl text-xs space-y-1">
                          <p className="font-bold text-white">{data.fullName}</p>
                          <p className="text-brand-300">Mastery: {data.mastery}%</p>
                          <p className="text-slate-400">Attempts: {data.attempts}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine
                  y={60}
                  stroke="#e11d48"
                  strokeDasharray="4 4"
                  label={{
                    value: "Mastery Threshold (60%)",
                    fill: "#f43f5e",
                    fontSize: 10,
                    position: "top",
                  }}
                />
                <Bar dataKey="mastery" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, index) => {
                    let fill = "#f43f5e"; // red <60
                    if (entry.mastery >= 80) fill = "#10b981"; // green >=80
                    else if (entry.mastery >= 60) fill = "#f59e0b"; // yellow 60-79
                    return <Cell key={`cell-${index}`} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Col: Ranked Weak Topics List */}
        <div className="glass-panel rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Recommended Practice</h3>
              <p className="text-xs text-slate-400">Urgency-ranked weak topics</p>
            </div>
          </div>

          {weakTopicObjects.length === 0 ? (
            <div className="p-6 text-center rounded-2xl bg-slate-900/40 border border-slate-800 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <p className="text-xs font-semibold text-white">All Topics Above Threshold!</p>
              <p className="text-[11px] text-slate-400">
                You have achieved &ge;60% mastery across your entire syllabus.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {weakTopicObjects.map((wt, idx) => {
                const masteryPct = Math.round(wt.score * 100);
                return (
                  <div
                    key={wt.topic_id}
                    className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            Priority #{idx + 1}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-white">{wt.topic_name}</h4>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-xs font-extrabold text-rose-300">
                          {masteryPct}%
                        </span>
                        <p className="text-[10px] text-slate-500">Mastery</p>
                      </div>
                    </div>

                    {onPracticeTopic && (
                      <button
                        onClick={() => onPracticeTopic(wt.topic_id)}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-800 hover:bg-brand-500 hover:text-white text-slate-300 text-xs font-semibold transition border border-slate-700 hover:border-brand-500"
                      >
                        <span>Quiz Me on This Topic</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
