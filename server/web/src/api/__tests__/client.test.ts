import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApiClient } from '../client';
import { Job } from '../../types/job';

const mockJob: Job = {
  id: 'job-1',
  title: 'Senior Engineer',
  company: 'Acme',
  location: 'Remote',
  url: 'https://example.com/job-1',
  source: 'linkedin',
  liveness: 'active',
  fit_score: 88,
  fit_notes: JSON.stringify({
    reasoning: 'Great match',
    matching_skills: ['React', 'TypeScript'],
    missing_skills: [],
  }),
  status: 'new',
  tailored_resume_id: null,
  created_at: 1700000000000,
  updated_at: 1700000000000,
};

describe('ApiClient', () => {
  let client: ApiClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new ApiClient({
      baseUrl: 'http://api.test',
      apiKey: 'test-key-123',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('getJobs sends correct headers and query parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jobs: [mockJob] }),
    });
    global.fetch = fetchMock;

    const jobs = await client.getJobs({ status: 'new', min_score: 80, search: 'Senior' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/v1/jobs?status=new&min_score=80&search=Senior');
    expect(options.headers['Authorization']).toBe('Bearer test-key-123');
    expect(jobs).toEqual([mockJob]);
  });

  it('getJob fetches single job by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: mockJob }),
    });
    global.fetch = fetchMock;

    const job = await client.getJob('job-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/v1/jobs/job-1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key-123' }),
      })
    );
    expect(job).toEqual(mockJob);
  });

  it('updateStatus sends PATCH request with new status', async () => {
    const updated = { ...mockJob, status: 'applied' as const };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: updated }),
    });
    global.fetch = fetchMock;

    const res = await client.updateStatus('job-1', 'applied');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/v1/jobs/job-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'applied' }),
      })
    );
    expect(res.status).toBe('applied');
  });

  it('tailor sends POST request to tailor endpoint', async () => {
    const tailored = {
      ...mockJob,
      status: 'tailored' as const,
      tailored_resume_id: 'tailored-job-1',
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: tailored, tailored_resume_id: 'tailored-job-1' }),
    });
    global.fetch = fetchMock;

    const res = await client.tailor('job-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/v1/jobs/job-1/tailor',
      expect.objectContaining({ method: 'POST' })
    );
    expect(res.job.status).toBe('tailored');
  });

  it('login sends credentials and returns user and token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: { id: 'u1', email: 'test@example.com', name: 'Tester', apiKey: 'jf_123' },
        token: 'jwt-token-123',
      }),
    });
    global.fetch = fetchMock;

    const res = await client.login({ email: 'test@example.com', password: 'password123' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
      })
    );
    expect(res.user.email).toBe('test@example.com');
    expect(res.token).toBe('jwt-token-123');
  });

  it('resume operations: get, upload, setActive, delete', async () => {
    const mockResume = {
      id: 'res-1',
      userId: 'u1',
      title: 'Master Resume',
      resume: { basics: { name: 'Tester' } },
      isActive: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ resumes: [mockResume], resume: mockResume, ok: true }),
    });

    const resumes = await client.getResumes();
    expect(resumes).toEqual([mockResume]);

    const uploaded = await client.uploadResume({
      title: 'Master Resume',
      resumeJson: { basics: { name: 'Tester' } },
    });
    expect(uploaded).toEqual(mockResume);

    const activeSet = await client.setActiveResume('res-1');
    expect(activeSet).toBe(true);

    const deleted = await client.deleteResume('res-1');
    expect(deleted).toBe(true);
  });

  it('throws typed error on 401/404/500 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: 'job not found' }),
    });
    global.fetch = fetchMock;

    await expect(client.getJob('non-existent')).rejects.toThrow('job not found');
  });

  it('getDiagnostics fetches health and telemetry data', async () => {
    const mockDiagnostics = {
      status: 'healthy',
      uptime: 120,
      timestamp: 1700000000000,
      version: '0.1.0',
      database: {
        totalJobs: 10,
        unscoredJobs: 2,
        newJobs: 5,
        appliedJobs: 2,
        rejectedJobs: 1,
        totalUsers: 1,
        totalResumes: 1,
      },
      environment: {
        nodeVersion: 'v22.0.0',
        platform: 'linux',
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockDiagnostics,
    });

    const data = await client.getDiagnostics();
    expect(data.status).toBe('healthy');
    expect(data.database.totalJobs).toBe(10);
  });
});
