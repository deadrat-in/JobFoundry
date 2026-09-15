import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function runNode(args) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: resolve(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolveProcess({ code, stdout, stderr }));
  });
}

test('career-ops import infers sources only from exact domains and their subdomains', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'jobfoundry-career-ops-'));
  const pipelinePath = join(tempRoot, 'pipeline.md');
  const receivedBodies = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      receivedBodies.push(JSON.parse(body));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ingested: 8, deduped: 0, ids: [] }));
    });
  });

  await writeFile(
    pipelinePath,
    [
      '- [ ] https://boards.greenhouse.io/acme/jobs/1 | Acme | Engineer | Remote',
      '- [ ] https://greenhouse.io.evil.example/jobs/2 | Evil | Engineer | Remote',
      '- [ ] https://jobs.lever.co/acme/3 | Acme | Engineer | Remote',
      '- [ ] https://lever.co.attacker.example/4 | Evil | Engineer | Remote',
      '- [ ] https://jobs.ashbyhq.com/acme/5 | Acme | Engineer | Remote',
      '- [ ] https://careers.workday.com/acme/6 | Acme | Engineer | Remote',
      '- [ ] https://acme.myworkdayjobs.com/jobs/7 | Acme | Engineer | Remote',
      '- [ ] https://evil.example/?redirect=ashbyhq.com | Evil | Engineer | Remote',
    ].join('\n'),
    'utf8'
  );

  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const result = await runNode([
      'scripts/import-career-ops.mjs',
      '--from',
      pipelinePath,
      '--server',
      `http://127.0.0.1:${address.port}`,
      '--key',
      'test-key',
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(receivedBodies.length, 1);
    assert.deepEqual(
      receivedBodies[0].jobs.map((job) => job.source),
      [
        'greenhouse',
        'career-ops',
        'lever',
        'career-ops',
        'ashby',
        'workday',
        'workday',
        'career-ops',
      ]
    );
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(tempRoot, { recursive: true, force: true });
  }
});
