# Steam Desk

Steam Desk is an interactive dashboard for exploring a locally cached SteamSpy market snapshot. It presents 20,000 games with analytics and visualizations built from a reproducible set of downloaded source pages.

## Requirements

- Node.js 22.13 or newer
- npm

## Local setup

```sh
npm ci
copy .env.example .env.local
npm run dev
```

On macOS or Linux, use `cp .env.example .env.local` instead of `copy`.

`SITE_ORIGIN` controls the absolute base URL used in social-sharing metadata. Update it in `.env.local` when running from a different origin.

## Commands

- `npm run dev` starts the local development server.
- `npm run build` creates a production build.
- `npm run start` serves the production build.
- `npm run lint` checks the source with ESLint.
- `npm run steamspy:download` downloads resumable SteamSpy source pages.
- `npm run steamspy:build-static` rebuilds the checked-in application snapshot from downloaded pages.

## Site tools

Steam Desk registers three narrowly scoped WebMCP tools on the top-level page:

- `describe_steamspy_snapshot` returns schema and capability metadata only.
- `create_report` executes and saves a report, then returns a compact receipt containing its ID, mode, row count, and browser state.
- `render_report` reloads a saved report and returns either bounded Markdown or a static PNG. Its `auto` mode selects PNG for chart and mixed reports and Markdown otherwise.

`render_report` never returns raw rows or a Plotly presentation payload in structured content. Markdown output is capped at 20 rows and 8 columns. Image mode is available only for chart and mixed reports.

Creation errors use stable codes with a `retryable` flag. Invalid presentation, data, result-field, report-ID, lookup, and render-mode errors are not retryable; unexpected execution and image-rendering failures are retryable.

## Data workflow

Raw SteamSpy downloads are stored under `data/steamspy/raw/` and intentionally excluded from Git. The compact application snapshot at `public/data/steamspy-snapshot.json` is checked in so builds do not depend on a live third-party request. The browser fetches this cacheable asset once at runtime, keeping the 20,000 records out of the initial JavaScript bundle.

To refresh the snapshot:

```powershell
npm run steamspy:download -- --snapshot YYYY-MM-DD
$env:STEAMSPY_SNAPSHOT = "YYYY-MM-DD"
npm run steamspy:build-static
```

The download script respects SteamSpy's request limit and can resume an interrupted run. On macOS or Linux, set the environment variable with `export STEAMSPY_SNAPSHOT=YYYY-MM-DD`.

## Repository notes

- Local environment files are ignored; `.env.example` is the safe template to commit.
- Build output, framework caches, dependencies, and raw source downloads are ignored.
- `.openai/hosting.json` contains the Sites project configuration used for deployment.
