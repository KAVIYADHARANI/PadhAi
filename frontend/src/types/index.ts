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

export type DocumentStatus = "queued" | "processing" | "indexed" | "error";

export interface Document {
  id: number;
  course_id: number;
  user_id: number;
  filename: string;
  file_hash: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus;
  page_count?: number | null;
  error_message?: string | null;
  created_at: string;
}

export interface ApiError {
  detail: string;
}
