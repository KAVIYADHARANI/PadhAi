import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, ApiError, MAX_UPLOAD_MB, ALLOWED_EXTENSIONS } from "../services/api";
import * as firebaseService from "../services/firebase";

vi.mock("../services/firebase", () => ({
  getAuthToken: vi.fn(),
  auth: {},
}));

describe("API Service Client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("exports upload limits and extensions conforming to backend specification", () => {
    expect(MAX_UPLOAD_MB).toBe(25);
    expect(ALLOWED_EXTENSIONS).toContain(".pdf");
    expect(ALLOWED_EXTENSIONS).toContain(".txt");
  });

  it("attaches Firebase Bearer token when user is authenticated", async () => {
    vi.mocked(firebaseService.getAuthToken).mockResolvedValueOnce("test-firebase-id-token");

    let capturedHeaders: Headers | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });
    });

    const courses = await api.getCourses();
    expect(courses).toEqual([]);
    expect(capturedHeaders?.get("Authorization")).toBe("Bearer test-firebase-id-token");
  });

  it("sends request without Authorization header when no user is signed in", async () => {
    vi.mocked(firebaseService.getAuthToken).mockResolvedValueOnce(null);

    let capturedHeaders: Headers | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 1, email: "learner@example.com" }),
      });
    });

    const me = await api.getMe();
    expect(me.id).toBe(1);
    expect(capturedHeaders?.get("Authorization")).toBeNull();
  });

  it("throws ApiError with detail message on non-200 responses", async () => {
    vi.mocked(firebaseService.getAuthToken).mockResolvedValue("token");

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: "Course not found" }),
    });

    await expect(api.getCourses()).rejects.toThrow(ApiError);
    await expect(api.getCourses()).rejects.toMatchObject({
      status: 404,
      message: "Course not found",
    });
  });

  it("refreshes Firebase token with forceRefresh=true and retries once on 401 response", async () => {
    // First call returns stale token, retry call returns fresh token
    vi.mocked(firebaseService.getAuthToken)
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token")
      .mockResolvedValueOnce("fresh-token");

    const authHeadersSent: string[] = [];
    let callCount = 0;

    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      callCount++;
      const headers = init?.headers as Headers;
      authHeadersSent.push(headers.get("Authorization") || "");

      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ detail: "Invalid or expired token" }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ id: 1, name: "Algorithms" }]),
      });
    });

    const courses = await api.getCourses();
    expect(courses).toEqual([{ id: 1, name: "Algorithms" }]);
    expect(callCount).toBe(2);
    expect(authHeadersSent).toEqual(["Bearer stale-token", "Bearer fresh-token"]);
    expect(firebaseService.getAuthToken).toHaveBeenCalledWith(true);
  });

  it("throws ApiError if 401 persists after retry without entering an infinite loop", async () => {
    vi.mocked(firebaseService.getAuthToken).mockResolvedValue("token");

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: "Invalid or expired token" }),
      });
    });

    await expect(api.getCourses()).rejects.toThrow(ApiError);
    expect(callCount).toBe(2); // exactly 1 initial + 1 retry
  });

  it("creates course with JSON payload", async () => {
    vi.mocked(firebaseService.getAuthToken).mockResolvedValueOnce("token");

    let requestBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      requestBody = init?.body as string;
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            id: 10,
            user_id: 1,
            name: "Data Structures",
            goal_days: 10,
            hours_per_day: 2,
            level: "intermediate",
            created_at: "2026-10-24T00:00:00Z",
          }),
      });
    });

    const created = await api.createCourse({
      name: "Data Structures",
      goal_days: 10,
      hours_per_day: 2,
      level: "intermediate",
    });

    expect(created.id).toBe(10);
    expect(created.name).toBe("Data Structures");
    expect(requestBody).toBeDefined();
    expect(JSON.parse(requestBody!)).toEqual({
      name: "Data Structures",
      goal_days: 10,
      hours_per_day: 2,
      level: "intermediate",
    });
  });

  it("deletes course via DELETE request and handles 204 No Content", async () => {
    vi.mocked(firebaseService.getAuthToken).mockResolvedValueOnce("token");

    let methodUsed = "";
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      methodUsed = init?.method || "";
      return Promise.resolve({
        ok: true,
        status: 204,
      });
    });

    await api.deleteCourse(42);
    expect(methodUsed).toBe("DELETE");
  });

  it("uploads document using multipart FormData without JSON content type", async () => {
    vi.mocked(firebaseService.getAuthToken).mockResolvedValueOnce("token");

    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            id: 1,
            course_id: 5,
            user_id: 1,
            filename: "syllabus.pdf",
            file_hash: "hash123",
            mime_type: "application/pdf",
            size_bytes: 1024,
            status: "queued",
            created_at: "2026-10-24T00:00:00Z",
          }),
      });
    });

    const dummyFile = new File(["dummy content"], "syllabus.pdf", {
      type: "application/pdf",
    });

    const doc = await api.uploadDocument(5, dummyFile);
    expect(doc.id).toBe(1);
    expect(doc.status).toBe("queued");
    expect(capturedInit?.body).toBeInstanceOf(FormData);
    // Header Content-Type must not be forced to application/json so browser sets boundary
    const headers = capturedInit?.headers as Headers;
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("fetches course documents via getCourseDocuments", async () => {
    vi.mocked(firebaseService.getAuthToken).mockResolvedValueOnce("token");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            id: 1,
            course_id: 5,
            filename: "syllabus.pdf",
            size_bytes: 2048,
            status: "ready",
            created_at: "2026-10-24T00:00:00Z",
          },
        ]),
    });

    const docs = await api.getCourseDocuments(5);
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe(1);
    expect(docs[0].status).toBe("ready");
    expect(docs[0].filename).toBe("syllabus.pdf");
  });
});
