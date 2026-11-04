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
      <div className="flex flex-col items-center justify-center p-12 text-[#64748B] space-y-3">
        <Loader2 className="w-8 h-8 text-[#4F46E5] animate-spin" />
        <p className="text-xs font-medium">Computing deterministic topic mastery scores...</p>
      </div>
    );
  }

  if (error || !progress) {
    return (
      <div className="bg-white border border-[#E2E8F0] shadow-card rounded-2xl p-8 text-center max-w-xl mx-auto space-y-4">
        <AlertTriangle className="w-10 h-10 text-[#E11D48] mx-auto" />
        <h3 className="text-lg font-bold text-[#0F172A]">Progress Unavailable</h3>
        <p className="text-xs text-[#64748B]">{error || "Unable to retrieve course progress."}</p>
      </div>
    );
  }

  const { topics, weak_topics } = progress;

  if (topics.length === 0) {
    return (
      <div className="bg-white border border-[#E2E8F0] shadow-card rounded-2xl p-8 text-center max-w-xl mx-auto space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-[#EEF2FF] border border-indigo-100 text-[#4F46E5] flex items-center justify-center mx-auto">
          <HelpCircle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-[#0F172A]">No Topic Data Yet</h3>
        <p className="text-xs text-[#64748B] leading-relaxed">
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
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* 3 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#EEF2FF] border border-indigo-100 text-[#4F46E5] flex items-center justify-center shrink-0">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-[#64748B] uppercase">Average Mastery</p>
            <p className="text-2xl font-black text-[#0F172A]">{averageMastery}%</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#F0FDFA] border border-teal-100 text-[#0D9488] flex items-center justify-center shrink-0">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-[#64748B] uppercase">Total Attempts</p>
            <p className="text-2xl font-black text-[#0F172A]">{totalAttempts}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#FFF1F2] border border-rose-100 text-[#E11D48] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-[#64748B] uppercase">Focus Areas</p>
            <p className="text-2xl font-black text-[#E11D48]">
              {weakCount} {weakCount === 1 ? "Topic" : "Topics"}
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid: Chart on Left, Ranked Weak Topics on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Recharts Mastery Bar Chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 sm:p-8 space-y-6 border border-[#E2E8F0] shadow-card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">Topic Mastery Breakdown</h3>
                <p className="text-xs text-[#64748B]">
                  Computed via recency decay and question difficulty
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-[#64748B]">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#0D9488]" /> &ge;80% Strong
              </span>
              <span className="flex items-center gap-1.5 text-[#64748B]">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#D97706]" /> 60-79% Review
              </span>
              <span className="flex items-center gap-1.5 text-[#64748B]">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#E11D48]" /> &lt;60% Focus
              </span>
            </div>
          </div>

          <div className="h-72 w-full pt-4 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <XAxis
                  dataKey="name"
                  stroke="#94A3B8"
                  fontSize={11}
                  tickLine={false}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                />
                <YAxis
                  stroke="#94A3B8"
                  fontSize={11}
                  domain={[0, 100]}
                  tickLine={false}
                  unit="%"
                />
                <Tooltip
                  cursor={{ fill: "rgba(241, 245, 249, 0.6)" }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white rounded-xl p-3 border border-[#E2E8F0] shadow-dropdown text-xs space-y-1">
                          <p className="font-bold text-[#0F172A]">{data.fullName}</p>
                          <p className="text-[#4F46E5] font-semibold">Mastery: {data.mastery}%</p>
                          <p className="text-[#64748B]">Attempts: {data.attempts}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine
                  y={60}
                  stroke="#E11D48"
                  strokeDasharray="4 4"
                  label={{
                    value: "Mastery Threshold (60%)",
                    fill: "#E11D48",
                    fontSize: 10,
                    position: "top",
                  }}
                />
                <Bar dataKey="mastery" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, index) => {
                    let fill = "#E11D48"; // red <60
                    if (entry.mastery >= 80) fill = "#0D9488"; // teal >=80
                    else if (entry.mastery >= 60) fill = "#D97706"; // amber 60-79
                    return <Cell key={`cell-${index}`} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Col: Ranked Weak Topics List */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 space-y-6 border border-[#E2E8F0] shadow-card">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#FFF1F2] text-[#E11D48] flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0F172A]">Recommended Practice</h3>
              <p className="text-xs text-[#64748B]">Urgency-ranked weak topics</p>
            </div>
          </div>

          {weakTopicObjects.length === 0 ? (
            <div className="p-6 text-center rounded-xl bg-[#F0FDFA] border border-teal-200 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-[#0D9488] mx-auto" />
              <p className="text-xs font-semibold text-[#0F172A]">All Topics Above Threshold!</p>
              <p className="text-xs text-[#64748B]">
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
                    className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#4F46E5] transition space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-pill bg-[#FFF1F2] text-[#E11D48] border border-rose-200">
                            Priority #{idx + 1}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-[#0F172A]">{wt.topic_name}</h4>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-xs font-extrabold text-[#E11D48]">
                          {masteryPct}%
                        </span>
                        <p className="text-[10px] text-[#64748B]">Mastery</p>
                      </div>
                    </div>

                    {onPracticeTopic && (
                      <button
                        onClick={() => onPracticeTopic(wt.topic_id)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-btn bg-white hover:bg-[#EEF2FF] hover:border-[#4F46E5] hover:text-[#4F46E5] text-[#334155] text-xs font-semibold transition border border-[#E2E8F0] min-h-[44px]"
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
