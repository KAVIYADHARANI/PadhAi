import { describe, it, expect, vi } from "vitest";
import { render, screen, renderHook } from "@testing-library/react";
import { AuthProvider, useAuth } from "../contexts/AuthContext";

// Mock firebase/auth
vi.mock("firebase/auth", () => {
  return {
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn((_auth, callback) => {
      // Simulate unauthenticated initial state
      callback(null);
      return vi.fn(); // unsubscribe
    }),
    GoogleAuthProvider: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signInWithPopup: vi.fn(),
    signOut: vi.fn(),
    connectAuthEmulator: vi.fn(),
  };
});

vi.mock("../services/firebase", () => ({
  auth: {},
  loginWithEmail: vi.fn(),
  registerWithEmail: vi.fn(),
  loginWithGoogle: vi.fn(),
  logout: vi.fn(),
  getAuthToken: vi.fn().mockResolvedValue(null),
}));

describe("AuthContext and AuthProvider", () => {
  it("throws descriptive error when useAuth is accessed outside AuthProvider", () => {
    // Suppress console.error during expected throw
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useAuth());
    }).toThrow("useAuth must be used within an AuthProvider");

    consoleSpy.mockRestore();
  });

  it("provides authentication state and methods inside provider", () => {
    const TestConsumer = () => {
      const { user, loading } = useAuth();
      return (
        <div>
          <span data-testid="loading-state">{loading ? "loading" : "ready"}</span>
          <span data-testid="user-state">{user ? "authenticated" : "anonymous"}</span>
        </div>
      );
    };

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("loading-state")).toHaveTextContent("ready");
    expect(screen.getByTestId("user-state")).toHaveTextContent("anonymous");
  });
});
