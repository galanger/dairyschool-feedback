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

Views on the site: `?s=<seminar>` (participant), `?s=<seminar>#guide-<key>` (guide: QR, progress,
missing names, never scores) and `?s=<seminar>#results` (staff, passcode, unlocked after closing).

Every item asks for a rating (or "didn't take part") **and a short comment**, and the two closing
questions are required too (the school's decision). "Next" and "Send" refuse until the page is
complete and show which items are missing; nothing is sent half-done.

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

## Run locally

```sh
npm install
npm run serve          # http://127.0.0.1:8765/  (prototype mode: in-browser demo backend)
```

Without `backendUrl` in `site/config.js` the site runs against an in-browser mock with the same rules
as the real backend, seeded from `site/assets/js/demo-data.js` (invented names).
`site/assets/js/demo-2023.local.js` (real 2023 answers) is git-ignored and never leaves this machine.

## Test

```sh
npm test                 # unit + backend tests (Code.gs runs against a fake Sheet)
bash tests/run-all.sh    # everything: unit, e2e on Chrome/WebKit/Firefox, bundle, print, load time
node tests/atlas.mjs     # screenshots of every screen  → tests/atlas/
node tests/sim/run.mjs   # real iOS Safari walkthrough on the iPhone simulator (macOS + Xcode)
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

## Operate a seminar (Sheet menu)

1. Dairy School → **New seminar…** (copies the questions of an earlier seminar or the template).
2. Fill the title and dates in `Seminars`, edit `<id> · Items`, paste names into `<id> · Names`
   (names only, never passport numbers).
3. **Get links…** → open the participant link on a phone to preview (a draft sends nothing).
4. **Open survey…** → give the guide link to the guide; show the QR.
5. On the day, the guide page itself handles an extra person (add a name), a no-show (remove a
   name that has not answered) and a wrong tap (mark the real person as answered, free the wrong
   name). Phones pick the change up within 15 seconds. **Fix a wrong name…** in the Sheet menu does
   the same for staff.
6. **Close survey…** (also possible from `#results`) → names are deleted for good, a dated copy and a
   CSV backup are made, results unlock on `#results`.

## Rules kept from the paper reports

Score = mean of the 1–7 ratings ("didn't take part" and blanks excluded). % = exact mean ÷ 7,
rounded; never 100 unless every rating is 7. Highlight (yellow) below 80%. Items with fewer than
5 ratings are marked "few" († on the client sheet). See `site/assets/js/analytics.js`.
