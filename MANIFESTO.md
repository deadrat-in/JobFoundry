# The JobFoundry Manifesto

_Why this tool exists, and who it is for._

## 1. Job hunting is hard enough. The tooling should not make it harder.

Losing a job — or never having had a fair shot at one — is one of the most
stressful things a person goes through. The software that is supposed to help
too often adds new barriers: accounts to create, subscriptions to pay,
prompts to engineer, CLIs to learn, servers to operate.

**JobFoundry meets people where they already are: the browser.** If you can
browse job sites, you can use JobFoundry. No AI coding assistant required,
no terminal required, no prompt skills to install. Read the quickstart,
install the app, add the extension, and keep browsing like you always have.
The tool does the tedious parts — capture, dedup, scoring, tailoring,
tracking — quietly, locally, under your control.

## 2. Your career data belongs to you. Entirely.

Your resume is your life on paper. Your applications, scores, and tailored
variants are nobody's training data, nobody's analytics funnel, nobody's
asset. JobFoundry stores everything on your machine, phones home to nobody,
and works fully offline except for the LLM provider _you_ choose. Local-first
is not a feature here. It is the premise.

## 3. Reading a public job posting should never cost an LLM call.

This is our zero-token philosophy: structured data comes from public ATS
endpoints, feeds, and markup — free, fast, private. Models are spent only
where judgment is actually needed: scoring fit and tailoring resumes. A
jobseeker without an AI subscription gets the same discovery pipeline as
everyone else.

## 4. Scrape from where the jobs are visible: the browser.

Server scrapers lose to Cloudflare, CAPTCHAs, login walls, and IP blocks
every day. Your browser session — your cookies, your context, your humanity
as far as the site is concerned — walks straight through. So JobFoundry
captures listings inside your browser, and the server never touches a job
board. This is a reliability decision first (it succeeds more often) and a
privacy decision second (your session never leaves your machine).

## 5. A tailored resume must be true.

Generative tools that invent employers, skills, and metrics don't help
candidates — they set them up to fail background checks and interviews.
JobFoundry re-ranks and rephrases _your genuine experience_ under strict
schema constraints, with protected fields that can never change. Truth over
fabrication, always.

## 6. The human applies. The tool prepares.

JobFoundry evaluates, drafts, organizes, and reminds. It never auto-submits,
never spams employers, never games an ATS in ways that would embarrass you
in an interview. Fewer, better, honest applications beat spray-and-pray —
for candidates and for recruiters alike.

## 7. Free software, forever.

JobFoundry is AGPL-3.0. You can inspect every line, self-host it, fork it,
and leave with your data at any time. Tools for vulnerable moments in
people's lives must not be allowed to become traps.

---

_This manifesto is aspirational, not a contract — but every architectural
decision in [ARCHITECTURE.md](ARCHITECTURE.md) traces back to one of these
points. When a design choice and this document disagree, open an issue:_
_either the design or the document needs to change, and the discussion is_
_worth having in public._
