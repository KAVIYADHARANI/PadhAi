import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MASCOT_NAME } from "../brand";
import { ChatView } from "../components/ChatView";
import { RoadmapView } from "../components/RoadmapView";
import { api } from "../services/api";
import { Course, Document, RoadmapProgress } from "../types";

vi.mock("../services/api", () => ({
  api: {
    getCourseRoadmap: vi.fn(),
    generateCourseRoadmap: vi.fn(),
    replanCourseRoadmap: vi.fn(),
    updateRoadmapItem: vi.fn(),
    getCourseDocuments: vi.fn(),
    getChatHistory: vi.fn(),
    sendChatMessage: vi.fn(),
    streamChatMessage: vi.fn(),
    clearChatHistory: vi.fn(),
  },
}));

describe("RoadmapView and ChatView", () => {
  const mockCourse: Course = {
    id: 1,
    user_id: 10,
    name: "Linear Algebra",
    goal_days: 14,
    hours_per_day: 1.0,
    level: "beginner",
    created_at: new Date().toISOString(),
  };

  const mockDocumentsReady: Document[] = [
    {
      id: 101,
      course_id: 1,
      filename: "vectors.pdf",
      status: "ready",
      pages: 15,
      created_at: new Date().toISOString(),
    },
  ];

  const mockRoadmap: RoadmapProgress = {
    course_id: 1,
    total_days: 2,
    completed_days: 0,
    total_tasks: 2,
    completed_tasks: 0,
    percent_complete: 0.0,
    items: [
      {
        id: 1,
        course_id: 1,
        day: 1,
        topic_name: "Vector Spaces",
        title: "Introduction to Vector Spaces",
        learning_objectives: ["Understand linear combinations"],
        tasks: [
          {
            id: "d1_t1",
            task: "Read vector addition rules",
            estimated_minutes: 30,
            completed: false,
          },
        ],
        estimated_minutes: 30,
        completed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 2,
        course_id: 1,
        day: 2,
        topic_name: "Matrices",
        title: "Matrix Multiplication & Inverses",
        learning_objectives: ["Compute row operations"],
        tasks: [
          {
            id: "d2_t1",
            task: "Calculate 2x2 matrix inverses",
            estimated_minutes: 30,
            completed: false,
          },
        ],
        estimated_minutes: 30,
        completed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RoadmapView displays source material needed if no documents ready", async () => {
    vi.mocked(api.getCourseRoadmap).mockResolvedValue({
      course_id: 1,
      total_days: 0,
      completed_days: 0,
      total_tasks: 0,
      completed_tasks: 0,
      percent_complete: 0,
      items: [],
    });
    vi.mocked(api.getCourseDocuments).mockResolvedValue([]);

    render(<RoadmapView course={mockCourse} onGoToMaterials={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Source Material Needed")).toBeInTheDocument();
    });
  });

  it("RoadmapView displays generate button when documents are ready", async () => {
    vi.mocked(api.getCourseRoadmap).mockResolvedValue({
      course_id: 1,
      total_days: 0,
      completed_days: 0,
      total_tasks: 0,
      completed_tasks: 0,
      percent_complete: 0,
      items: [],
    });
    vi.mocked(api.getCourseDocuments).mockResolvedValue(mockDocumentsReady);

    render(<RoadmapView course={mockCourse} onGoToMaterials={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Create Your Personalized Study Roadmap")).toBeInTheDocument();
    });
  });

  it("RoadmapView renders daily milestones and checkboxes when roadmap exists", async () => {
    vi.mocked(api.getCourseRoadmap).mockResolvedValue(mockRoadmap);
    vi.mocked(api.getCourseDocuments).mockResolvedValue(mockDocumentsReady);

    render(<RoadmapView course={mockCourse} onGoToMaterials={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Introduction to Vector Spaces")).toBeInTheDocument();
      expect(screen.getByText("Matrix Multiplication & Inverses")).toBeInTheDocument();
      expect(screen.getByText("Read vector addition rules")).toBeInTheDocument();
    });
  });

  it("RoadmapView allows re-planning from mastery", async () => {
    vi.mocked(api.getCourseRoadmap).mockResolvedValue(mockRoadmap);
    vi.mocked(api.getCourseDocuments).mockResolvedValue(mockDocumentsReady);
    vi.mocked(api.replanCourseRoadmap).mockResolvedValue({
      ...mockRoadmap,
      items: [
        {
          ...mockRoadmap.items[0],
          title: "Re-planned Day 1: Vector Spaces Focus",
        },
        mockRoadmap.items[1],
      ],
    });

    render(<RoadmapView course={mockCourse} onGoToMaterials={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Re-plan from Mastery")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Re-plan from Mastery"));

    await waitFor(() => {
      expect(api.replanCourseRoadmap).toHaveBeenCalledWith(mockCourse.id);
      expect(screen.getByText("Re-planned Day 1: Vector Spaces Focus")).toBeInTheDocument();
    });
  });

  it("ChatView renders empty state and sends grounded query", async () => {
    vi.mocked(api.getChatHistory).mockResolvedValue({
      course_id: 1,
      thread_id: 1,
      messages: [],
    });
    vi.mocked(api.streamChatMessage).mockImplementation(async (_courseId, _payload, callbacks) => {
      callbacks.onToken?.("Vectors have both magnitude and direction [doc p.3].");
      callbacks.onCitations?.(["[doc p.3]"]);
      callbacks.onDone?.();
    });

    render(<ChatView course={mockCourse} />);

    await waitFor(() => {
      expect(screen.getByText(`How can ${MASCOT_NAME} help?`)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(new RegExp(`Ask ${MASCOT_NAME}`, "i"));
    fireEvent.change(input, { target: { value: "What is a vector?" } });

    const askButton = screen.getByRole("button", { name: /ask/i });
    fireEvent.click(askButton);

    await waitFor(() => {
      expect(screen.getByText("Vectors have both magnitude and direction [doc p.3].")).toBeInTheDocument();
      expect(screen.getByText("[doc p.3]")).toBeInTheDocument();
    });
  });

  it("ChatView handles streaming SSE tokens, confirmation chip and citation modal", async () => {
    vi.mocked(api.getChatHistory).mockResolvedValue({
      course_id: 1,
      thread_id: 1,
      messages: [],
    });
    vi.mocked(api.streamChatMessage).mockImplementation(async (_courseId, _payload, callbacks) => {
      callbacks.onAgent?.("quiz_gen");
      callbacks.onRouteSource?.("rule");
      callbacks.onChip?.({ confirmation_chip: "Generate 5 practice questions" });
      callbacks.onToken?.("Matrix inverses ");
      callbacks.onToken?.("require a non-zero determinant.");
      callbacks.onCitations?.(
        ["[doc p.5]"],
        [
          {
            document_id: 1,
            document_name: "LinearAlgebra.pdf",
            page: 5,
            excerpt: "A square matrix is invertible if and only if its determinant is non-zero.",
          },
        ]
      );
      callbacks.onDone?.();
    });

    render(<ChatView course={mockCourse} />);

    await waitFor(() => {
      expect(screen.getByText(`How can ${MASCOT_NAME} help?`)).toBeInTheDocument();
    });

    // Check Integrity toggle is present and clickable
    const integrityBtn = screen.getByText("Integrity Mode");
    expect(integrityBtn).toBeInTheDocument();
    fireEvent.click(integrityBtn);

    const input = screen.getByPlaceholderText(new RegExp(`Ask ${MASCOT_NAME}`, "i"));
    fireEvent.change(input, { target: { value: "Can you quiz me on matrix inverses?" } });

    const askButton = screen.getByRole("button", { name: /ask/i });
    fireEvent.click(askButton);

    // Tokens and agent tag
    await waitFor(() => {
      expect(screen.getByText("Matrix inverses require a non-zero determinant.")).toBeInTheDocument();
      expect(screen.getByText("quiz_gen")).toBeInTheDocument();
    });

    // Confirmation chip rendered
    expect(screen.getByText("Generate 5 practice questions")).toBeInTheDocument();

    // Click on citation source pill to open modal
    const sourceBtn = screen.getByText("LinearAlgebra.pdf");
    expect(sourceBtn).toBeInTheDocument();
    fireEvent.click(sourceBtn);

    // Modal opens showing excerpt
    await waitFor(() => {
      expect(
        screen.getByText(
          '"A square matrix is invertible if and only if its determinant is non-zero."'
        )
      ).toBeInTheDocument();
    });

    // Close modal
    const closeBtn = screen.getByText("Close");
    fireEvent.click(closeBtn);
  });
});

