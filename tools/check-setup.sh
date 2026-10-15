#!/bin/bash
# Checks that a machine has everything this project needs: tools, the repo state, the private files from the
# hand-carried bundle, the clasp sign-in and the shell exports. Prints ok / MISSING per item with where it comes from.
# Usage: bash tools/check-setup.sh [--live]      (--live also calls the backend and the Sheet, read-only)
HERE="$(cd "$(dirname "$0")/.." && pwd)"; cd "$HERE" || exit 2
ok=0; bad=0
pass() { printf '  ok       %s\n' "$1"; ok=$((ok+1)); }
fail() { printf '  MISSING  %s\n     → %s\n' "$1" "$2"; bad=$((bad+1)); }
have() { command -v "$1" >/dev/null 2>&1; }

echo "== tools"
if have node; then v=$(node -p 'process.versions.node.split(".")[0]'); [ "$v" -ge 20 ] && pass "node $(node -v)" || fail "node $(node -v) is older than 20" "install Node 20 or newer (nodejs.org or brew install node)"; else fail "node" "install Node 20 or newer"; fi
have npm && pass "npm" || fail "npm" "comes with Node"
have git && pass "git" || fail "git" "xcode-select --install"
have python3 && pass "python3" || fail "python3" "xcode-select --install"
if have gh; then gh auth status >/dev/null 2>&1 && pass "gh signed in ($(gh api user --jq .login 2>/dev/null))" || fail "gh not signed in" "gh auth login  (account galanger), then gh auth setup-git"; else fail "gh" "brew install gh, then gh auth login"; fi
for t in pdftotext pdfinfo pdftoppm pdffonts; do have $t && pass "$t" || fail "$t" "brew install poppler"; done
[ -d "/Applications/Google Chrome.app" ] && pass "Google Chrome (Playwright channel 'chrome')" || fail "Google Chrome" "install Chrome; the report PDF and browser tests launch it"
have clasp && pass "clasp (backend changes)" || printf '  note     clasp not installed: only needed for backend changes (npm i -g @google/clasp)\n'
[ -d node_modules/playwright-core ] && pass "npm dependencies installed" || fail "node_modules" "npm install"

echo "== repo"
origin=$(git remote get-url origin 2>/dev/null); case "$origin" in *github.com[:/]galanger/dairyschool-feedback*) pass "origin = $origin";; *) fail "origin remote is '$origin'" "git remote set-url origin https://github.com/galanger/dairyschool-feedback.git";; esac
if git fetch -q origin 2>/dev/null; then
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && pass "HEAD = origin/main ($(git rev-parse --short HEAD))" || fail "HEAD differs from origin/main" "git pull (or push) first"
  git rev-parse -q --verify refs/tags/handover-2026-10-15 >/dev/null && pass "tag handover-2026-10-15 present" || fail "tag handover-2026-10-15" "git fetch --tags"
else fail "cannot reach GitHub" "check the network or gh auth"; fi
[ -z "$(git status --porcelain)" ] && pass "working tree clean" || printf '  note     working tree has local changes\n'
grep -q '^private/$' .gitignore && pass ".gitignore keeps private/ out of git" || fail ".gitignore lacks private/" "never commit private/"

echo "== private files (from the bundle)"
for f in private/uvt-2026-names.csv private/uvt-2026-seminar.json private/uvt-2026-links.txt private/uvt-2026-translations.json private/uvt-2026-report-notes.json private/uvt-2026-export.json private/rooming-list.txt; do
  [ -s "$f" ] && pass "$f" || fail "$f" "copy the bundle's private/ folder into the project"; done
ls private/UVT-2026-feedback-interim-report-*.pdf >/dev/null 2>&1 && pass "interim report PDF(s) in private/" || fail "private/UVT-2026-feedback-interim-report-*.pdf" "copy the bundle's private/ folder"
[ -s backend/.clasp.json ] && pass "backend/.clasp.json" || fail "backend/.clasp.json" "copy the bundle's clasp.json to backend/.clasp.json"
[ -s "$HOME/.clasprc.json" ] && pass "~/.clasprc.json (clasp sign-in, reads the Sheet)" || fail "~/.clasprc.json" "copy the bundle's clasprc.json to ~/.clasprc.json"
[ -s site/assets/js/demo-2023.local.js ] && pass "site/assets/js/demo-2023.local.js (optional)" || printf '  note     demo-2023.local.js absent: only the local 2023 demo needs it\n'

echo "== shell exports (from the bundle's README)"
for v in SEMINAR GUIDEKEY SHEET PASSCODE; do [ -n "${!v:-}" ] && pass "$v set" || fail "$v not set" "export $v=…  (values in README-PRIVATE.md)"; done

if [ "${1:-}" = "--live" ]; then
  echo "== live (read-only)"
  exec_url=$(node -e "const s=require('fs').readFileSync('site/config.js','utf8');console.log(/backendUrl:\s*'([^']+)'/.exec(s)[1])")
  if [ -n "${SEMINAR:-}" ]; then
    cfg=$(curl -sS -L --max-time 90 "$exec_url?action=config&s=$SEMINAR" 2>/dev/null)
    echo "$cfg" | grep -q '"ok":true' && pass "backend answers for $SEMINAR (status $(echo "$cfg" | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p'))" || fail "backend config call" "Google may be slow: retry in a minute; check site/config.js backendUrl"
  else fail "SEMINAR needed for the live check" "export SEMINAR=…"; fi
  if [ -n "${SEMINAR:-}" ] && [ -n "${GUIDEKEY:-}" ]; then
    out=$(SHEET="${SHEET:-}" bash tools/status.sh 2>&1); echo "$out" | grep -q '^status:' && pass "status.sh: $(echo "$out" | grep '^status:')" || fail "status.sh failed" "$(echo "$out" | tail -n 1)"
    [ -n "${SHEET:-}" ] && { echo "$out" | grep -q '^LAST:' && pass "Sheet export through ~/.clasprc.json: $(echo "$out" | grep '^LAST:')" || fail "Sheet export" "use the bundled clasprc.json (a fresh clasp login may lack access)"; }
  fi
fi
echo; echo "$ok ok · $bad missing"; [ "$bad" -eq 0 ]
