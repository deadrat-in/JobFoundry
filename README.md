# JobFoundry

A unified, AGPL-licensed pipeline for job search → fit scoring → resume tailoring → PDF/ATS export, with a modern web dashboard. Built from scratch; MIT-licensed components lifted from `career-ops` and `jobs-auto-apply` where compatible.

> **Architectural invariant (non-negotiable):**
> The JobFoundry server never performs outbound job-board scraping. All scraping and job-board HTTP requests originate from the user's browser extension.
>
> Corollary: anything that makes an outbound job-board request (providers, liveness checks) lives in the extension. The server only receives already-scraped jobs, and its only outbound calls are to LLM providers (fit scoring / tailoring) and the local resume-ops API.

## Repo layout

```
extension/        Browser extension (Chrome / Firefox / Firefox for Android)
server/
  ingest/         Node/ESM ingest API + SQLite + dedup
  scorer/         Python fit screener + tailoring bridge
  web/            Vite + React dashboard
compose.yaml      Single compose stack
```

## Execution plan

Every phase of this project is planned atomically (test-first, with acceptance criteria) in [`Scratch/plan/`](Scratch/plan/README.md). Read [`Scratch/plan/README.md`](Scratch/plan/README.md) first for the phase index and dependency graph, and [`Scratch/plan/TESTING.md`](Scratch/plan/TESTING.md) for test conventions.

## License

[GNU Affero General Public License v3.0](LICENSE)
