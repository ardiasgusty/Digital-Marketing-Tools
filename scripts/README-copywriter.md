# KPI Copywriter Siska

The Report Weekly / Monthly screen includes a separate KPI Copywriter tab.
It reads the annual JSON database; it does not change Content Weekly or Content Monthly.

## Database and sync

- Database: `json/<year>/kpi-copywriter-siska-<year>.json`.
- Source: public WordPress posts assigned to author ID 8, Siska Irma Diana.
- Only published posts dated within the selected year are fetched. Pagination must succeed completely before anything is saved.
- WordPress IDs deduplicate articles. Newer revisions win; older records absent from the API remain archived. No image files are downloaded; the thumbnail URL references WordPress.
- `Tarik WordPress` updates the browser cache. `Simpan ke GitHub` persists articles and holidays using the app's existing GitHub configuration and token.
- GitHub saving reads the latest revision first. Concurrent changes produce a retry message rather than silently overwriting the file.
- `.github/workflows/sync-copywriter.yml` runs at minute 17 each hour and can be manually dispatched. It becomes active after landing on the repository's default branch with GitHub Actions enabled and permission to write contents.
- The workflow automatically chooses the current year in Asia/Jakarta, creates the annual file when needed, and commits only when article data changes. `lastSyncedAt` is the last successful article import saved to the file, not a heartbeat of unchanged scheduled runs.
- The workflow preserves holiday settings and article metadata. It needs no WordPress credentials.
- Test a local import with `node scripts/sync-copywriter.cjs`; optionally set `COPYWRITER_YEAR=2026`.

## Preview scoring

The current preview evaluates published article production only. It does not infer writing quality or give an overall Siska grade for unrecorded support duties.

- 1 article per working day, excluding Sundays and user-configured holidays. Holiday settings start empty and the UI explicitly requests configuration before using the result for evaluation.
- Full-period target and elapsed target are shown separately. Scores for an ongoing month/year use working days through today in Asia/Jakarta; future days are not counted as missing.
- Quantity: `min(actual / elapsed target, 1) * 55`.
- Schedule: `working days with at least one article / elapsed working days * 15`.
- Article points: up to 70. Article grade uses the article component's percentage with A >= 90, B >= 80, C >= 70, D >= 60, E < 60.
- More articles on one day do not fill another day's schedule. Holiday publications count toward quantity but do not fill a working day's schedule.
- No elapsed working days: ungraded.
- Article title and dates are WordPress records. They do not prove when drafting was finished; a quality review is not yet part of this preview.

Run checks with `node tests/copywriter.cjs` and `node tests/copywriter-ui.cjs`.

## Google Search Console importer (prepared, not yet connected)

- Service account: `siska-kpi-sync@honda-bintaro-252404.iam.gserviceaccount.com`.
- Grant this account access to the Honda Bintaro property in Search Console and enable Google Search Console API in its Cloud project.
- Put the complete Google JSON private key in the repository Actions secret `GSC_SERVICE_ACCOUNT_JSON`; never in the site's JSON, HTML, or browser storage.
- Set the Actions repository variable `GSC_PROPERTY` to the exact GSC property identifier, e.g. `sc-domain:honda-bintaro.com` or `https://www.honda-bintaro.com/`.
- Existing application GitHub PAT is for manual JSON saving only. Scheduled jobs use GitHub's own `GITHUB_TOKEN`, not an exposed site token. Google access requires Google credentials independently.
- The workflow skips GSC until both settings exist. The importer uses Google's authentication library with read-only scope and writes `json/<year>/kpi-copywriter-siska-gsc-<year>.json` separately from the article database.
- Metrics cover web search per page and month, using finalized data up to three days before today in Pacific time. They do not use WordPress's publication timezone.
- Queries paginate and all months must succeed before the GSC JSON is replaced. Missing page rows are `null`, not fabricated zero impressions or clicks. Search Console's own top-row limitations still apply.
- The UI reads the separate GSC database and shows per-article metrics and a period summary. CTR is recomputed from total clicks/impressions; average position is weighted by impressions. Missing rows remain unavailable, not zero. Live access validation is pending deployment and Google credentials in Actions. No real performance metrics have been imported yet.
- Offline importer tests: `python3 tests/copywriter-gsc.py`.
