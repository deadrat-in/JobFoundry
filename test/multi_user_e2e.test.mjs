import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../server/ingest/src/db/index.mjs';
import { buildApp } from '../server/ingest/src/app.mjs';
import { sendJobs } from '../extension/src/shared/ingest-client.js';

const ROOT = resolve(import.meta.dirname, '..');
const SCORER_DIR = resolve(ROOT, 'server/scorer');

const BACKEND_JOB = {
  title: 'Staff Distributed Systems Engineer',
  company: 'FoundryTech',
  location: 'San Francisco, CA (Remote)',
  url: 'https://foundrytech.example/careers/backend-eng-42',
  source: 'greenhouse',
  postedAt: '2026-08-18T10:00:00Z',
  description:
    'Design high-throughput stream processing pipelines. Requirements: Go, Rust, Distributed consensus (Raft/Paxos), Kafka, and SQLite internals.',
};

const FRONTEND_JOB = {
  title: 'Senior Frontend React Architect',
  company: 'WebPulse UI',
  location: 'New York, NY',
  url: 'https://webpulse.example/careers/frontend-lead-88',
  source: 'lever',
  postedAt: '2026-08-18T11:00:00Z',
  description:
    'Build next-gen web applications and design systems. Requirements: React 19, TypeScript, TailwindCSS, State management, Microfrontends.',
};

const ALICE_RESUME = {
  basics: {
    name: 'Alice Backend',
    label: 'Staff Distributed Systems Architect',
    email: 'alice@example.com',
    summary: 'Expert in Go, Rust, Raft consensus, Kafka, and stream processing.',
  },
  skills: [{ name: 'Distributed Systems', keywords: ['Go', 'Rust', 'Kafka', 'Raft'] }],
  work: [{ name: 'CloudScale', position: 'Staff Engineer', startDate: '2020-01-01' }],
};

const BOB_RESUME = {
  basics: {
    name: 'Bob Frontend',
    label: 'Principal React Engineer',
    email: 'bob@example.com',
    summary: 'Specialist in modern React, TypeScript, and UI design systems.',
  },
  skills: [{ name: 'Frontend', keywords: ['React', 'TypeScript', 'TailwindCSS'] }],
  work: [{ name: 'DesignWorks', position: 'Lead UI Engineer', startDate: '2021-01-01' }],
};

test('Multi-User End-to-End: Register → Upload JSON Resume → Multi-User Ingest → Scorer Worker → Isolated Feeds & Artifacts', async (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'jf-multi-user-e2e-'));
  const dbPath = join(tmpDir, 'test-multi-user.db');
  const artifactsDir = join(tmpDir, 'artifacts');

  const db = openDb({ path: dbPath });
  const app = buildApp({ db, jwtSecret: 'e2e-jwt-secret-999', artifactsDir });
  const serverAddress = await app.listen({ port: 0, host: '127.0.0.1' });

  t.after(async () => {
    await app.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Step 1: Register Alice & Bob
  const regAliceRes = await fetch(`${serverAddress}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@example.com', password: 'password123', name: 'Alice' }),
  });
  assert.equal(regAliceRes.status, 201);
  const aliceData = await regAliceRes.json();
  const aliceToken = aliceData.token;
  const aliceApiKey = aliceData.user.apiKey;

  const regBobRes = await fetch(`${serverAddress}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bob@example.com', password: 'password123', name: 'Bob' }),
  });
  assert.equal(regBobRes.status, 201);
  const bobData = await regBobRes.json();
  const bobToken = bobData.token;
  const bobApiKey = bobData.user.apiKey;

  // Step 2: Alice and Bob upload their respective Master JSON Resumes
  const aliceResumeRes = await fetch(`${serverAddress}/api/v1/resumes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aliceToken}`,
    },
    body: JSON.stringify({ title: 'Alice Backend Master', resumeJson: ALICE_RESUME }),
  });
  assert.equal(aliceResumeRes.status, 201);

  const bobResumeRes = await fetch(`${serverAddress}/api/v1/resumes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bobToken}`,
    },
    body: JSON.stringify({ title: 'Bob Frontend Master', resumeJson: BOB_RESUME }),
  });
  assert.equal(bobResumeRes.status, 201);

  // Step 3: Alice ingests both Backend and Frontend jobs via her browser extension API key
  const aliceIngest = await sendJobs({
    serverUrl: serverAddress,
    apiKey: aliceApiKey,
    jobs: [BACKEND_JOB, FRONTEND_JOB],
    fetchImpl: fetch,
  });
  assert.equal(aliceIngest.ingested, 2);

  // Bob ingests the Frontend job via his browser extension API key
  const bobIngest = await sendJobs({
    serverUrl: serverAddress,
    apiKey: bobApiKey,
    jobs: [FRONTEND_JOB],
    fetchImpl: fetch,
  });
  assert.equal(bobIngest.deduped, 1, 'Frontend job is globally deduplicated in jobs catalog');

  // Step 4: Run Scorer + Tailoring worker on the multi-user DB
  const pythonScript = `
import asyncio
import base64
from src.store import JobStore
from src.screener import Screener
from src.llm import LLMClient, ScoreResult
from src.artifacts import ArtifactManager
from src.tailor_bridge import TailorBridge, TailorResult
from src.worker import process_unscored_jobs

class E2ELLM(LLMClient):
    async def score(self, job: dict, resume: dict) -> ScoreResult:
        candidate = resume.get("basics", {}).get("name", "")
        desc = job.get("description", "")
        if "Alice" in candidate and "Go" in desc:
            return ScoreResult(score=96, reasoning="Perfect backend match", matching_skills=["Go", "Raft"], missing_skills=[])
        elif "Bob" in candidate and "React" in desc:
            return ScoreResult(score=94, reasoning="Perfect frontend match", matching_skills=["React", "TypeScript"], missing_skills=[])
        else:
            return ScoreResult(score=35, reasoning="Mismatch in tech stack", matching_skills=[], missing_skills=["Required skill"])

class MockTailorBridge(TailorBridge):
    async def tailor(self, job, master_resume, theme="jsonresume-theme-folio"):
        sample_pdf = b"%PDF-1.4 Tailored Resume for " + master_resume["basics"]["name"].encode()
        return TailorResult(
            resume=master_resume,
            pdf_base64=base64.b64encode(sample_pdf).decode('utf-8'),
            theme=theme,
            plain_text="ATS Plain Text for " + master_resume["basics"]["name"],
            status="completed",
        )

async def main():
    store = JobStore(db_path="${dbPath}", threshold=75)
    llm = E2ELLM()
    screener = Screener(llm_client=llm)
    artifacts = ArtifactManager(base_dir="${artifactsDir}")
    tailor = MockTailorBridge(base_url="http://mock-tailor")

    summary = await process_unscored_jobs(
        store=store,
        screener=screener,
        tailor_bridge=tailor,
        artifact_manager=artifacts,
    )
    print("PROCESSED:", summary["processed"])
    print("TAILORED:", summary["tailored"])

asyncio.run(main())
`;

  const workerOutput = execFileSync('uv', ['run', 'python', '-c', pythonScript], {
    cwd: SCORER_DIR,
    encoding: 'utf8',
  });
  assert.match(workerOutput, /PROCESSED: 3/);
  assert.match(workerOutput, /TAILORED: 2/); // Alice Backend & Bob Frontend

  // Step 5: Verify Alice's Jobs
  const aliceJobsRes = await fetch(`${serverAddress}/api/v1/jobs`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  const aliceJobs = (await aliceJobsRes.json()).jobs;
  assert.equal(aliceJobs.length, 2);

  const aliceBackend = aliceJobs.find((j) => j.title.includes('Distributed'));
  assert.equal(aliceBackend.fit_score, 96);
  assert.equal(aliceBackend.status, 'tailored');

  const aliceFrontend = aliceJobs.find((j) => j.title.includes('Frontend'));
  assert.equal(aliceFrontend.fit_score, 35);
  assert.equal(aliceFrontend.status, 'rejected_by_score');

  // Step 6: Verify Bob's Jobs
  const bobJobsRes = await fetch(`${serverAddress}/api/v1/jobs`, {
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  const bobJobs = (await bobJobsRes.json()).jobs;
  assert.equal(bobJobs.length, 1);
  assert.equal(bobJobs[0].title, FRONTEND_JOB.title);
  assert.equal(bobJobs[0].fit_score, 94);
  assert.equal(bobJobs[0].status, 'tailored');

  // Step 7: Verify isolated artifact downloads
  const alicePdfRes = await fetch(
    `${serverAddress}/api/v1/jobs/${aliceBackend.id}/artifacts/resume.pdf`,
    { headers: { Authorization: `Bearer ${aliceToken}` } }
  );
  assert.equal(alicePdfRes.status, 200);
  const alicePdfText = await alicePdfRes.text();
  assert.ok(alicePdfText.includes('Alice Backend'));

  const bobPdfRes = await fetch(
    `${serverAddress}/api/v1/jobs/${bobJobs[0].id}/artifacts/resume.pdf`,
    { headers: { Authorization: `Bearer ${bobToken}` } }
  );
  assert.equal(bobPdfRes.status, 200);
  const bobPdfText = await bobPdfRes.text();
  assert.ok(bobPdfText.includes('Bob Frontend'));
});
