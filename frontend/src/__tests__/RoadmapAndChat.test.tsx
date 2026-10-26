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
    updateRoadmapItem: vi.fn(),
    getCourseDocuments: vi.fn(),
    getChatHistory: vi.fn(),
    sendChatMessage: vi.fn(),
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

  it("ChatView renders empty state and sends grounded query", async () => {
    vi.mocked(api.getChatHistory).mockResolvedValue({
      course_id: 1,
      thread_id: 1,
      messages: [],
    });
    vi.mocked(api.sendChatMessage).mockResolvedValue({
      reply: "Vectors have both magnitude and direction [doc p.3].",
      citations: ["[doc p.3]"],
      tone: "patient",
      is_sufficient: true,
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
});
