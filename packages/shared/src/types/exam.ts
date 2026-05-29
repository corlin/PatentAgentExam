export interface KnowledgePoint {
  id: string;
  subject_id: string;
  chapter_id: string;
  name: string;
  aliases?: string[];
  importance: 'high' | 'medium' | 'low';
  exam_frequency?: 'high' | 'medium' | 'low';
  difficulty?: 'high' | 'medium' | 'low';
  description?: string;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface Chapter {
  id: string;
  subject_id: string;
  name: string;
  description?: string;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  knowledge_points?: KnowledgePoint[];
}

export interface Subject {
  id: string;
  name: string;
  description?: string;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  chapters?: Chapter[];
}

// 统一的接口响应外壳，可选
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
