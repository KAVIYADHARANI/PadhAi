import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LessonView } from "../components/LessonView";
import { api, ApiError } from "../services/api";
import { Course, Lesson, LessonProgress, RoadmapItem } from "../types";

vi.mock("../services/api", () => ({
  api: {
    getLesson: vi.fn(),
    generateLesson: vi.fn(),
    getLessonProgress: vi.fn(),
    updateLessonProgress: vi.fn(),
    sendLessonChatMessage: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

describe("LessonView Component", () => {
  const mockCourse: Course = {
    id: 1,
    user_id: 10,
    name: "Linear Algebra",
    goal_days: 14,
    hours_per_day: 1.0,
    level: "beginner",
    created_at: new Date().toISOString(),
  };

  const mockRoadmapItem: RoadmapItem = {
    id: 1,
    course_id: 1,
    day: 1,
    topic_id: 101,
    topic_name: "Vector Spaces",
    title: "Day 1: Vector Fundamentals",
    learning_objectives: ["Understand vector addition", "Apply scalar multiplication"],
    tasks: [
      {
        id: "d1_t1",
        task: "Read vector addition and span",
        estimated_minutes: 30,
        completed: false,
      },
    ],
    estimated_minutes: 60,
    completed: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockLesson: Lesson = {
    id: 5,
    course_id: 1,
    roadmap_item_id: 1,
    task_id: "d1_t1",
    user_id: 10,
    title: "Mastering Vector Spaces and Subspaces",
    estimated_minutes: 30,
    content: {
      title: "Mastering Vector Spaces and Subspaces",
      introduction: "Vectors provide the mathematical foundation for machine learning.",
      prerequisites: ["High school algebra"],
      sections: [
        {
          id: "sec_1",
          title: "Definition of a Vector Space",
          content: "A vector space V satisfies 8 closure and associativity axioms.",
          key_concepts: ["Axioms", "Closure under addition"],
          code_snippet: "import numpy as np\nv = np.array([1, 2, 3])",
          source_citations: ["[doc p.1]"],
        },
      ],
      key_terms: [
        { term: "Linear Combination", definition: "Sum of scaled vectors." },
      ],
      worked_examples: [
        {
          problem: "Check if [0, 0] is in the subspace.",
          step_by_step_solution: ["A subspace must contain the zero vector.", "[0, 0] is present."],
          explanation: "Zero vector test passed.",
        },
      ],
      misconceptions: [
        {
          misconception: "Any set of vectors is a subspace.",
          correction: "It must be closed under addition and scaling.",
          explanation: "Lines not passing through origin fail zero-vector test.",
        },
      ],
      summary: "Vector spaces encapsulate linear combinations.",
      takeaways: ["Must contain origin.", "Closed under scaling."],
      exercises: [
        {
          id: "ex_1",
          prompt: "Verify if the set of 2x2 symmetric matrices forms a subspace.",
          exercise_type: "conceptual",
          difficulty: "medium",
          hints: ["Hint 1: Check zero matrix", "Hint 2: Sum of two symmetric matrices"],
          solution: "Yes, symmetric matrices form a valid subspace.",
          explanation: "Addition and scalar multiples preserve symmetry.",
        },
      ],
      self_check_questions: [
        {
          id: "q_1",
          question: "Which element must every vector space contain?",
          options: ["Identity matrix", "Zero vector", "Unit vector", "Null space"],
          answer: "Zero vector",
          explanation: "Zero vector is the additive identity required by axioms.",
        },
      ],
      deeper_learning: ["Hilbert Spaces and Inner Product spaces."],
    },
    web_resources: [
      {
        title: "Vector Space Reference",
        url: "https://en.wikipedia.org/wiki/Vector_space",
        domain: "en.wikipedia.org",
        snippet: "Comprehensive guide to vector spaces and axioms.",
        relevance_reason: "Primary theoretical reference.",
        learning_objective: "Understand vector addition",
        level: "beginner",
        verified: true,
      },
    ],
    youtube_resources: [
      {
        video_id: "k7RM-ot2NWY",
        title: "Essence of Linear Algebra - Vector Spaces",
        channel_name: "3Blue1Brown",
        thumbnail_url: "https://img.youtube.com/vi/k7RM-ot2NWY/hqdefault.jpg",
        duration: "14 mins",
        video_url: "https://www.youtube.com/watch?v=k7RM-ot2NWY",
        embed_url: "https://www.youtube-nocookie.com/embed/k7RM-ot2NWY",
        relevance_reason: "Geometric intuition for vectors and span.",
      },
    ],
    exercises: [],
    sources: [
      {
        document_id: 1,
        document_name: "algebra_notes.pdf",
        page: 1,
      },
    ],
    status: "ready",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockProgress: LessonProgress = {
    id: 12,
    lesson_id: 5,
    user_id: 10,
    course_id: 1,
    sections_completed: [],
    exercises_completed: {},
    quiz_score: null,
    quiz_completed: false,
    completed: false,
    time_spent_seconds: 0,
    reflection: null,
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getLesson).mockResolvedValue(mockLesson);
    vi.mocked(api.getLessonProgress).mockResolvedValue(mockProgress);
    vi.mocked(api.updateLessonProgress).mockImplementation(async (_, __, ___, payload) => ({
      ...mockProgress,
      sections_completed: payload.section_completed ? ["sec_1"] : [],
      completed: payload.completed ?? false,
    }));
  });

  it("renders lesson details, sections, and progress percentage", async () => {
    render(
      <LessonView
        course={mockCourse}
        roadmapItem={mockRoadmapItem}
        taskId="d1_t1"
        onBackToRoadmap={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Mastering Vector Spaces and Subspaces")).toBeInTheDocument();
      expect(screen.getByText("Definition of a Vector Space")).toBeInTheDocument();
      expect(screen.getByText("Linear Combination")).toBeInTheDocument();
    });
  });

  it("toggles section reading completion status", async () => {
    render(
      <LessonView
        course={mockCourse}
        roadmapItem={mockRoadmapItem}
        taskId="d1_t1"
        onBackToRoadmap={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Mark as Read")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Mark as Read"));

    await waitFor(() => {
      expect(api.updateLessonProgress).toHaveBeenCalledWith(
        1,
        1,
        "d1_t1",
        expect.objectContaining({ section_id: "sec_1", section_completed: true })
      );
    });
  });

  it("switches to exercises tab and reveals progressive hints", async () => {
    render(
      <LessonView
        course={mockCourse}
        roadmapItem={mockRoadmapItem}
        taskId="d1_t1"
        onBackToRoadmap={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Practice Exercises")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Practice Exercises"));

    await waitFor(() => {
      expect(screen.getByText(/Verify if the set of 2x2 symmetric matrices/)).toBeInTheDocument();
      expect(screen.getByText("Get Hint 1 of 2")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Get Hint 1 of 2"));

    await waitFor(() => {
      expect(screen.getByText("Hint 1: Check zero matrix")).toBeInTheDocument();
    });
  });

  it("calls onLessonCompleted callback when lesson is marked complete", async () => {
    const onCompletedMock = vi.fn();
    render(
      <LessonView
        course={mockCourse}
        roadmapItem={mockRoadmapItem}
        taskId="d1_t1"
        onBackToRoadmap={vi.fn()}
        onLessonCompleted={onCompletedMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Mark Complete")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Mark Complete"));

    await waitFor(() => {
      expect(api.updateLessonProgress).toHaveBeenCalledWith(
        1,
        1,
        "d1_t1",
        expect.objectContaining({ completed: true })
      );
      expect(onCompletedMock).toHaveBeenCalled();
    });
  });

  it("auto-generates lesson on 404 and does not trigger duplicate generation calls on repeated renders", async () => {
    vi.mocked(api.getLesson).mockRejectedValue(new ApiError(404, "Lesson not found"));
    vi.mocked(api.generateLesson).mockResolvedValue(mockLesson);

    const { rerender } = render(
      <LessonView
        course={mockCourse}
        roadmapItem={mockRoadmapItem}
        taskId="d1_t1"
        onBackToRoadmap={vi.fn()}
      />
    );

    // Re-render immediately (as in React 18 strict mode double-invoking effects)
    rerender(
      <LessonView
        course={mockCourse}
        roadmapItem={mockRoadmapItem}
        taskId="d1_t1"
        onBackToRoadmap={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Mastering Vector Spaces and Subspaces")).toBeInTheDocument();
    });

    // Exactly one generateLesson call was made despite 404 and re-render
    expect(api.generateLesson).toHaveBeenCalledTimes(1);
    expect(api.generateLesson).toHaveBeenCalledWith(1, 1, "d1_t1", false);
  });

  it("displays error state with retry button when lesson generation fails and terminates loading spinner", async () => {
    vi.mocked(api.getLesson).mockRejectedValue(new ApiError(404, "Lesson not found"));
    vi.mocked(api.generateLesson).mockRejectedValue(new ApiError(500, "Server generation error"));

    render(
      <LessonView
        course={mockCourse}
        roadmapItem={mockRoadmapItem}
        taskId="d1_t1"
        onBackToRoadmap={vi.fn()}
      />
    );

    // Spinner disappears and error message with Retry appears
    await waitFor(() => {
      expect(screen.getByText("Server generation error")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
      expect(screen.queryByText("Generating Grounded Study Lesson...")).not.toBeInTheDocument();
      expect(screen.queryByText("Loading Lesson...")).not.toBeInTheDocument();
    });

    // Clicking Retry attempts generation again
    vi.mocked(api.generateLesson).mockResolvedValue(mockLesson);
    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByText("Mastering Vector Spaces and Subspaces")).toBeInTheDocument();
    });
  });
});


