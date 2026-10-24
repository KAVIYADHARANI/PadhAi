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

export interface Topic {
  id: number;
  course_id: number;
  name: string;
  parent_id?: number | null;
}

export interface QuizQuestion {
  id: number;
  course_id: number;
  topic_id: number;
  stem: string;
  question_type: string;
  options: string[];
  difficulty: number;
}

export interface QuizResponse {
  course_id: number;
  topic_id: number;
  questions: QuizQuestion[];
}

export interface AttemptSubmission {
  question_id: number;
  selected_answer: string;
  time_ms: number;
}

export interface AttemptResult {
  id: number;
  question_id: number;
  selected_answer: string;
  correct: boolean;
  answer: string;
  explanation: string;
  source_chunk_ids: number[];
  new_mastery_score: number;
  time_ms: number;
  created_at: string;
}

export interface TopicMastery {
  topic_id: number;
  topic_name: string;
  score: number;
  attempts_count: number;
  updated_at: string | null;
}

export interface CourseProgress {
  course_id: number;
  topics: TopicMastery[];
  weak_topics: number[];
}

