# Contributing to JobFoundry

Thank you for your interest in contributing to JobFoundry! We welcome community contributions to help improve job search workflows, provider support, and local-first tooling.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for everyone. Please be respectful, constructive, and kind in all discussions and code reviews.

---

## Architectural Invariant (Required Reading)

Before contributing code, please note the non-negotiable architectural invariant of this project:

> **The JobFoundry server never performs outbound job-board scraping. All scraping and job-board HTTP requests originate from the user's browser extension.**
>
> Anything that makes an outbound job-board request (providers, liveness checks) must live strictly within `extension/`. The ingest server and scoring workers only receive already-captured job data.

---

## Getting Started

1. **Fork and Clone** the repository:

   ```bash
   git clone https://github.com/<your-username>/JobFoundry.git
   cd JobFoundry
   ```

2. **Install Dependencies**:

   ```bash
   npm install
   ```

3. **Set Up Python Environment** (for the scorer worker):

   ```bash
   cd server/scorer
   uv sync --dev
   cd ../..
   ```

4. **Verify Your Setup**:
   ```bash
   npm test
   npm run lint
   npm run format:check
   ```

---

## Development Workflow

### Adding a New Job Board Provider

JobFoundry adheres to a **zero-token extraction philosophy**: scraping and normalizing job postings from public ATS APIs, RSS feeds, and clean HTML endpoints without requiring LLM tokens, login credentials, or heavy browser emulation whenever possible.

Job board extractors live in `extension/src/content/extractors/` and background adapters live in `extension/src/background/providers/`.

1. **Implement the Provider Contract**:
   Every background provider exports a default object matching the `Provider` interface:
   ```javascript
   export default {
     id: 'greenhouse',
     detect(entry) {
       if (entry.careers_url && /boards\.(?:eu\.)?greenhouse\.io/i.test(entry.careers_url)) {
         return { url: entry.careers_url };
       }
       return null;
     },
     async fetch(entry, ctx) {
       const json = await ctx.fetchJson(targetUrl);
       return json.jobs.map((job) => ({
         title: job.title.trim(),
         url: job.absolute_url,
         company: entry.company || job.company_name || '',
         location: job.location?.name || '',
         description: job.content ? ctx.htmlToText(job.content) : undefined,
         postedAt: job.updated_at ? Date.parse(job.updated_at) : undefined,
       }));
     },
   };
   ```
2. **SSRF Guardrails**:
   All outbound requests must go through safe HTTP helpers (`_http.mjs` / `safe-url.js`). Never bypass private IP filtering (blocking loopback, RFC 1918, CGNAT, link-local) or follow automated redirects without per-hop safety checks.
3. **In-Page DOM Extractors**:
   If adding active DOM extraction for custom job portals, add a targeted extractor in `extension/src/content/extractors/ats.js` extracting standard fields (`title`, `company`, `location`, `description`, `url`, `postedAt`).
4. **Testing**:
   Add test fixtures in `extension/test/fixtures/` and verify with `npm --workspace=extension test`.

### Coding & Formatting Standards

- **Linting**: We use ESLint flat config. Run `npm run lint` or `npm run lint:fix`.
- **Formatting**: We use Prettier. Run `npm run format` to auto-format your changes.
- **Vendored Providers**: Notice that `extension/src/background/providers/` are kept byte-identical to upstream ports to preserve hash integrity. Do not reformat vendored files.

---

## Submitting Pull Requests

1. Create a feature branch with a clear name:
   ```bash
   git checkout -b feat/my-new-feature
   ```
2. Write clean commits following conventional commit messages (e.g. `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`).
3. Ensure all tests and checks pass locally before opening a pull request:
   ```bash
   npm run lint
   npm run format:check
   npm test
   npm --workspace=extension test
   cd server/scorer && uv run pytest
   cd server/tailor && uv run pytest
   ```
4. Open a pull request against the `main` branch with a clear description of the problem solved and test steps.

Thank you for helping make JobFoundry better for everyone!
