import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCAN_ALARM_NAME, processDiscoveredJobs } from '../src/entrypoints/background.ts';

test('SCAN_ALARM_NAME is defined', () => {
  assert.equal(SCAN_ALARM_NAME, 'jobfoundry-periodic-scan');
});

test('processDiscoveredJobs handles empty array cleanly', async () => {
  const result = await processDiscoveredJobs({ rawJobs: [] });
  assert.deepEqual(result, { ok: true, ingested: 0 });
});

test('processDiscoveredJobs validates required jobs array', async () => {
  const result = await processDiscoveredJobs({ rawJobs: null });
  assert.deepEqual(result, { ok: true, ingested: 0 });
});
