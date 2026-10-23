import React from "react";
import { Sparkles, Bot, ShieldCheck } from "lucide-react";
import { MASCOT_NAME, TAGLINE_TA } from "../brand";

interface MascotPlaceholderProps {
  status?: "standby" | "active" | "offline";
  compact?: boolean;
  className?: string;
}

export const MascotPlaceholder: React.FC<MascotPlaceholderProps> = ({
  status = "standby",
  compact = false,
  className = "",
}) => {
  return (
    <div
      className={`glass-card rounded-2xl p-4 sm:p-5 relative overflow-hidden transition-all ${
        compact ? "py-3" : ""
      } ${className}`}
    >
      {/* Background radial accent */}
      <div className="absolute -right-8 -top-8 w-32 h-32 bg-brand-600/10 rounded-full blur-2xl pointer-events-none" />

      <div className="flex items-start gap-4">
        {/* Reserved Avatar slot for Mascot */}
        <div className="relative shrink-0">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 border border-brand-500/30 flex items-center justify-center shadow-inner">
            <Bot className="w-6 h-6 text-brand-400 animate-pulse" />
          </div>
          <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
        </div>

        {/* Mascot Info and Reserved slot status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-white tracking-wide">
              {MASCOT_NAME}
            </h3>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-300 border border-brand-500/30">
              Study Buddy
            </span>
            <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              {status === "active" ? "Active" : "Grounded"}
            </span>
          </div>

          <p className="mt-1 text-xs text-brand-300/90 font-medium italic">
            "{TAGLINE_TA}"
          </p>

          {!compact && (
            <div className="mt-3 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-brand-400 shrink-0" />
              <span>
                Companion character slot reserved for interactive quiz & pacing assistance.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
