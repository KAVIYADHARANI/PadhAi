import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ThemeProvider,
  useTheme,
  THEME_STORAGE_KEY,
  initializeTheme,
} from "../contexts/ThemeContext";
import { ThemeToggle } from "../components/ThemeToggle";
import { Navbar } from "../components/Navbar";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    user: { email: "learner@example.com", displayName: "Learner" },
    logout: vi.fn(),
  })),
}));

const ThemeProbe = () => {
  const { theme } = useTheme();
  return <span data-testid="current-theme">{theme}</span>;
};

describe("ThemeContext and ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("defaults to light theme when no stored preference exists", () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
        <ThemeToggle showLabel />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme")).toHaveTextContent("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    const button = screen.getByRole("button", { name: /switch to dark theme/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Dark")).toBeInTheDocument();
  });

  it("toggles from light to dark and persists preference in localStorage", () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
        <ThemeToggle showLabel />
      </ThemeProvider>
    );

    const toDarkBtn = screen.getByRole("button", { name: /switch to dark theme/i });
    fireEvent.click(toDarkBtn);

    expect(screen.getByTestId("current-theme")).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    const toLightBtn = screen.getByRole("button", { name: /switch to light theme/i });
    expect(toLightBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Light")).toBeInTheDocument();

    fireEvent.click(toLightBtn);

    expect(screen.getByTestId("current-theme")).toHaveTextContent("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("restores persisted dark theme from localStorage on initialization", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    const resolved = initializeTheme();
    expect(resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    render(
      <ThemeProvider>
        <ThemeProbe />
        <ThemeToggle />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme")).toHaveTextContent("dark");
    expect(
      screen.getByRole("button", { name: /switch to light theme/i })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("renders working theme toggle inside Navbar even without explicit ThemeProvider", () => {
    render(<Navbar />);

    const toggle = screen.getByRole("button", { name: /switch to dark theme/i });
    fireEvent.click(toggle);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(
      screen.getByRole("button", { name: /switch to light theme/i })
    ).toHaveAttribute("aria-pressed", "true");
  });
});

