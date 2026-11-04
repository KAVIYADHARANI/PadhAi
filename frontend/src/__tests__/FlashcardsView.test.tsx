import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FlashcardsView } from "../components/FlashcardsView";
import { api } from "../services/api";
import { Flashcard, Topic } from "../types";

vi.mock("../services/api", () => ({
  api: {
    getCourseTopics: vi.fn(),
    getCourseFlashcards: vi.fn(),
    getDueFlashcards: vi.fn(),
    generateFlashcards: vi.fn(),
    reviewFlashcard: vi.fn(),
    deleteFlashcard: vi.fn(),
  },
}));

describe("FlashcardsView Component", () => {
  const mockTopics: Topic[] = [
    { id: 1, course_id: 1, name: "Operating Systems" },
    { id: 2, course_id: 1, name: "Networking" },
  ];

  const mockCards: Flashcard[] = [
    {
      id: 101,
      course_id: 1,
      topic_id: 1,
      front: "What is virtual memory?",
      back: "A memory management technique that provides an idealized abstraction of storage resources.",
      source_chunk_ids: [1],
      reps: 0,
      interval_days: 0,
      ease_factor: 2.5,
      due_date: new Date(Date.now() - 3600000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 102,
      course_id: 1,
      topic_id: 1,
      front: "What causes a page fault?",
      back: "Accessing a memory page that is mapped in the virtual address space but not loaded in physical RAM.",
      source_chunk_ids: [2],
      reps: 1,
      interval_days: 1,
      ease_factor: 2.6,
      due_date: new Date(Date.now() - 1800000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCourseTopics).mockResolvedValue(mockTopics);
    vi.mocked(api.getCourseFlashcards).mockResolvedValue({
      cards: mockCards,
      total_count: 2,
      due_count: 2,
    });
    vi.mocked(api.getDueFlashcards).mockResolvedValue(mockCards);
  });

  it("renders flashcard view and displays initial due card", async () => {
    render(<FlashcardsView courseId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Spaced Repetition Flashcards")).toBeInTheDocument();
      expect(screen.getByText("Card 1 of 2 Due")).toBeInTheDocument();
      expect(screen.getByText("What is virtual memory?")).toBeInTheDocument();
    });
  });

  it("flips the card to reveal answer and ratings when clicked", async () => {
    render(<FlashcardsView courseId={1} />);

    await waitFor(() => {
      expect(screen.getByText("What is virtual memory?")).toBeInTheDocument();
    });

    // Flip card by clicking "Reveal Answer"
    const revealBtn = screen.getByRole("button", { name: /Reveal Answer/i });
    fireEvent.click(revealBtn);

    // Verify back is shown and SM-2 quality ratings appear
    expect(
      screen.getByText(
        "A memory management technique that provides an idealized abstraction of storage resources."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Blackout")).toBeInTheDocument();
    expect(screen.getByText("Perfect")).toBeInTheDocument();
  });

  it("submits review rating and advances to next due card", async () => {
    vi.mocked(api.reviewFlashcard).mockResolvedValue({
      card: { ...mockCards[0], reps: 1, interval_days: 1, ease_factor: 2.6 },
      new_interval_days: 1,
      new_ease_factor: 2.6,
      next_due_date: new Date(Date.now() + 86400000).toISOString(),
    });

    render(<FlashcardsView courseId={1} />);

    await waitFor(() => {
      expect(screen.getByText("What is virtual memory?")).toBeInTheDocument();
    });

    // Flip
    fireEvent.click(screen.getByRole("button", { name: /Reveal Answer/i }));

    // Click "Perfect" rating
    const perfectBtn = screen.getByRole("button", { name: /Perfect/i });
    fireEvent.click(perfectBtn);

    await waitFor(() => {
      expect(api.reviewFlashcard).toHaveBeenCalledWith(101, 5);
      // Card 2 should now be visible
      expect(screen.getByText("What causes a page fault?")).toBeInTheDocument();
      expect(screen.getByText("Card 2 of 2 Due")).toBeInTheDocument();
    });
  });

  it("switches to browse mode and lists all flashcards", async () => {
    render(<FlashcardsView courseId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Browse All (2)")).toBeInTheDocument();
    });

    // Switch mode
    fireEvent.click(screen.getByText("Browse All (2)"));

    await waitFor(() => {
      expect(screen.getByText("What is virtual memory?")).toBeInTheDocument();
      expect(screen.getByText("What causes a page fault?")).toBeInTheDocument();
    });
  });

  it("triggers AI flashcard generation", async () => {
    const generatedCard: Flashcard = {
      id: 103,
      course_id: 1,
      front: "What is a deadlock?",
      back: "A state where each member of a group of processes is waiting for another member.",
      source_chunk_ids: [3],
      reps: 0,
      interval_days: 0,
      ease_factor: 2.5,
      due_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    vi.mocked(api.generateFlashcards).mockResolvedValue([generatedCard]);

    render(<FlashcardsView courseId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Generate Cards")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Generate Cards"));

    await waitFor(() => {
      expect(api.generateFlashcards).toHaveBeenCalledWith(1, null, 5);
      expect(screen.getByText(/Successfully generated 1 new flashcards!/i)).toBeInTheDocument();
    });
  });
});
