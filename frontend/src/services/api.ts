import { Course, CreateCourseInput, Document, User } from "../types";
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
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
};
