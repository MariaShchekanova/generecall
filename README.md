# GeneRecall

A personal genetic report follow-up workspace. Paste a report excerpt, confirm the exact ClinVar variant, review public evidence, and prepare an editable request to the original testing laboratory.

Read the [GeneRecall Product Overview](GeneRecall-Product-Overview.docx) for the need, solution, product workflow, demo, current limitations, and teammate setup in an editable Word document.

## Run locally

Requires Node.js 22 or later. No dependencies or package installation.

```sh
git clone https://github.com/MariaShchekanova/generecall.git
cd generecall
```

```sh
npm start
```

On macOS, the portable `Start GeneRecall.command` launcher starts the app from this folder. On Windows use `Start GeneRecall.cmd`. The terminal command above works on all supported platforms.

Read **PRODUCT-BRIEF.txt** for the need, target user, solution, pitch, and product priorities. Read **HANDOFF.txt** for the architecture, privacy boundaries, teammate workflow, and current limitations.

Open http://127.0.0.1:4317. Optional configuration lives in the ignored `.env.local`: `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5-mini`), and `PORT` (default 4317). The supplied `.env.example` contains names only. Never commit a key.

## Demo in 60 seconds

1. Click **Open demo case**. The prior report is fictional; the dated ClinVar snapshot is real.
2. Explain the difference between the report's uncertain-significance label and the public aggregate's pathogenic label. This is a difference between sources, not proof of historical reclassification.
3. Click **Refresh evidence** to fetch the exact variant from NCBI. The view clearly labels a successful live lookup or a dated same-variant fallback.
4. Click **Open my follow-up**. Edit, copy, download, or print the source-backed administrative request.

The application also accepts pasted report excerpts or `.txt` files up to 40,000 characters. PDF extraction is outside this MVP.

## AI and evidence

Optional OpenAI Responses API extraction uses a strict JSON schema and `store:false`. Source quotations are verified against the submitted excerpt. Provider failures fall back visibly to conservative labelled-field parsing. Comparisons, exact-ID checks, and letter assembly use explicit application logic. A configured key does not guarantee available API credits.

Reports are not written to a database, saved in localStorage, or logged by the app. Requests are processed in server memory; if AI is enabled, the excerpt is sent to OpenAI. Public evidence comes from NCBI ClinVar. Hosting and provider infrastructure can have their own operational logs and policies.

ClinVar aggregates submissions. Differences, missing classifications, conflicting submissions, or identifier mismatches require professional review. GeneRecall does not diagnose, determine risk, recommend treatment, or send correspondence.

## Checks and build

```sh
npm test
npm run build
```

The tests cover evidence rules, request validation, provider failures, and frontend state regressions. The build produces a dependency-free Cloudflare Worker in `dist/server/index.js` and copies a Sites hosting manifest only if present. It includes public demo evidence, never `.env.local`. The teammate archive excludes the original account's hosting identity and credentials; it runs and builds without them.

For local development, restart the server after changing engine/router code or environment values. Refresh the browser after editing the HTML. A localhost link is available only on the computer running the app.

## Sources

- https://www.ncbi.nlm.nih.gov/clinvar/variation/65533/
- https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/
- https://www.clinicalgenome.org/genomeconnect/how-to-search-clinvar/
- https://developers.openai.com/api/docs/guides/structured-outputs
