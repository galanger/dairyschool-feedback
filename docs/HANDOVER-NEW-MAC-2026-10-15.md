# Handover for the new Mac — Dairy School feedback survey

Written 15 Oct 2026 (Israel time) on the Mac that is being retired. A fresh Claude Code session on the
new Mac has none of the old context: this file plus the private bundle (hand-carried, §7) are everything
needed to continue exactly where the work stopped.

## 1. How Gal works with Claude (keep these)

- Answer first, then do the asked action; short replies; one-line caveats. No "shall I…?" questions: do
  everything that can be verified, then list only what truly needs Gal.
- Push yourself: run `git push` and routine publish steps directly; never hand Gal a command to type.
- A status question ("any news?") is not a go-ahead for changes: check read-only, report, change things
  only when asked.
- Private data never reaches git (the repo is public). `private/` is git-ignored; participant names and
  passport numbers are never committed; the seminar id, guide key, staff passcode, Sheet id and script id
  stay out of the repo (environment variables and arguments; the values are in the bundle's README).
  Audit before every push: grep the files to be committed against the surnames in
  `private/uvt-2026-names.csv` and `private/rooming-list.txt`, and against the ids and keys.
- Nothing may delete real answers. The only deletion path is the backend's `deleteSeminar` (staff
  passcode), and it refuses any id that does not contain "test" or equal "sample".
- A closed survey is never reopened. A live survey is never filled in, and never walked in a way that
  could send an answer.
- Never show invented results without saying "local demo" first (it alarmed Gal once).
- Never run "First setup" again in the Sheet: it would recreate an open "sample" seminar.
- Work inline with targeted reads; no agent fan-outs unless asked (token budget).

## 2. What exists

**Site.** Static pages in `site/`, published by `.github/workflows/pages.yml` on every push to `main`
of the public repo `galanger/dairyschool-feedback` → https://galanger.github.io/dairyschool-feedback/
(Pages source = GitHub Actions). `index.html` participants (`?s=<id>`), `guide.html`
(`?s=<id>#<guide key>`), `staff.html` (passcode). `site/config.js` holds the backend `/exec` URL, the
public URL and the two review links. Numbers on the staff page and in the PDF report both come from
`site/assets/js/analytics.js`.

**Backend.** `backend/Code.gs` is a Google Apps Script bound to a Google Sheet in Gal's own Gmail
account (not the school's). Live as web app deployment @8, byte-identical to the repo. To update:
`cd backend && clasp push -f && clasp deploy -i <deployment id>` (the deployment id is the `AKfy…`
part of the exec URL; the URL stays the same). `backend/.clasp.json` (git-ignored, in the bundle) binds
clasp to the script. `clasp create` would overwrite `appsscript.json`; restore it from git if that
ever happens.

**Sheet tabs.** `Seminars` (id, titles, dates, languages, status, guide_key, report_name, invited),
`<id> · Items`, `<id> · Names`, `<id> · Answers` (for the UVT seminar 68 columns: id, 32 ratings,
32 comments, the two closing answers, `Sent (Israel time)`), `template · Items`, `Sheet1` (empty).
Backups: while a survey is open an hourly trigger emails a CSV for every hour that brought new
answers; closing adds a dated copy tab and emails a CSV; both go to the backup address (by default the
Sheet owner). The Sheet's own time zone is US Pacific; everything shown to people is Israel time.

**Tools** (`tools/`):

| Tool | What it does |
|---|---|
| `status.sh` | read-only live status: who answered, who is missing, when each answer was sent |
| `export-sheet.mjs` | read-only copy of the whole Sheet as JSON (Drive export through clasp's sign-in) |
| `report-untranslated.mjs` | lists comment/closing texts that have no English entry in the translations map |
| `report-pdf.mjs` | the owner's report PDF: "Interim report" while open, "Final report" once closed |
| `verify-report.mjs`, `validate-report.py` | two independent checkers of a built report (JS and Python) |
| `save-draft.mjs` | write or rewrite a draft seminar from a spec + names file (prints the three links) |
| `remove-test-seminar.mjs` | delete a test seminar (ids containing "test", or "sample", only) |
| `paper-questionnaire.mjs` | paper backup PDF of a questionnaire |
| `build-prototype.mjs` | single-file prototype bundle |

**Tests** (`tests/`): `npm test` = 50 unit + backend tests (Code.gs against a fake Sheet). The browser
suites (`tests/run-all.sh`, `e2e.mjs`, `e2e-more.mjs`, `e2e-live.mjs`) need a copy of the site with
`backendUrl: null` (prototype mode) because `site/config.js` points at production.
`tests/live-real-check.mjs` walks the real links read-only. `tests/live-backend.mjs` and
`tests/live-dryrun.mjs` SEND answers and CLOSE a seminar: only ever on a test copy (id containing
"test"), never on the real one.

## 3. Where things stand (15 Oct 2026, 12:15 Israel time)

- The UVT Ukraine group's seminar (4–11 Oct 2026; 32 questions on 8 pages; 20 names; id in the bundle's
  README) has been OPEN since 11 Oct 13:44 Israel time. 15 of 20 have answered; the last answer came on
  13 Oct at 13:20 and nothing since. Five are missing (`status.sh` lists them; so does the bundle's
  README).
- The staff have not closed the survey. Results on `staff.html` unlock only after the close (by design:
  no answers visible while names could still be matched). The owner, Ofier Langer, has the staff link
  and passcode from Gal.
- Interim report v2 for the owner, built 13 Oct 14:18 with all 15 answers:
  `private/UVT-2026-feedback-interim-report-2026-10-13-1418.pdf` (6 A4 pages; the same bytes were
  delivered to Gal's Downloads as `UVT-2026-feedback-interim-report.pdf`). Verified by both checkers
  (119/119 and 142/142) and page by page by eye. Headline: overall 7.0 (100%), would recommend 7.0
  (100%), program average 6.9 (98%), no item below 80%, 75 comments + 30 closing answers, all
  hand-translated.
- Paper backup questionnaire: `private/UVT-2026-questionnaire-paper-backup.pdf` (4 A4 pages).
- Git: `main` = `origin/main` = the live site; backend @8 = repo; working tree clean after the handover
  commit. The last code change before the handover was the report tooling (commits 5bb399d, 1533f8a).

**Update, 15 Oct afternoon (from the owner's group chat; names and message texts are in the bundle's README):**

- One participant says she answered on day one but is not marked as answered. Her name has no answer on
  the server. The code allows three causes: she never reached the final Send (only Send counts, and the
  page then says "Thank you"); she pressed Send in the first minutes while the survey was still in
  preview (the page then said "Not sent yet" and kept her answers on the phone); or she tapped someone
  else's name (then her answers are in, under that name, and her phone says "You have already answered").
  The owner was given a message asking her to reopen the link from the same chat on the same phone and
  finish, or to report what the phone says. If it says "already answered", find out which name she
  tapped and use the guide page's "fix a wrong tap" (mark her as answered, free the other name). Never
  let her answer a second time.
- One person on the list was not on the trip, and the person who came instead is not on the list. Gal
  does not want anyone removed: add the replacement with the guide page's "add a name" (or the backend
  `addName` action with the guide key) when Gal says go, and leave the absent person as a permanent
  "missing". The list then has 21 names. For the report the total must stay 20 (the people who were
  there): set the `invited` cell of the seminar's row in the `Seminars` tab to 20 by hand before building
  (the report uses that cell whenever it is set), and set it to 20 again after the close, because the
  close overwrites it with the names count.
- Another participant is said to be unwilling to answer, so the realistic maximum is 19 of 20.

## 4. What comes next

1. First, if it was not done on the old Mac: add the replacement name when Gal says go (§3 update), and
   check whether the participant from the chat has answered since.
2. "Any news?" from Gal → run `status.sh` (read-only) and reply with: answered count, any new names with
   their times, who is still missing, the last reply time, and whether the staff have closed.
3. New answers → refresh the interim report (§5.3), replace the PDF in Downloads, `open -R` it.
4. The staff close (from `staff.html` with the passcode, or the Sheet menu) → build the final report
   with the same recipe; the tool prints "Final report" when `Seminars.status` is `closed`, and the
   invited count comes from `Seminars.invited`, which the close writes before deleting the names. The
   staff page then also shows Google's machine translations (Comments tab, finished by a background
   trigger); the PDF uses our hand translations.
5. Extras Gal may ask for: an insights memo for the owner; a nicer address
   `feedback.dairyschool.co.il` (one CNAME at the school's DNS on QUIC.cloud + a Pages custom domain);
   moving the Sheet and script to the school's own Google account (README → Deploy).
6. After the seminar's wrap-up Gal wanted the clasp access revoked (`clasp logout`, then remove the app
   under the Google account's third-party access). Not before the final report is delivered.

## 5. Recipes

### 5.1 Set up the new Mac

```sh
git clone https://github.com/galanger/dairyschool-feedback.git ~/dairyschool-feedback
cd ~/dairyschool-feedback && npm install
brew install poppler                 # pdftotext, pdfinfo, pdffonts, pdftoppm for the report checks
npm install -g @google/clasp         # only needed for backend changes
gh auth login                        # account galanger: pushes and Pages run checks
```

On a brand-new Mac run `xcode-select --install` first (git, python3). After `gh auth login` run
`gh auth setup-git`, so `git push` over https uses that login; if the browser login is not possible, the
bundle's README holds a token for `gh auth login --with-token`. The Google side needs no local secret
beyond `clasprc.json`: the Sheet and the Apps Script editor open in the browser with Gal's Gmail account.
Also needed: Google Chrome (Playwright launches `channel: 'chrome'`), Node 20 or newer, python3.
Then copy from the private bundle: `private/` → `~/dairyschool-feedback/private/`, `clasp.json` →
`~/dairyschool-feedback/backend/.clasp.json`, `clasprc.json` → `~/.clasprc.json`, `demo-2023.local.js`
→ `site/assets/js/`. Put the exports from the bundle's README in the shell (`SEMINAR`, `GUIDEKEY`,
`SHEET`, `PASSCODE`). If commits fail with "Author identity unknown", set `git config --global
user.name` and `user.email`.

Check: `npm test` → 50 passing; `bash tools/status.sh` (with the exports) → the live count.

### 5.2 Status (read-only)

`SEMINAR=… GUIDEKEY=… SHEET=… bash tools/status.sh` prints the time in Israel, the status, answered
of total, the missing and done names (Latin + Cyrillic), every "Sent" time and the last one. Nothing is
written; the exported copy is deleted on exit. Without `SHEET` only the progress part runs.

### 5.3 Refresh the interim report, or build the final one

```sh
cd ~/dairyschool-feedback
cp private/uvt-2026-export.json private/uvt-2026-export-$(date +%Y-%m-%d-%H%M).json   # keep the previous export
SHEET=… node tools/export-sheet.mjs private/uvt-2026-export.json
node tools/report-untranslated.mjs private/uvt-2026-export.json $SEMINAR private/uvt-2026-translations.json
#   → add an English entry for each listed text to private/uvt-2026-translations.json (key = the exact trimmed original)
#   → recount the "suggestions" sentence in private/uvt-2026-report-notes.json from the "What could we do better?" answers
node tools/report-pdf.mjs private/uvt-2026-export.json $SEMINAR /tmp/report.pdf \
  --translations private/uvt-2026-translations.json --notes private/uvt-2026-report-notes.json --html /tmp/report.html
node tools/verify-report.mjs private/uvt-2026-export.json $SEMINAR private/uvt-2026-translations.json /tmp/report.html /tmp/report.pdf
python3 -I tools/validate-report.py private/uvt-2026-export.json $SEMINAR private/uvt-2026-translations.json /tmp/report.html /tmp/report.pdf
pdftoppm -r 100 -png /tmp/report.pdf /tmp/pg       # then look at every page
cp /tmp/report.pdf ~/Downloads/UVT-2026-feedback-interim-report.pdf    # "…-final-report.pdf" once closed
cp /tmp/report.pdf private/UVT-2026-feedback-interim-report-$(date +%Y-%m-%d-%H%M).pdf
```

Translation conventions: British spelling ("organisation"), keep the writer's voice and emoji, a
Ukrainian ")" smiley becomes " :)", one entry per distinct original text, lecturers' and hosts' names
stay (Katya Mulyavin, Yoel Strauss…), the interpreter is "Hlib". The PDF prints "(not translated)" for
any text missing from the map and both checkers fail on it.

Report structure (interim and final alike): page 1 summary (status box, four tiles, ratings bar, key
points, caution line), page 2 every question in program order, page 3 areas + the perfect-7 list + the
lower-end list with quotes from people who rated that item 5 or less, page 4 the two closing questions,
pages 5–6 every comment with the writer's rating badge. The owner is not a data person: averages and
percentages only, no deviations.

### 5.4 Backend change

Edit `backend/Code.gs`, `npm test`, then `cd backend && clasp push -f && clasp deploy -i <deployment id>`.
Confirm with a read-only call such as `curl -sL "<exec>?action=config&s=$SEMINAR"`. Deployment @8 is live.

### 5.5 Site change

Edit `site/`, `npm test`, push; the Pages workflow deploys (`gh run list --limit 3`). Compare the live
files with the repo (`curl` each changed file) before telling Gal it is live.

## 6. Pitfalls learned

- Google's reply hop is sometimes slow or lost (10–90 s, 404 or an empty redirect): `api.js` retries
  twice on LOST/SERVER/NETWORK, the close call waits 120 s, nothing is lost or counted twice. Give
  read-only scripts long timeouts and retry once before concluding anything.
- Playwright scripts must run with the project as the working directory (module resolution). The
  harness copy used for prototype suites needs its own `config.js` with `backendUrl: null`.
- `pdftotext -layout` lays the four tiles side by side, so a label and its value are not adjacent in
  the text; the checkers use ordered regexes for them.
- CSS: a rating-badge class named `top` once collided with the page header's `.top` rule and made the
  comment spacing uneven; the header is `.hdr` now. Keep class names distinct.
- `git commit -c user.name="$(git config user.name)"` fails when the config is empty; commit without
  overrides.
- Headless Chrome gets Google's robot page for Google-side checks (review links); use the iOS
  simulator for those.
- WhatsApp caches a link preview per URL; append `&v=N` to test a changed preview.
- The Sheets API is not enabled in clasp's Google project; the Sheet is read through a Drive export
  (xlsx), which `export-sheet.mjs` and `status.sh` do. A fresh `clasp login` may not be allowed to read
  the Sheet (drive.file scope); the bundled `clasprc.json` is.
- `save-draft.mjs` output: read the "Saved as a draft" line for the id, not the header line.

## 7. The private bundle (hand-carried, never in git)

`dairyschool-feedback-private-2026-10-15/` (and the same as a zip) was left on the old Mac's Desktop
to be copied to the new Mac:

- `README-PRIVATE.md`: ids, keys, links, the shell exports, the names lists as of 15 Oct.
- `private/`: everything git-ignored under the project (names, program specs, exports, translations,
  notes, the report PDFs, the paper backup, the 2023 data used to validate the analytics).
- `clasp.json` (→ `backend/.clasp.json`), `clasprc.json` (→ `~/.clasprc.json`), `demo-2023.local.js`
  (→ `site/assets/js/`).
- `memory/`: the Claude Code memory files for this project and Gal's working rules (→ the new machine's
  `~/.claude/projects/<key>/memory/`, with one index line each in its `MEMORY.md`).
- `sources/`: what the survey was built from: the owner's program files (`Draft_3_UVT_Program.docx`,
  `UVT_Program_Final.docx`), the rooming list PDF, and the school's paper feedback form (`.docx`).
- `claude-transcript/`: the full Claude Code transcript of the project session (one `.jsonl`, about
  200 MB, every message and tool result since 25 Sep). A new session can read or grep it when a detail is
  missing from this doc and the memory.
- `claude/`: the old Mac's Claude Code settings files (model, plugins, local permissions), for reference.

## 8. History

`git log` tells the story (26 Sep first commit, 29–30 Sep Google backend, 4–5 Oct go-live prep,
11 Oct opened, 12–13 Oct report tools). `README.md` documents run, test, deploy and operate. The full
record of decisions and findings is `memory/dairy-school-feedback-survey.md` in the bundle.
