# Dairy School seminar feedback

Online version of the Israeli Dairy School's end-of-seminar questionnaire. Each participant
answers once, on their phone, in Ukrainian or English. When the survey is closed the school team
gets the classic results sheet plus an analysis. No names, times or tracking are stored with answers.

## Parts

| Part | Where | What it holds |
|---|---|---|
| `site/` | GitHub Pages (later `feedback.dairyschool.co.il`) | Static HTML/CSS/JS. Holds no data. |
| `backend/Code.gs` | Google Apps Script bound to one Google Sheet | Once-only check, answers, staff passcode, the "Dairy School" menu. |
| Google Sheet | The school's Google account | `Seminars`, `<id> · Items`, `<id> · Names`, `<id> · Answers`, `<id> · English`. |

One page per role, so a participant only ever sees the questionnaire:

| Page | Who | What |
|---|---|---|
| `/?s=<seminar>` | participants (from the QR) | the questionnaire, thank-you, nothing else |
| `/guide.html?s=<seminar>#<key>` | the guide | opens the survey when the group is ready, then QR, progress, who is missing, on-the-day fixes; never scores |
| `/staff.html?s=<seminar>` | school staff (passcode) | open a draft, progress while open, close, then results, client sheet, CSV |

Dairy School → **Get links…** in the Sheet prints all three.

Every item asks for a rating (or "didn't take part") and offers a comment box, as on the paper
form; comments on items are welcome but optional. The two closing questions ("most valuable part",
"what could we do better") are required (the school's decision). "Next" lets people move on with
unrated items (a note offers "Show which" or "Continue anyway") and come back later; the last page
lists whatever is still missing with one-tap jumps. "Send" needs everything; nothing is sent half-done.

## Data safety

- Answers are stored in the school's own Google Sheet, one row per response, no names, no times.
- No code path deletes or overwrites an answer: `submit_` only inserts rows, closing removes only the
  names list and the once-only flags. The Answers tabs are protected against accidental manual edits
  (Sheets shows a warning before any change by hand).
- Closing the survey, and Dairy School → **Back up answers now**, add a dated copy of the answers as
  a new tab and email the same rows as a CSV to the backup address (Dairy School → Set backup email;
  by default the account that owns the Sheet). Google also keeps the Sheet's version history.
- On the phone, answers stay saved until the server confirms; a retry with the same submission id
  can never count twice. The results page has a CSV download for the school's own copy.
- While a survey is open, a trigger (`hourlyBackup`, armed when the survey is opened) emails the
  CSV in every hour that brought new answers, so a copy exists off the Sheet before closing.
- Closing never waits on Google Translate: the backup is made first, translations get 15 seconds
  inside the close request and the rest is finished by a background trigger (`translatePending`);
  the Comments tab says when some are still pending.
- Answers are counted by their submission id, so a blank or half-written row never counts.

## The flow, participant versus school

| Step | Participant | School |
|---|---|---|
| Before | – | Create the seminar as a draft (Sheet menu, or `tools/save-draft.mjs` from a file), preview it on a phone (a draft sends nothing). |
| Start | – | The guide taps **Open the survey now** on the guide page when the group is ready (or staff on `staff.html`, or the Sheet menu). The QR code appears only then; hourly safety copies start. |
| During | Scans the QR, picks their name, rates every item (comments optional), answers the two required closing questions, sends. Sees "Thank you", never any results. Can answer once only. | Guide page: progress, who is missing, add an extra person, remove a no-show, fix a wrong tap. Results page shows progress only. |
| Finish | A late sender is told the survey is closed. | **Close survey** on the results page (or the Sheet menu): names deleted, dated copy + CSV emailed, results unlock. Then: client results sheet (print/PDF), comments (translations finish in the background), CSV download. |

## Run locally

```sh
npm install
npm run serve          # http://127.0.0.1:8765/  (prototype mode: in-browser demo backend)
```

Without `backendUrl` in `site/config.js` the site runs against an in-browser mock with the same rules
as the real backend, seeded from `site/assets/js/demo-data.js` (invented names) plus a closed sample
seminar with invented answers (`demo-results.js`) so the staff page has results to show:
`staff.html?s=demo-results`, any passcode.
`site/assets/js/demo-2023.local.js` (real 2023 answers) is git-ignored and never leaves this machine.

## Test

```sh
npm test                 # unit + backend tests (Code.gs runs against a fake Sheet)
bash tests/run-all.sh    # everything: unit, e2e on Chrome/WebKit/Firefox, bundle, print, load time
node tests/atlas.mjs     # screenshots of every screen  → tests/atlas/
node tests/sim/run.mjs   # real iOS Safari walkthrough on the iPhone simulator (macOS + Xcode)
node tests/live-check.mjs  # the deployed site: three pages, no stray bar or links, results demo (BASE=…)
```

## Deploy

1. **Sheet + script.** Create a Google Sheet in the school's account. Extensions → Apps Script,
   paste `backend/Code.gs` and `backend/appsscript.json`. Deploy → New deployment → Web app,
   execute as **Me**, access **Anyone**. Copy the `/exec` URL.
2. **Site.** Put the `/exec` URL in `site/config.js` (`backendUrl`) and the public site address in
   `publicUrl`. The workflow in `.github/workflows/pages.yml` publishes `site/` to GitHub Pages on
   every push to `main` (set the Pages source to "GitHub Actions" once:
   `gh api -X PUT repos/<owner>/<repo>/pages -f build_type=workflow`). Any static host works too.
3. **First setup.** In the Sheet: reload, then Dairy School → First setup. It creates the tabs and a
   staff passcode. Dairy School → Set survey address (the same `publicUrl`).

## Operate a seminar

1. Create the draft, either way:
   - Sheet: Dairy School → **New seminar…** (copies the questions of an earlier seminar or the
     template), fill the title and dates in `Seminars`, edit `<id> · Items`, paste names into
     `<id> · Names` (names only, never passport numbers).
   - From a file: `PASSCODE=… node tools/save-draft.mjs private/<seminar>.json private/<names>.csv`
     writes the same tabs and prints the three links; `--id <id>` rewrites that draft in place (same
     links) as long as it has no answers. Keep real programs and names in `private/` (not published).
2. Open the participant link on a phone to preview: it shows "Preview" and sends nothing, so the
   questions and translations can be checked. Give the guide link to the guide.
3. When the group is ready, the guide taps **Open the survey now** on the guide page (staff can use
   **Open survey…** on `staff.html` or in the Sheet menu). The QR code and link appear; a phone that
   was still on the preview sends with its next tap.
5. On the day, the guide page itself handles an extra person (add a name), a no-show (remove a
   name that has not answered) and a wrong tap (mark the real person as answered, free the wrong
   name). Phones pick the change up within 15 seconds. **Fix a wrong name…** in the Sheet menu does
   the same for staff.
6. **Close survey…** (also possible from `staff.html`) → names are deleted for good, a dated copy and a
   CSV backup are made, results unlock on `staff.html`. A closed survey is never reopened.

## Rules kept from the paper reports

Score = mean of the 1–7 ratings ("didn't take part" and blanks excluded). % = exact mean ÷ 7,
rounded; never 100 unless every rating is 7. Highlight (yellow) below 80%. Items with fewer than
5 ratings are marked "few" († on the client sheet). See `site/assets/js/analytics.js`.
