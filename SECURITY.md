# Security Policy

## Supported Versions

JobFoundry is an open-source project actively maintained on GitHub. We provide security patches and updates for the latest release on the `main` branch.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| < 0.1.0 | :x:                |

---

## Reporting a Vulnerability

If you discover a potential security vulnerability in JobFoundry, please help us protect user privacy by reporting it responsibly.

### How to Report

- **Email**: Send vulnerability details to [security@covai.org](mailto:security@covai.org).
- **GitHub Advisory**: Alternatively, you may open a [Private Security Advisory](https://github.com/deadrat-in/JobFoundry/security/advisories/new) directly on GitHub.

Please include:

1. A clear description of the vulnerability and affected components (extension, ingest API, scorer service, or web UI).
2. Step-by-step reproduction steps or Proof of Concept (PoC).
3. Potential impact or severity assessment.

We will review your submission promptly and coordinate a fix and advisory.

---

## Local-First Security & Privacy Guarantees

- **No Remote Telemetry**: JobFoundry stores all resumes, job records, and tailoring artifacts locally on your machine or private server instance.
- **Architectural Isolation**: The server never makes outbound scraping requests to job boards. All job-board browsing and extraction happens within your local browser context.
- **API Key Confidentiality**: LLM API keys configured in `.env` or user settings remain strictly on your local backend server and are never exposed to browser extensions or third parties.
