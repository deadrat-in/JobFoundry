import { Job, JobFilters, TailorResponse } from '../types/job';

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
    this.baseUrl = (config?.baseUrl || import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/$/, '');
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
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

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
      throw new ApiError(response.status, errorMessage, details);
    }

    return response.json();
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
}

export const api = new ApiClient();
