export interface FitNotes {
  reasoning?: string;
  matching_skills?: string[];
  missing_skills?: string[];
}

export type JobStatus =
  | 'new'
  | 'rejected_by_score'
  | 'saved'
  | 'tailored'
  | 'applied'
  | 'interview'
  | 'offer'
  | 'rejected';

export interface Job {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  url: string;
  source: string;
  posted_at?: number | null;
  description?: string | null;
  fingerprint?: string | null;
  liveness: 'active' | 'expired' | 'unknown';
  fit_score?: number | null;
  fit_notes?: string | null;
  status: JobStatus;
  tailored_resume_id?: string | null;
  created_at: number;
  updated_at: number;
}

export interface JobFilters {
  status?: string;
  source?: string;
  min_score?: number;
  search?: string;
  limit?: number;
}

export interface TailorResponse {
  job: Job;
  tailored_resume_id: string;
}
