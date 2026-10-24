import {
  AttemptResult,
  AttemptSubmission,
  ChatHistoryResponse,
  ChatReplyResponse,
  Course,
  CourseProgress,
  CreateCourseInput,
  Document,
  QuizResponse,
  RoadmapItem,
  RoadmapProgress,
  Topic,
  User,
} from "../types";
import { getAuthToken } from "./firebase";

const API_BASE_URL =
  typeof import.meta.env.VITE_API_BASE_URL === "string"
    ? import.meta.env.VITE_API_BASE_URL
    : "";

export const MAX_UPLOAD_MB = 25;
export const ALLOWED_EXTENSIONS = [".pdf", ".txt"];
export const ALLOWED_MIME_TYPES = ["application/pdf", "text/plain"];

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const token = await getAuthToken(isRetry);
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Set json content-type unless body is FormData (file upload)
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson && errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // Body not json
    }

    // If 401 Unauthorized occurs on an authenticated request and we haven't retried yet,
    // refresh the Firebase ID token and retry once without looping.
    if (response.status === 401 && !isRetry && token) {
      const freshToken = await getAuthToken(true);
      if (freshToken) {
        return request<T>(path, options, true);
      }
    }

    throw new ApiError(response.status, errorDetail);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export const api = {
  // Current user info
  async getMe(): Promise<User> {
    return request<User>("/api/me");
  },

  // Courses
  async getCourses(): Promise<Course[]> {
    return request<Course[]>("/api/courses");
  },

  async createCourse(input: CreateCourseInput): Promise<Course> {
    return request<Course>("/api/courses", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async deleteCourse(courseId: number): Promise<void> {
    await request<void>(`/api/courses/${courseId}`, {
      method: "DELETE",
    });
  },

  // Documents
  async getCourseDocuments(courseId: number): Promise<Document[]> {
    return request<Document[]>(`/api/courses/${courseId}/documents`);
  },

  async uploadDocument(courseId: number, file: File): Promise<Document> {
    const formData = new FormData();
    formData.append("file", file);

    return request<Document>(`/api/courses/${courseId}/documents`, {
      method: "POST",
      body: formData,
    });
  },

  async getDocument(documentId: number): Promise<Document> {
    return request<Document>(`/api/documents/${documentId}`);
  },

  // Topics
  async getCourseTopics(courseId: number): Promise<Topic[]> {
    return request<Topic[]>(`/api/courses/${courseId}/topics`);
  },

  // Quizzes & Attempts
  async generateQuiz(courseId: number, topicId: number, count = 5): Promise<QuizResponse> {
    return request<QuizResponse>("/api/quizzes", {
      method: "POST",
      body: JSON.stringify({
        course_id: courseId,
        topic_id: topicId,
        count,
      }),
    });
  },

  async submitAttempt(submission: AttemptSubmission): Promise<AttemptResult> {
    return request<AttemptResult>("/api/attempts", {
      method: "POST",
      body: JSON.stringify(submission),
    });
  },

  // Progress
  async getCourseProgress(courseId: number): Promise<CourseProgress> {
    return request<CourseProgress>(`/api/progress/${courseId}`);
  },

  // Roadmap
  async getCourseRoadmap(courseId: number): Promise<RoadmapProgress> {
    return request<RoadmapProgress>(`/api/courses/${courseId}/roadmap`);
  },

  async generateCourseRoadmap(courseId: number, overwrite = false): Promise<RoadmapProgress> {
    const query = overwrite ? "?overwrite=true" : "";
    return request<RoadmapProgress>(`/api/courses/${courseId}/roadmap${query}`, {
      method: "POST",
    });
  },

  async updateRoadmapItem(
    courseId: number,
    itemId: number,
    payload: { completed?: boolean; task_id?: string; task_completed?: boolean }
  ): Promise<RoadmapItem> {
    return request<RoadmapItem>(`/api/courses/${courseId}/roadmap/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  // Chat / Assistant
  async getChatHistory(courseId: number): Promise<ChatHistoryResponse> {
    return request<ChatHistoryResponse>(`/api/courses/${courseId}/chat/history`);
  },

  async sendChatMessage(
    courseId: number,
    message: string,
    userToneSetting: "full" | "balanced" | "serious" | "english_only" = "balanced"
  ): Promise<ChatReplyResponse> {
    return request<ChatReplyResponse>(`/api/courses/${courseId}/chat`, {
      method: "POST",
      body: JSON.stringify({
        message,
        user_tone_setting: userToneSetting,
      }),
    });
  },

  async clearChatHistory(courseId: number): Promise<void> {
    await request<void>(`/api/courses/${courseId}/chat/history`, {
      method: "DELETE",
    });
  },

  // Buddy & Sessions
  async getBuddySettings(): Promise<BuddySettingsResponse> {
    return request<BuddySettingsResponse>("/api/buddy/settings");
  },

  async updateBuddySettings(
    payload: BuddySettingsUpdateRequest
  ): Promise<BuddySettingsResponse> {
    return request<BuddySettingsResponse>("/api/buddy/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  async startStudySession(courseId: number): Promise<StudySessionResponse> {
    return request<StudySessionResponse>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ course_id: courseId }),
    });
  },

  async updateStudySession(
    sessionId: number,
    payload: StudySessionUpdateRequest
  ): Promise<StudySessionResponse> {
    return request<StudySessionResponse>(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  async recordBreakEvent(
    sessionId: number,
    payload: BreakEventCreateRequest
  ): Promise<BreakEventResponse> {
    return request<BreakEventResponse>(`/api/sessions/${sessionId}/break-events`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

export interface StudySessionResponse {
  id: number;
  user_id: number;
  course_id: number;
  started_at: string;
  ended_at?: string | null;
  pomodoros: number;
  focus_avg?: number | null;
  drowsy_minutes?: number | null;
}

export interface StudySessionUpdateRequest {
  pomodoros?: number;
  focus_avg?: number;
  drowsy_minutes?: number;
  ended?: boolean;
}

export interface BreakEventResponse {
  id: number;
  session_id: number;
  user_id: number;
  break_type: string;
  outcome: string;
  cooldown_at_time_s: number;
  created_at: string;
}

export interface BreakEventCreateRequest {
  break_type: string;
  outcome: string;
  cooldown_at_time_s: number;
}

export interface BuddySettingsResponse {
  persona_pack: string;
  tone_mode: string;
  address_term: string;
  sensitivity: string;
  camera_enabled: boolean;
}

export interface BuddySettingsUpdateRequest {
  persona_pack?: string;
  tone_mode?: string;
  address_term?: string;
  sensitivity?: string;
  camera_enabled?: boolean;
}


