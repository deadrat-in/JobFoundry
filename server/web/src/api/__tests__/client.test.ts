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
});
