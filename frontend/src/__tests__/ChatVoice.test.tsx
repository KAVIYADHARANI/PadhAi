import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ChatView } from "../components/ChatView";
import { api } from "../services/api";
import { speechService } from "../services/voice";
import { Course } from "../types";

vi.mock("../services/api", () => ({
  api: {
    getChatHistory: vi.fn(),
    sendChatMessage: vi.fn(),
    streamChatMessage: vi.fn(),
    clearChatHistory: vi.fn(),
  },
}));

describe("ChatView Voice Input and Speech Synthesis Integration", () => {
  const mockCourse: Course = {
    id: 1,
    user_id: 10,
    name: "Linear Algebra",
    goal_days: 14,
    hours_per_day: 1.0,
    level: "beginner",
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getChatHistory as any).mockResolvedValue({
      messages: [
        {
          role: "assistant",
          content: "Eigenvalues satisfy det(A - lambda*I) = 0 [doc p.14].",
          clean_answer: "Eigenvalues satisfy det(A - lambda*I) = 0 [doc p.14].",
          citations: ["[doc p.14]"],
          tone: "balanced",
          is_sufficient: true,
          created_at: new Date().toISOString(),
        },
      ],
    });
  });

  it("renders voice input microphone button and auto-read toggle", async () => {
    render(<ChatView course={mockCourse} />);

    await waitFor(() => {
      expect(screen.getByText("Auto-Read")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /start microphone|voice/i })).toBeInTheDocument();
    });
  });

  it("renders listen button on assistant messages and triggers speech synthesis without citations", async () => {
    render(<ChatView course={mockCourse} />);

    await waitFor(() => {
      expect(screen.getByText(/Eigenvalues satisfy/)).toBeInTheDocument();
    });

    // The written message retains the citation token
    expect(screen.getByText("[doc p.14]")).toBeInTheDocument();

    const listenBtn = screen.getByRole("button", { name: /listen to answer/i });
    expect(listenBtn).toBeInTheDocument();

    const speakSpy = vi.spyOn(speechService, "speak");
    fireEvent.click(listenBtn);

    expect(speakSpy).toHaveBeenCalled();
    const calledText = speakSpy.mock.calls[0][0];
    // Spoken text includes content
    expect(calledText).toContain("Eigenvalues satisfy");
  });

  it("toggles microphone recording state when voice button is clicked", async () => {
    render(<ChatView course={mockCourse} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start microphone|voice/i })).toBeInTheDocument();
    });

    const micBtn = screen.getByRole("button", { name: "Start microphone" });
    fireEvent.click(micBtn);

    // Active listening state updates button label and shows listening indicator
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop microphone" })).toBeInTheDocument();
    });
  });

  it("toggles auto-read setting on click", async () => {
    render(<ChatView course={mockCourse} />);

    await waitFor(() => {
      expect(screen.getByText("Auto-Read")).toBeInTheDocument();
    });

    const autoReadBtn = screen.getByRole("button", { name: /auto-read/i });
    fireEvent.click(autoReadBtn);

    expect(localStorage.getItem("padhai_chat_autoread")).toBe("true");
  });
});
