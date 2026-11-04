/**
 * Frontend tests for Study Buddy mascot component and interactivity.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getBuddyLine } from "../buddy/lines";
import { Buddy } from "../components/buddy/Buddy";
import { PlaceholderMascot } from "../components/buddy/PlaceholderMascot";

// Mock api service
vi.mock("../services/api", () => ({
  api: {
    getBuddySettings: vi.fn().mockResolvedValue({ address_term: "boss", tone_mode: "balanced" }),
    updateBuddySettings: vi.fn().mockResolvedValue({ address_term: "boss", tone_mode: "balanced" }),
    startStudySession: vi.fn().mockResolvedValue({ id: 1, course_id: 1, pomodoros: 0 }),
    updateStudySession: vi.fn().mockResolvedValue({ id: 1, pomodoros: 1 }),
    recordBreakEvent: vi.fn().mockResolvedValue({ id: 1, session_id: 1, outcome: "accepted" }),
  },
}));

describe("Study Companion Mascot and UI", () => {
  it("renders PlaceholderMascot in ready state with SVG elements", () => {
    const handleTap = vi.fn();
    render(<PlaceholderMascot state="ready" onTap={handleTap} />);

    const mascot = screen.getByRole("button");
    expect(mascot).toBeInTheDocument();

    fireEvent.click(mascot);
    expect(handleTap).toHaveBeenCalledTimes(1);
  });

  it("renders PlaceholderMascot in celebrating state", () => {
    const { container } = render(<PlaceholderMascot state="celebrate" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders Buddy component with Pomodoro status and opens quick-action menu", () => {
    const handleQuizNav = vi.fn();
    render(<Buddy courseId={1} onNavigateToQuiz={handleQuizNav} />);

    // Check timer display
    expect(screen.getByText(/Study:/)).toBeInTheDocument();

    // Click quick action menu button
    const actionBtn = screen.getByTitle("Companion menu");
    fireEvent.click(actionBtn);

    // Verify quick action options exist
    expect(screen.getByText("Chatter with me")).toBeInTheDocument();
    expect(screen.getByText("Take 5m break")).toBeInTheDocument();
    expect(screen.getByText("Quiz me now")).toBeInTheDocument();

    // Trigger Quiz action
    fireEvent.click(screen.getByText("Quiz me now"));
    expect(handleQuizNav).toHaveBeenCalledTimes(1);
  });

  it("substitutes address_term properly in approved dialogue lines", () => {
    const lineWithBoss = getBuddyLine("long_unbroken_study", "friendly_checkin", "boss");
    expect(lineWithBoss).toContain("boss");
    expect(lineWithBoss).not.toContain("{{address_term}}");

    const lineWithScholar = getBuddyLine("long_unbroken_study", "friendly_checkin", "scholar");
    expect(lineWithScholar).toContain("scholar");
  });

  it("offers flashcards after two misses on a topic and navigates on click", () => {
    const handleFlashcardsNav = vi.fn();
    const { rerender } = render(
      <Buddy courseId={1} onNavigateToFlashcards={handleFlashcardsNav} />
    );

    // Send first miss
    rerender(
      <Buddy
        courseId={1}
        onNavigateToFlashcards={handleFlashcardsNav}
        lastQuizEvent={{ type: "miss", timestamp: Date.now() }}
      />
    );

    // Send second miss
    rerender(
      <Buddy
        courseId={1}
        onNavigateToFlashcards={handleFlashcardsNav}
        lastQuizEvent={{ type: "miss", timestamp: Date.now() + 1000 }}
      />
    );

    // Verify modal appeared with flashcard offer
    expect(screen.getByText("Review with Flashcards?")).toBeInTheDocument();
    expect(screen.getByText("Review flashcards")).toBeInTheDocument();

    // Click "Review flashcards"
    fireEvent.click(screen.getByText("Review flashcards"));
    expect(handleFlashcardsNav).toHaveBeenCalledTimes(1);
  });
});
