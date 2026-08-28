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

Job board extractors live in `extension/src/content/extractors/` and background adapters live in `extension/src/background/providers/`.

1. Create or update the provider adapter.
2. If adding active DOM extraction, ensure it extracts standard job fields (`title`, `company`, `location`, `description`, `url`, `postedAt`).
3. Add unit test fixtures in `extension/test/fixtures/content/` and matching tests in `extension/test/`.
4. Run `npm --workspace=extension test` to ensure tests pass.

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
   cd server/scorer && uv run pytest
   ```
4. Open a pull request against the `main` branch with a clear description of the problem solved and test steps.

Thank you for helping make JobFoundry better for everyone!
