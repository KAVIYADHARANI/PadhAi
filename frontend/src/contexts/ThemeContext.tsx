import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "study_theme";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Resolve the persisted theme preference, defaulting to "light".
 */
export function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Ignore storage access errors in restricted contexts
  }
  if (window.location.search.includes("theme=dark")) {
    return "dark";
  }
  return "light";
}

/**
 * Synchronize the root <html> element class and color-scheme with the active theme.
 */
export function applyThemeToDom(theme: Theme): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

/**
 * Initialize theme classes synchronously before initial React paint.
 */
export function initializeTheme(): Theme {
  const initial = getInitialTheme();
  applyThemeToDom(initial);
  return initial;
}

export const ThemeProvider: React.FC<{
  children: React.ReactNode;
  defaultTheme?: Theme;
}> = ({ children, defaultTheme }) => {
  const [theme, setThemeState] = useState<Theme>(() => defaultTheme ?? getInitialTheme());

  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    applyThemeToDom(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage write failures
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyThemeToDom(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Ignore storage write failures
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * Access the current theme and toggle handlers.
 * Falls back gracefully when components render standalone outside ThemeProvider (e.g. unit tests).
 */
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  const [fallbackTheme, setFallbackTheme] = useState<Theme>(() => getInitialTheme());

  const setFallback = useCallback((nextTheme: Theme) => {
    setFallbackTheme(nextTheme);
    applyThemeToDom(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage write failures
    }
  }, []);

  const toggleFallback = useCallback(() => {
    setFallbackTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyThemeToDom(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Ignore storage write failures
      }
      return next;
    });
  }, []);

  if (context) {
    return context;
  }

  return {
    theme: fallbackTheme,
    setTheme: setFallback,
    toggleTheme: toggleFallback,
  };
}

