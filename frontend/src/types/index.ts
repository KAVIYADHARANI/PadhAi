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

export interface RoadmapTask {
  id: string;
  task: string;
  estimated_minutes: number;
  completed: boolean;
}

export interface RoadmapItem {
  id: number;
  course_id: number;
  day: number;
  topic_id?: number | null;
  topic_name: string;
  title: string;
  learning_objectives: string[];
  tasks: RoadmapTask[];
  estimated_minutes: number;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoadmapProgress {
  course_id: number;
  total_days: number;
  completed_days: number;
  total_tasks: number;
  completed_tasks: number;
  percent_complete: number;
  items: RoadmapItem[];
}

export interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  citations?: string[];
  tone?: string | null;
  is_sufficient?: boolean;
  created_at?: string;
}

export interface ChatHistoryResponse {
  course_id: number;
  thread_id?: number | null;
  messages: ChatMessage[];
}

export interface ChatReplyResponse {
  reply: string;
  citations: string[];
  tone: string;
  is_sufficient: boolean;
}


