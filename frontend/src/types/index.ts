export interface User {
  id: number;
  firebase_uid: string;
  email: string | null;
}

export interface Course {
  id: number;
  user_id: number;
  name: string;
  goal_days: number;
  hours_per_day: number;
  level: "beginner" | "intermediate" | "advanced" | string;
  created_at: string;
}

export interface CreateCourseInput {
  name: string;
  goal_days: number;
  hours_per_day: number;
  level: "beginner" | "intermediate" | "advanced";
}

export type DocumentStatus = "queued" | "processing" | "ready" | "failed" | "indexed" | "error";

export interface Document {
  id: number;
  course_id: number;
  filename: string;
  size_bytes?: number | null;
  status: DocumentStatus;
  pages?: number | null;
  pages_ocr?: number | null;
  ocr_avg_conf?: number | null;
  error?: string | null;
  created_at: string;
}

export interface ApiError {
  detail: string;
}
