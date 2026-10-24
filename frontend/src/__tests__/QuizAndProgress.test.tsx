import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QuizView } from "../components/QuizView";
import { ProgressView } from "../components/ProgressView";
import { CoursePage } from "../pages/CoursePage";
import { api } from "../services/api";
import { Course, CourseProgress, QuizResponse, Topic } from "../types";

vi.mock("../services/api", () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    getCourseTopics: vi.fn(),
    generateQuiz: vi.fn(),
    submitAttempt: vi.fn(),
    getCourseProgress: vi.fn(),
    getCourseDocuments: vi.fn(() => Promise.resolve([])),
    getBuddySettings: vi.fn(() => Promise.resolve({ address_term: "boss", tone_mode: "balanced" })),
    startStudySession: vi.fn(() => Promise.resolve({ id: 1, course_id: 1, pomodoros: 0 })),
    updateStudySession: vi.fn(() => Promise.resolve({ id: 1 })),
    recordBreakEvent: vi.fn(() => Promise.resolve({ id: 1 })),
  },
}));

// ResizeObserver mock for Recharts
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("Quiz and Progress Views", () => {
  const mockCourse: Course = {
    id: 1,
    user_id: 10,
    name: "Computer Architecture",
    goal_days: 30,
    hours_per_day: 1.5,
    level: "intermediate",
    created_at: new Date().toISOString(),
  };

  const mockTopics: Topic[] = [
    { id: 101, course_id: 1, name: "Pipelining & Hazards" },
    { id: 102, course_id: 1, name: "Memory Hierarchy" },
  ];

  const mockQuiz: QuizResponse = {
    course_id: 1,
    topic_id: 101,
    questions: [
      {
        id: 1,
        course_id: 1,
        topic_id: 101,
        stem: "When do data hazards occur?",
        question_type: "mcq",
        options: [
          "When instructions depend on each other's data",
          "When cache lines are warm",
          "When clock cycles are synchronized",
          "When buses are idle",
        ],
        difficulty: 1.5,
      },
      {
        id: 2,
        course_id: 1,
        topic_id: 101,
        stem: "How does forwarding mitigate pipeline hazards?",
        question_type: "mcq",
        options: [
          "Bypasses results directly from ALU to subsequent stages",
          "Halts CPU clock",
          "Reloads instruction cache",
          "Flushes registers",
        ],
        difficulty: 1.5,
      },
    ],
  };

  const mockProgress: CourseProgress = {
    course_id: 1,
    topics: [
      {
        topic_id: 101,
        topic_name: "Pipelining & Hazards",
        score: 0.45,
        attempts_count: 7,
        updated_at: new Date().toISOString(),
      },
      {
        topic_id: 102,
        topic_name: "Memory Hierarchy",
        score: 0.55,
        attempts_count: 5,
        updated_at: new Date().toISOString(),
      },
    ],
    weak_topics: [101, 102],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("QuizView Component", () => {
    it("loads course topics and displays topic selection", async () => {
      vi.mocked(api.getCourseTopics).mockResolvedValueOnce(mockTopics);

      render(<QuizView courseId={1} />);

      expect(screen.getByText(/Loading course syllabus topics/i)).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText("Select Topic for Practice Quiz")).toBeInTheDocument();
      });

      expect(screen.getByText("Pipelining & Hazards")).toBeInTheDocument();
      expect(screen.getByText("Memory Hierarchy")).toBeInTheDocument();
      expect(screen.getByText(/Start 5-Question Quiz/i)).toBeInTheDocument();
    });

    it("starts quiz, renders question without persona banter, and submits answer", async () => {
      vi.mocked(api.getCourseTopics).mockResolvedValueOnce(mockTopics);
      vi.mocked(api.generateQuiz).mockResolvedValueOnce(mockQuiz);
      vi.mocked(api.submitAttempt).mockResolvedValueOnce({
        id: 1,
        question_id: 1,
        selected_answer: "When instructions depend on each other's data",
        correct: true,
        answer: "When instructions depend on each other's data",
        explanation: "Data hazards occur when dependent instructions modify data in different stages.",
        source_chunk_ids: [12],
        new_mastery_score: 0.85,
        time_ms: 2200,
        created_at: new Date().toISOString(),
      });

      render(<QuizView courseId={1} initialTopicId={101} />);

      await waitFor(() => {
        expect(screen.getByText("Start 5-Question Quiz")).toBeInTheDocument();
      });

      // Start quiz
      fireEvent.click(screen.getByText("Start 5-Question Quiz"));

      await waitFor(() => {
        expect(screen.getByText("Question 1 of 2")).toBeInTheDocument();
      });

      // Assert question stem is rendered neutrally
      expect(screen.getByText("When do data hazards occur?")).toBeInTheDocument();
      expect(
        screen.getByText("When instructions depend on each other's data")
      ).toBeInTheDocument();

      // Select option
      fireEvent.click(screen.getByText("When instructions depend on each other's data"));

      // Submit
      fireEvent.click(screen.getByText("Submit Answer"));

      await waitFor(() => {
        expect(screen.getByText("Correct!")).toBeInTheDocument();
      });

      expect(
        screen.getByText(/Data hazards occur when dependent instructions/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/New Topic Mastery: 85%/i)).toBeInTheDocument();
      expect(screen.getByText("chunk #12")).toBeInTheDocument();
      expect(screen.getByText("Next Question")).toBeInTheDocument();
    });
  });

  describe("ProgressView Component", () => {
    it("renders topic mastery scores and ranked weak topics", async () => {
      vi.mocked(api.getCourseProgress).mockResolvedValueOnce(mockProgress);
      const handlePractice = vi.fn();

      render(<ProgressView courseId={1} onPracticeTopic={handlePractice} />);

      expect(
        screen.getByText(/Computing deterministic topic mastery scores/i)
      ).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText("Topic Mastery Breakdown")).toBeInTheDocument();
      });

      // Metric summary cards
      expect(screen.getByText("50%")).toBeInTheDocument(); // Average mastery: (45 + 55) / 2 = 50%
      expect(screen.getByText("12")).toBeInTheDocument(); // Total attempts: 7 + 5 = 12
      expect(screen.getByText("2 Topics")).toBeInTheDocument(); // Focus areas count

      // Weak topics panel
      expect(screen.getByText("Priority #1")).toBeInTheDocument();
      expect(screen.getByText("Priority #2")).toBeInTheDocument();

      const quizMeButtons = screen.getAllByText("Quiz Me on This Topic");
      expect(quizMeButtons).toHaveLength(2);

      fireEvent.click(quizMeButtons[0]);
      expect(handlePractice).toHaveBeenCalledWith(101);
    });
  });

  describe("CoursePage Navigation Tabs", () => {
    it("switches tabs between Knowledge Base, Practice Quiz, and Mastery & Progress", async () => {
      vi.mocked(api.getCourseTopics).mockResolvedValueOnce(mockTopics);
      vi.mocked(api.getCourseProgress).mockResolvedValueOnce(mockProgress);

      render(<CoursePage course={mockCourse} onBack={vi.fn()} />);

      // Default active tab is Knowledge Base
      expect(screen.getByText("Knowledge Base")).toBeInTheDocument();
      expect(screen.getByText("Course Knowledge Base")).toBeInTheDocument();

      // Switch to Practice Quiz tab
      fireEvent.click(screen.getByText("Practice Quiz"));
      await waitFor(() => {
        expect(screen.getByText("Select Topic for Practice Quiz")).toBeInTheDocument();
      });

      // Switch to Mastery & Progress tab
      fireEvent.click(screen.getByText("Mastery & Progress"));
      await waitFor(() => {
        expect(screen.getByText("Topic Mastery Breakdown")).toBeInTheDocument();
      });
    });
  });
});
