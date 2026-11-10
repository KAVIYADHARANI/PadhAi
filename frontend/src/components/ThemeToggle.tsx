import React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";

interface ThemeToggleProps {
  showLabel?: boolean;
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  showLabel = false,
  className = "",
}) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
      className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] ${
        showLabel ? "px-3" : "px-2.5"
      } py-2 rounded-btn text-xs font-semibold bg-subtle/70 text-body hover:text-heading hover:bg-subtle border border-line transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400 shrink-0" />
      ) : (
        <Moon className="w-4 h-4 text-primary shrink-0" />
      )}
      {showLabel && (
        <span className="hidden sm:inline">
          {isDark ? "Light" : "Dark"}
        </span>
      )}
    </button>
  );
};

