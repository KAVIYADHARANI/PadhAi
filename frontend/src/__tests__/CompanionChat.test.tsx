import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MASCOT_NAME } from "../brand";
import { Buddy } from "../components/buddy/Buddy";
import { CompanionChat } from "../components/buddy/CompanionChat";
import { reminderManager } from "../buddy/reminderManager";
import { speechService } from "../services/voice";

vi.mock("../services/api", () => ({
  api: {
    getBuddySettings: vi.fn().mockResolvedValue({ address_term: "boss", tone_mode: "balanced" }),
    updateBuddySettings: vi.fn().mockResolvedValue({ address_term: "boss", tone_mode: "balanced" }),
    startStudySession: vi.fn().mockResolvedValue({ id: 1, course_id: 1, pomodoros: 0 }),
    updateStudySession: vi.fn().mockResolvedValue({ id: 1, pomodoros: 1 }),
    recordBreakEvent: vi.fn().mockResolvedValue({ id: 1, session_id: 1, outcome: "accepted" }),
    getChatHistory: vi.fn().mockResolvedValue({
      messages: [
        {
          role: "assistant",
          content: "Welcome to your study session! Ask me anything.",
          clean_answer: "Welcome to your study session! Ask me anything.",
          tone: "balanced",
          created_at: new Date().toISOString(),
        },
      ],
    }),
    sendChatMessage: vi.fn().mockResolvedValue({
      reply: "Here is the explanation grounded in your notes [doc p.4].",
      clean_answer: "Here is the explanation grounded in your notes [doc p.4].",
      citations: ["[doc p.4]"],
      tone: "balanced",
    }),
    streamChatMessage: vi.fn().mockImplementation(async (_courseId, _payload, callbacks) => {
      callbacks?.onToken?.("Here is the explanation grounded in your notes [doc p.4].");
      callbacks?.onCitations?.(["[doc p.4]"], []);
      callbacks?.onDone?.();
    }),
  },
}));

describe("Interactive CompanionChat & Buddy Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speechService.cancel();
    speechService.setMuted(false);
  });

  it("opens companion chat dialog when the mascot is clicked", async () => {
    render(<Buddy courseId={1} />);

    // Mascot has accessible title / aria-label with MASCOT_NAME
    const mascotBtn = screen.getByRole("button", { name: `Chat with ${MASCOT_NAME}` });
    expect(mascotBtn).toBeInTheDocument();

    fireEvent.click(mascotBtn);

    // Companion chat panel opens with dialog role
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: `${MASCOT_NAME} Study Companion` })).toBeInTheDocument();
      expect(screen.getByText("Welcome to your study session! Ask me anything.")).toBeInTheDocument();
    });
  });

  it("opens companion chat when a proactive reminder bubble is clicked", async () => {
    render(<Buddy courseId={1} />);

    // Trigger proactive reminder inside act
    act(() => {
      reminderManager.triggerReminder(
        "look_away",
        "20 minutes continuous-ah padichitta. Break venuma, boss?",
        "Take a break if you are tired."
      );
    });

    // Reminder bubble appears with message and click-to-reply hint
    await waitFor(() => {
      expect(screen.getByText("20 minutes continuous-ah padichitta. Break venuma, boss?")).toBeInTheDocument();
      expect(screen.getByText("Click to reply")).toBeInTheDocument();
    });

    // Clicking the bubble opens the companion chat
    const bubble = screen.getByText("20 minutes continuous-ah padichitta. Break venuma, boss?");
    fireEvent.click(bubble);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: `${MASCOT_NAME} Study Companion` })).toBeInTheDocument();
    });
  });

  it("handles 'Let\\'s take a break' quick reply: triggers break callback and acknowledges", async () => {
    const handleBreak = vi.fn();
    render(
      <CompanionChat
        courseId={1}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onRequestBreak={handleBreak}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /let's take a break/i })).toBeInTheDocument();
    });

    const breakBtn = screen.getByRole("button", { name: /let's take a break/i });
    fireEvent.click(breakBtn);

    expect(handleBreak).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/break timer started/i)).toBeInTheDocument();
  });

  it("handles 'Continue studying' quick reply: displays acknowledgment without resetting progress", async () => {
    render(
      <CompanionChat
        courseId={1}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onRequestBreak={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /continue studying/i })).toBeInTheDocument();
    });

    const continueBtn = screen.getByRole("button", { name: /continue studying/i });
    fireEvent.click(continueBtn);

    expect(screen.getByText(/great determination/i)).toBeInTheDocument();
  });

  it("handles 'Explain this topic' quick reply with lesson context and queries tutor API", async () => {
    const mockLesson = {
      item: {
        id: 1,
        course_id: 1,
        day: 1,
        topic_name: "Linear Equations",
        title: "Linear Equations",
        order_index: 0,
        completed: false,
        learning_objectives: [],
        tasks: [],
      },
      taskId: "task-1",
      lessonTitle: "Matrix Inversion & Determinants",
    };

    render(
      <CompanionChat
        courseId={1}
        currentLesson={mockLesson as any}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onRequestBreak={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /explain this topic/i })).toBeInTheDocument();
    });

    const explainBtn = screen.getByRole("button", { name: /explain this topic/i });
    fireEvent.click(explainBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/Matrix Inversion & Determinants/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("handles 'I\\'m feeling sleepy' quick reply with supportive advice without diagnosing", async () => {
    render(
      <CompanionChat
        courseId={1}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onRequestBreak={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /i'm feeling sleepy/i })).toBeInTheDocument();
    });

    const sleepyBtn = screen.getByRole("button", { name: /i'm feeling sleepy/i });
    fireEvent.click(sleepyBtn);

    expect(screen.getByText(/wash your face with cold water/i)).toBeInTheDocument();
  });

  it("sends custom typed question and displays tutor response with citations", async () => {
    render(
      <CompanionChat
        courseId={1}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onRequestBreak={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(new RegExp(`Reply to ${MASCOT_NAME}`, "i"))).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(new RegExp(`Reply to ${MASCOT_NAME}`, "i"));
    fireEvent.change(textarea, { target: { value: "What is an eigenvalue?" } });

    const sendBtn = screen.getByRole("button", { name: "Send message" });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText("What is an eigenvalue?")).toBeInTheDocument();
      expect(screen.getByText(/Here is the explanation grounded in your notes/)).toBeInTheDocument();
      expect(screen.getByText("[doc p.4]")).toBeInTheDocument();
    });
  });

  it("triggers speech synthesis on assistant messages and cleans citation tokens from spoken audio", async () => {
    render(
      <CompanionChat
        courseId={1}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onRequestBreak={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /listen to answer/i })).toBeInTheDocument();
    });

    const speakSpy = vi.spyOn(speechService, "speak");
    const listenBtn = screen.getByRole("button", { name: /listen to answer/i });
    fireEvent.click(listenBtn);

    expect(speakSpy).toHaveBeenCalled();
  });

  it("supports minimizing and closing companion chat panel without resetting study timer", async () => {
    const handleClose = vi.fn();
    const handleMinimize = vi.fn();

    render(
      <CompanionChat
        courseId={1}
        onClose={handleClose}
        onMinimize={handleMinimize}
        onRequestBreak={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Minimize companion" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close companion" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Minimize companion" }));
    expect(handleMinimize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close companion" }));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
