import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../server/ingest/src/db/index.mjs';
import { buildApp } from '../server/ingest/src/app.mjs';
import { sendJobs } from '../extension/src/shared/ingest-client.js';

const ROOT = resolve(import.meta.dirname, '..');
const SCORER_DIR = resolve(ROOT, 'server/scorer');

const FIXTURE_JOB = {
  title: 'Staff Distributed Systems Engineer',
  company: 'FoundryTech',
  location: 'San Francisco, CA (Remote)',
  url: 'https://foundrytech.example/careers/staff-eng-42',
  source: 'greenhouse',
  postedAt: '2026-08-18T10:00:00Z',
  description:
    'We are looking for a Staff Distributed Systems Engineer to design high-throughput stream processing pipelines. Requirements: Go, Rust, Distributed consensus (Raft/Paxos), Kafka, and SQLite internals. 8+ years experience building low-latency backend infrastructure.',
};

test('End-to-end integration flow: extension → ingest → score → tailor → PDF/ATS → web API', async (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'jobfoundry-e2e-'));
  const dbPath = join(tmpDir, 'test-jobfoundry.db');
  const artifactsDir = join(tmpDir, 'artifacts');
  const apiKey = 'test-e2e-api-key-999';

  const db = openDb({ path: dbPath });
  const app = buildApp({ db, apiKeys: [apiKey], artifactsDir });
  const serverAddress = await app.listen({ port: 0, host: '127.0.0.1' });

  t.after(async () => {
    await app.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Step 1: Extension sends job posting to ingest server
  const ingestResult = await sendJobs({
    serverUrl: serverAddress,
    apiKey,
    jobs: [FIXTURE_JOB],
    fetchImpl: fetch,
  });

  assert.equal(ingestResult.ingested, 1, 'First ingest must ingest 1 job');
  assert.equal(ingestResult.deduped, 0, 'First ingest should not dedup');
  assert.ok(ingestResult.ids.length === 1, 'Returns array with 1 job id');
  const jobId = ingestResult.ids[0];

  // Verify DB state after ingest
  const rawJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  assert.ok(rawJob, 'Job must exist in SQLite DB');
  assert.equal(rawJob.title, FIXTURE_JOB.title);
  assert.equal(rawJob.company, FIXTURE_JOB.company);
  assert.equal(rawJob.status, 'new');
  assert.equal(rawJob.fit_score, null);

  // Step 2: Ingest duplicate job — verify authoritative dedup
  const duplicateResult = await sendJobs({
    serverUrl: serverAddress,
    apiKey,
    jobs: [
      {
        ...FIXTURE_JOB,
        url: 'https://other-recruiter.example/job-copy-42',
      },
    ],
    fetchImpl: fetch,
  });
  assert.equal(duplicateResult.ingested, 0, 'Duplicate job content must not be ingested');
  assert.equal(duplicateResult.deduped, 1, 'Duplicate job must be deduped');
  assert.equal(duplicateResult.ids[0], jobId, 'Deduped job returns original authoritative id');

  // Step 3: Run Fit Scorer + Tailoring worker on the DB
  const pythonScript = `
import asyncio
import base64
from src.store import JobStore
from src.screener import Screener
from src.llm import StubLLM, ScoreResult
from src.artifacts import ArtifactManager
from src.tailor_bridge import TailorBridge, TailorResult
from src.worker import process_unscored_jobs

class MockTailorBridge(TailorBridge):
    async def tailor(self, job, master_resume, theme="jsonresume-theme-folio"):
        sample_pdf = b"%PDF-1.4 sample rendered resume pdf bytes"
        return TailorResult(
            resume={"basics": {"name": "Test Candidate", "label": "Staff Engineer"}},
            pdf_base64=base64.b64encode(sample_pdf).decode('utf-8'),
            theme=theme,
            plain_text="Test Candidate - Staff Engineer\\nExperience: Distributed Systems",
            status="completed",
        )

async def main():
    store = JobStore(db_path="${dbPath}")
    score_res = ScoreResult(
        score=92,
        reasoning="Strong match on distributed systems and Go/Rust",
        matching_skills=["Distributed systems", "Go", "Rust", "Kafka"],
        missing_skills=[],
    )
    llm = StubLLM(default_result=score_res)
    screener = Screener(llm_client=llm)
    artifacts = ArtifactManager(base_dir="${artifactsDir}")
    tailor = MockTailorBridge(base_url="http://mock-resume-ops")
    master_resume = {"basics": {"name": "Test Candidate"}}



    summary = await process_unscored_jobs(
        store=store,
        screener=screener,
        master_resume=master_resume,
        tailor_bridge=tailor,
        artifact_manager=artifacts,
    )
    print("WORKER_PROCESSED:", summary["processed"])
    print("WORKER_TAILORED:", summary["tailored"])

asyncio.run(main())
`;

  const workerOutput = execFileSync('uv', ['run', 'python', '-c', pythonScript], {
    cwd: SCORER_DIR,
    encoding: 'utf8',
  });
  assert.match(workerOutput, /WORKER_PROCESSED: 1/);
  assert.match(workerOutput, /WORKER_TAILORED: 1/);

  // Step 4: Verify Scorer + Tailoring artifacts & DB updates
  const scoredJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  assert.equal(scoredJob.fit_score, 92, 'Fit score must be updated');
  assert.equal(scoredJob.status, 'tailored', 'Status must transition to tailored');
  assert.ok(scoredJob.tailored_resume_id, 'Tailored resume ID must be set');

  const jobArtifactsDir = join(artifactsDir, jobId);
  assert.ok(existsSync(join(jobArtifactsDir, 'resume.json')), 'resume.json must exist');
  assert.ok(existsSync(join(jobArtifactsDir, 'resume.pdf')), 'resume.pdf must exist');
  assert.ok(existsSync(join(jobArtifactsDir, 'resume-text.txt')), 'resume-text.txt must exist');

  // Step 5: Web API Endpoints & Dashboard flow
  // 5.1 Query list of jobs
  const jobsRes = await app.inject({
    method: 'GET',
    url: '/api/v1/jobs',
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(jobsRes.statusCode, 200);
  const { jobs } = jobsRes.json();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, jobId);
  assert.equal(jobs[0].fit_score, 92);
  assert.equal(jobs[0].status, 'tailored');

  // 5.2 Query job detail
  const jobDetailRes = await app.inject({
    method: 'GET',
    url: `/api/v1/jobs/${jobId}`,
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(jobDetailRes.statusCode, 200);
  assert.equal(jobDetailRes.json().job.id, jobId);

  // 5.3 Fetch PDF artifact
  const pdfRes = await app.inject({
    method: 'GET',
    url: `/api/v1/jobs/${jobId}/artifacts/resume.pdf`,
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(pdfRes.statusCode, 200);
  assert.equal(pdfRes.headers['content-type'], 'application/pdf');
  assert.ok(pdfRes.rawPayload.length > 0, 'PDF payload must be non-empty');

  // 5.4 Fetch ATS Plain Text artifact
  const textRes = await app.inject({
    method: 'GET',
    url: `/api/v1/jobs/${jobId}/artifacts/resume-text.txt`,
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(textRes.statusCode, 200);
  assert.match(textRes.body, /Test Candidate - Staff Engineer/);

  // 5.5 Update Kanban status via PATCH
  const patchRes = await app.inject({
    method: 'PATCH',
    url: `/api/v1/jobs/${jobId}`,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    payload: { status: 'applied' },
  });
  assert.equal(patchRes.statusCode, 200);
  assert.equal(patchRes.json().job.status, 'applied');

  // 5.6 Verify persistence of status update
  const finalJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  assert.equal(finalJob.status, 'applied', 'Status must be persisted as applied');
});
