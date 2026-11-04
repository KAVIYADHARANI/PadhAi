import React from "react";
import { BookOpen, LogOut, Shield, UserCircle } from "lucide-react";
import { PRODUCT_NAME, TAGLINE } from "../brand";
import { useAuth } from "../contexts/AuthContext";

interface NavbarProps {
  onNavigateHome?: () => void;
  onNavigatePrivacy?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onNavigateHome, onNavigatePrivacy }) => {
  const { user, logout } = useAuth();
  const displayUser = user?.email || user?.displayName || "Learner";

  return (
    <header className="sticky top-0 z-40 w-full bg-white border-b border-[#E2E8F0] shadow-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand identity */}
        <button
          onClick={onNavigateHome}
          className="flex items-center gap-3 group text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F46E5] rounded-xl p-1"
          aria-label={`${PRODUCT_NAME} Home`}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#4F46E5] to-[#6366F1] flex items-center justify-center shadow-md shadow-indigo-500/15 group-hover:scale-105 transition-transform shrink-0">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl tracking-tight text-[#0F172A]">
                {PRODUCT_NAME}
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#EEF2FF] text-[#4F46E5] border border-indigo-100">
                Core
              </span>
            </div>
            <p className="text-xs text-[#64748B] font-medium">{TAGLINE}</p>
          </div>
        </button>

        {/* User state and actions */}
        {user ? (
          <div className="flex items-center gap-2 sm:gap-3">
            {onNavigatePrivacy && (
              <button
                onClick={onNavigatePrivacy}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-btn text-xs font-semibold text-[#64748B] hover:text-[#0D9488] hover:bg-[#F0FDFA] transition border border-transparent hover:border-[#CCFBF1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
                title="Privacy & Data Sovereignty"
                aria-label="Privacy settings"
              >
                <Shield className="w-4 h-4" />
                <span className="hidden sm:inline">Privacy</span>
              </button>
            )}

            <div
              className="hidden md:flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-btn bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#334155]"
              title={displayUser}
            >
              <UserCircle className="w-4 h-4 text-[#4F46E5] shrink-0" />
              <span className="font-medium max-w-[180px] truncate">
                {displayUser}
              </span>
            </div>

            <button
              onClick={() => logout()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-btn text-xs font-semibold text-[#64748B] hover:text-[#E11D48] hover:bg-[#FFF1F2] border border-[#E2E8F0] hover:border-rose-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48]"
              title="Sign Out"
              aria-label="Sign Out"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
};
