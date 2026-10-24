import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MascotPlaceholder } from "../components/MascotPlaceholder";
import { Navbar } from "../components/Navbar";
import { CreateCourseModal } from "../components/CreateCourseModal";
import { PRODUCT_NAME, MASCOT_NAME } from "../brand";

// Mock AuthContext for Navbar tests
vi.mock("../contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    user: { email: "student@example.com", displayName: "Student One" },
    logout: vi.fn(),
  })),
}));

describe("UI Components", () => {
  describe("MascotPlaceholder", () => {
    it("renders mascot name from brand configuration and study buddy badge", () => {
      render(<MascotPlaceholder />);

      expect(screen.getByText(MASCOT_NAME)).toBeInTheDocument();
      expect(screen.getByText("Study Buddy")).toBeInTheDocument();
      expect(screen.getByText("Grounded")).toBeInTheDocument();
    });

    it("renders compact mode without explanatory helper box", () => {
      const { container } = render(<MascotPlaceholder compact={true} />);
      expect(
        screen.queryByText(/interactive quiz & pacing assistance/i)
      ).not.toBeInTheDocument();
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("Navbar", () => {
    it("renders brand name and logged-in user profile", () => {
      render(<Navbar />);

      expect(screen.getByText(PRODUCT_NAME)).toBeInTheDocument();
      expect(screen.getByText("student@example.com")).toBeInTheDocument();
      expect(screen.getByText("Sign Out")).toBeInTheDocument();
    });
  });

  describe("CreateCourseModal", () => {
    it("renders form inputs when open and handles submission", async () => {
      const handleSubmit = vi.fn().mockResolvedValue(undefined);
      const handleClose = vi.fn();

      render(
        <CreateCourseModal
          isOpen={true}
          onClose={handleClose}
          onSubmit={handleSubmit}
        />
      );

      expect(screen.getByText("Create New Course")).toBeInTheDocument();

      const input = screen.getByPlaceholderText(/Operating Systems/i);
      fireEvent.change(input, { target: { value: "Algorithms 101" } });

      const submitBtn = screen.getByRole("button", { name: /Create Course/i });
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(handleSubmit).toHaveBeenCalledWith({
        name: "Algorithms 101",
        goal_days: 14,
        hours_per_day: 2.0,
        level: "intermediate",
      });
    });

    it("does not render when isOpen is false", () => {
      const { container } = render(
        <CreateCourseModal
          isOpen={false}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });
});
