# Handover received on the new Mac — Dairy School feedback survey

Written 15 Oct 2026 on the NEW Mac by its first Claude Code session, for the session still running on
the OLD Mac. Please read §3, answer in §4 and push; the old Mac is not wiped until this file says
"confirmed" from your side. No private data in this file (the repo is public).

## 1. What arrived and was checked

The AirDropped folder MOVE-TO-NEW-MAC holds both zips and README-START-HERE.txt. The Dairy School zip
(dairyschool-feedback-private-2026-10-15.zip, 132,270,001 bytes,
sha256 51dd3493fed0a5ba38136f05db828e2829036791d3be9f9934d15436a0d0cb11) unzipped cleanly to 38 files:

| Section of the bundle | Expected (README-PRIVATE §"Where each file goes") | Found |
|---|---|---|
| README-PRIVATE.md | yes | yes (16:19 version, with the 15 Oct afternoon section) |
| private/ | the project's git-ignored files | 22 files: spec, test spec, names, links, translations, notes, both exports, both interim PDFs, paper backup, rooming list text, the 2023 validation data, logo |
| clasp.json | binds clasp to the script | yes |
| clasprc.json | clasp sign-in | yes |
| demo-2023.local.js | optional local demo | yes |
| memory/ | 7 memory files | 7, byte-identical to the copies in the LiveHerz zip's claude-memory/ |
| sources/ | 2 program .docx, rooming list PDF, paper form .docx | 4, byte-identical to the copies in the LiveHerz zip's downloads-all/ |
| claude-transcript/ | the session .jsonl | 1 file, 201,612,711 bytes; first entry 25 Sep 13:23 UTC, last entry 15 Oct 13:19 UTC (16:19 Israel), i.e. up to the re-zip command |
| claude/ (settings) | listed in docs/HANDOVER-NEW-MAC §7 | NOT in the bundle (see Q2) |

Cross-checks against the public repo: main = 0764125 = tag handover-2026-10-15 (annotated tag resolves
to the same commit); branches main + gh-pages only; the repo's git-ignored set (backend/.clasp.json,
private/, site/assets/js/*.local.js, plus generated dist/, node_modules/, tests/output, tests/atlas,
tests/sim/shots) is fully covered by the bundle except the generated folders. The interim report PDF
and the paper backup in private/ are byte-identical to the Downloads copies in the LiveHerz zip.

## 2. Done on the new Mac so far

- Repo cloned to ~/dairyschool-feedback (main at 0764125, tag present).
- private/ → repo private/; clasp.json → backend/.clasp.json; clasprc.json → ~/.clasprc.json (0600);
  demo-2023.local.js → site/assets/js/. `git status --ignored` shows exactly those three ignored paths.
- memory/*.md copied into this machine's Claude Code memory folder with a MEMORY.md index.
- Not done yet (needs Gal or sudo): Xcode licence, Node, Chrome, poppler, gh login, the four shell
  exports in ~/.zshrc, `npm install`, `check-setup.sh --live`.

## 3. Questions for the old-Mac session — please confirm each

- **Q1 — anything after 16:19 Israel on 15 Oct?** The transcript copy and the zip both end at the
  re-zip. README-START-HERE.txt was edited later (17:27). Did the Dairy session do anything after
  16:19: a change to the Sheet (replacement name added, the lost answer resolved, a close), a new
  export or report, a commit, a memory edit, or a change to the bundle contents?
- **Q2 — the `claude/` folder.** docs/HANDOVER-NEW-MAC §7 lists `claude/` (old Mac's Claude Code
  settings) as part of the bundle, but the zip has no such folder. Was it dropped on purpose? The
  LiveHerz zip carries a 162-byte claude-settings.json (model, one plugin, theme). Is that all of it,
  or is there a settings.local.json / permissions file for this project worth carrying?
- **Q3 — GitHub token.** docs/HANDOVER-NEW-MAC §5.1 says the bundle README holds a token for
  `gh auth login --with-token`; README-PRIVATE says no token on purpose. Confirm: no token expected,
  browser login on the new Mac, and revoke the old Mac's GitHub CLI authorisation after.
- **Q4 — clasprc.json validity.** Was there any `clasp login` / logout on the old Mac after 14:57
  (the bundled file's time)? If yes, the bundled refresh token may be dead.
- **Q5 — latest data.** Confirm the newest export is the 13 Oct 14:18 one (15 answers) and the newest
  report is the 13 Oct 14:18 PDF; nothing newer exists only on the old Mac (Downloads, Desktop, scratch).
- **Q6 — anything outside the listed places?** README-PRIVATE says only ~/dairyschool-feedback
  (ignored files), ~/.clasprc.json, ~/Downloads and ~/.claude were used. Any other file for this
  project anywhere else on the old Mac (Desktop notes, scratchpad outputs still wanted, the artifact
  links in memory that are now the only copies)?
- **Q7 — old-Mac-only state.** Anything live on the old Mac that cannot be carried: a running trigger,
  a scheduled job, an open browser session that matters?

## 4. Answers from the old-Mac session

(fill in and push; end with the word "confirmed" once every question is answered)

