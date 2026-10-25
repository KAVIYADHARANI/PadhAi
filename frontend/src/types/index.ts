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
  chunks_count?: number;
  is_indexed?: boolean;
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
  module_name?: string | null;
  description?: string | null;
  learning_objective?: string | null;
  chunks_count?: number;
  pages?: number[];
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

export interface SourceReference {
  document_id: number;
  document_name: string;
  page: number;
  chunk_id?: number | null;
  heading?: string | null;
}

export interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  clean_answer?: string;
  sources?: SourceReference[];
  citations?: string[];
  tone?: string | null;
  is_sufficient?: boolean;
  grounding_status?: string;
  created_at?: string;
}

export interface ChatHistoryResponse {
  course_id: number;
  thread_id?: number | null;
  messages: ChatMessage[];
}

export interface ChatReplyResponse {
  reply: string;
  clean_answer?: string;
  sources?: SourceReference[];
  citations: string[];
  tone: string;
  is_sufficient: boolean;
  grounding_status?: string;
}

export interface WebResource {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  relevance_reason: string;
  learning_objective: string;
  level: "beginner" | "intermediate" | "advanced" | string;
  retrieval_date?: string;
  verified?: boolean;
}

export interface YouTubeResource {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  duration: string;
  video_url: string;
  embed_url: string;
  relevance_reason: string;
}

export interface LessonSection {
  id: string;
  title: string;
  content: string;
  key_concepts: string[];
  code_snippet?: string | null;
  source_citations?: string[];
}

export interface TermDefinition {
  term: string;
  definition: string;
}

export interface WorkedExample {
  problem: string;
  step_by_step_solution: string[];
  explanation: string;
}

export interface Misconception {
  misconception: string;
  correction: string;
  explanation: string;
}

export interface LessonExercise {
  id: string;
  prompt: string;
  exercise_type: "conceptual" | "code" | "numerical" | "scenario" | string;
  difficulty: "easy" | "medium" | "hard" | string;
  hints: string[];
  solution: string;
  explanation: string;
}

export interface SelfCheckQuestion {
  id: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

export interface LessonContent {
  title: string;
  introduction: string;
  prerequisites: string[];
  sections: LessonSection[];
  key_terms: TermDefinition[];
  worked_examples: WorkedExample[];
  misconceptions: Misconception[];
  summary: string;
  takeaways: string[];
  exercises: LessonExercise[];
  self_check_questions: SelfCheckQuestion[];
  deeper_learning: string[];
}

export interface Lesson {
  id: number;
  course_id: number;
  roadmap_item_id: number;
  task_id: string;
  topic_id?: number | null;
  user_id: number;
  title: string;
  estimated_minutes: number;
  content: LessonContent;
  web_resources: WebResource[];
  youtube_resources: YouTubeResource[];
  exercises: LessonExercise[];
  sources: SourceReference[];
  status: string;
  created_at: string;
  updated_at: string;
}

export interface LessonProgress {
  id: number;
  lesson_id: number;
  user_id: number;
  course_id: number;
  sections_completed: string[];
  exercises_completed: Record<string, { solved: boolean; answer: string; timestamp?: string }>;
  quiz_score?: number | null;
  quiz_completed: boolean;
  completed: boolean;
  time_spent_seconds: number;
  reflection?: string | null;
  updated_at: string;
}

export interface LessonProgressUpdateRequest {
  section_id?: string;
  section_completed?: boolean;
  exercise_id?: string;
  exercise_attempt?: { solved: boolean; answer: string };
  quiz_score?: number;
  quiz_completed?: boolean;
  completed?: boolean;
  add_time_seconds?: number;
  reflection?: string;
}

export interface LessonChatResponse {
  reply: string;
  clean_answer?: string;
  sources: SourceReference[];
  citations: string[];
  tone: string;
}



