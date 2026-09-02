import { Job, JobFilters, TailorResponse } from '../types/job';

export interface User {
  id: string;
  email: string;
  name: string;
  apiKey: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface UserResume {
  id: string;
  userId: string;
  title: string;
  resume: Record<string, any>;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DiagnosticsInfo {
  status: string;
  uptime: number;
  timestamp: number;
  version: string;
  database: {
    totalJobs: number;
    unscoredJobs: number;
    newJobs: number;
    appliedJobs: number;
    rejectedJobs: number;
    totalUsers: number;
    totalResumes: number;
  };
  environment: {
    nodeVersion: string;
    platform: string;
  };
}

export interface ApiClientConfig {
  baseUrl?: string;
  apiKey?: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string | null;

  constructor(config?: ApiClientConfig) {
    const defaultUrl =
      import.meta.env.VITE_API_URL !== undefined
        ? import.meta.env.VITE_API_URL
        : typeof window !== 'undefined'
          ? window.location.origin
          : 'http://localhost:8080';
    this.baseUrl = (config?.baseUrl ?? defaultUrl).replace(/\/$/, '');
    this.apiKey = config?.apiKey || null;
  }


  setApiKey(key: string | null) {
    this.apiKey = key;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, '');
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorMessage = response.statusText;
      let details;
      try {
        const errorJson = await response.json();
        errorMessage = errorJson.error || errorJson.message || errorMessage;
        details = errorJson;
      } catch {
        // Response wasn't JSON
      }
      console.error(
        `[API Error] ${options.method || 'GET'} ${url} (${response.status}):`,
        errorMessage,
        details
      );
      throw new ApiError(response.status, errorMessage, details);
    }

    return response.json();
  }

  // --- Auth Endpoints ---
  async login(payload: { email: string; password: string }): Promise<AuthResponse> {
    return this.request<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async register(payload: {
    email: string;
    password: string;
    name?: string;
  }): Promise<AuthResponse> {
    return this.request<AuthResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getMe(): Promise<User> {
    const res = await this.request<{ user: User }>('/api/v1/auth/me');
    return res.user;
  }

  async rotateApiKey(): Promise<string> {
    const res = await this.request<{ apiKey: string }>('/api/v1/auth/api-key/rotate', {
      method: 'POST',
    });
    return res.apiKey;
  }

  // --- Resume Endpoints ---
  async getResumes(): Promise<UserResume[]> {
    const res = await this.request<{ resumes: UserResume[] }>('/api/v1/resumes');
    return res.resumes;
  }

  async getActiveResume(): Promise<UserResume | null> {
    const res = await this.request<{ resume: UserResume | null }>('/api/v1/resumes/active');
    return res.resume;
  }

  async uploadResume(payload: {
    title?: string;
    resumeJson: Record<string, any> | string;
    setActive?: boolean;
  }): Promise<UserResume> {
    const res = await this.request<{ resume: UserResume }>('/api/v1/resumes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.resume;
  }

  async setActiveResume(id: string): Promise<boolean> {
    const res = await this.request<{ ok: boolean }>(`/api/v1/resumes/${id}/active`, {
      method: 'PUT',
    });
    return res.ok;
  }

  async deleteResume(id: string): Promise<boolean> {
    const res = await this.request<{ ok: boolean }>(`/api/v1/resumes/${id}`, {
      method: 'DELETE',
    });
    return res.ok;
  }

  // --- Job Endpoints ---
  async parseJd(payload: { text?: string; markdown?: string; url?: string }): Promise<{
    ok: boolean;
    job: {
      title: string;
      company: string;
      location: string | null;
      salary: string | null;
      employmentType: string | null;
      description: string;
      requirements: string[];
      url?: string;
    };
  }> {
    return this.request('/api/v1/jobs/parse-jd', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async ingestJobs(jobs: Partial<Job>[] | Partial<Job>): Promise<{
    ingested: number;
    deduped: number;
    ids: string[];
  }> {
    const payload = Array.isArray(jobs) ? jobs : [jobs];
    return this.request('/api/v1/jobs/ingest', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getJobs(filters: JobFilters = {}): Promise<Job[]> {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.source) params.set('source', filters.source);
    if (filters.min_score !== undefined) params.set('min_score', String(filters.min_score));
    if (filters.search) params.set('search', filters.search);
    if (filters.limit) params.set('limit', String(filters.limit));

    const queryString = params.toString();
    const path = `/api/v1/jobs${queryString ? `?${queryString}` : ''}`;
    const res = await this.request<{ jobs: Job[] }>(path);
    return res.jobs;
  }

  async getJob(id: string): Promise<Job> {
    const res = await this.request<{ job: Job }>(`/api/v1/jobs/${id}`);
    return res.job;
  }

  async updateStatus(id: string, status: string): Promise<Job> {
    const res = await this.request<{ job: Job }>(`/api/v1/jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    return res.job;
  }

  async updateJobDescription(id: string, description: string): Promise<Job> {
    const res = await this.request<{ job: Job }>(`/api/v1/jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description }),
    });
    return res.job;
  }

  async decantJob(id: string): Promise<{ ok: boolean; job: Job; description: string }> {
    return this.request<{ ok: boolean; job: Job; description: string }>(`/api/v1/jobs/${id}/decant`, {
      method: 'POST',
    });
  }

  async deleteJob(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/v1/jobs/${id}`, {
      method: 'DELETE',
    });
  }

  async tailor(id: string): Promise<TailorResponse> {
    return this.request<TailorResponse>(`/api/v1/jobs/${id}/tailor`, {
      method: 'POST',
    });
  }

  getArtifactUrl(id: string, filename: string): string {
    return `${this.baseUrl}/api/v1/jobs/${id}/artifacts/${filename}`;
  }

  async downloadPdf(id: string, theme: 'folio' | 'concise' = 'folio'): Promise<Blob> {
    const filename = theme === 'concise' ? 'resume-concise.pdf' : 'resume.pdf';
    const url = this.getArtifactUrl(id, filename);
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new ApiError(response.status, `Failed to download ${filename}`);
    }
    return response.blob();
  }

  async downloadAts(id: string): Promise<string> {
    const url = this.getArtifactUrl(id, 'resume.txt');
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new ApiError(response.status, 'Failed to download ATS text');
    }
    return response.text();
  }

  async getPipelineStats(): Promise<{
    total: number;
    unscored: number;
    scored: number;
    tailored: number;
    failed: number;
  }> {
    const res = await this.request<{
      ok: boolean;
      stats: { total: number; unscored: number; scored: number; tailored: number; failed: number };
    }>('/api/v1/pipeline/stats');
    return res.stats;
  }

  async getPipelineJobs(): Promise<any[]> {
    const res = await this.request<{ ok: boolean; jobs: any[] }>('/api/v1/pipeline/jobs');
    return res.jobs;
  }

  async getTailoredResume(id: string): Promise<Record<string, any> | null> {
    const url = this.getArtifactUrl(id, 'resume.json');
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  async getDiagnostics(): Promise<DiagnosticsInfo> {
    return this.request<DiagnosticsInfo>('/api/v1/diagnostics');
  }
}

export const api = new ApiClient();
