import React from "react";
import { BookOpen, LogOut, Shield, UserCircle } from "lucide-react";
import { PRODUCT_NAME, TAGLINE } from "../brand";
import { useAuth } from "../contexts/AuthContext";
import { ThemeToggle } from "./ThemeToggle";

interface NavbarProps {
  onNavigateHome?: () => void;
  onNavigatePrivacy?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onNavigateHome, onNavigatePrivacy }) => {
  const { user, logout } = useAuth();
  const displayUser = user?.email || user?.displayName || "Learner";

  return (
    <header className="sticky top-0 z-40 w-full bg-surface border-b border-line shadow-sm transition-colors duration-150">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        {/* Brand identity */}
        <button
          onClick={onNavigateHome}
          className="flex items-center gap-3 group text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl p-1"
          aria-label={`${PRODUCT_NAME} Home`}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#4F46E5] to-[#6366F1] flex items-center justify-center shadow-md shadow-indigo-500/15 group-hover:scale-105 transition-transform shrink-0">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl tracking-tight text-heading">
                {PRODUCT_NAME}
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary-light text-primary border border-primary/20">
                Core
              </span>
            </div>
            <p className="text-xs text-muted font-medium">{TAGLINE}</p>
          </div>
        </button>

        {/* Utility & User actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle showLabel />

          {user ? (
            <>
              {onNavigatePrivacy && (
                <button
                  onClick={onNavigatePrivacy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-btn text-xs font-semibold text-muted hover:text-accent hover:bg-accent-light transition border border-transparent hover:border-accent/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  title="Privacy & Data Sovereignty"
                  aria-label="Privacy settings"
                >
                  <Shield className="w-4 h-4" />
                  <span className="hidden sm:inline">Privacy</span>
                </button>
              )}

              <div
                className="hidden md:flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-btn bg-subtle border border-line text-xs text-body"
                title={displayUser}
              >
                <UserCircle className="w-4 h-4 text-primary shrink-0" />
                <span className="font-medium max-w-[180px] truncate">
                  {displayUser}
                </span>
              </div>

              <button
                onClick={() => logout()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-btn text-xs font-semibold text-muted hover:text-error hover:bg-error-light border border-line hover:border-error/30 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-error"
                title="Sign Out"
                aria-label="Sign Out"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
};
