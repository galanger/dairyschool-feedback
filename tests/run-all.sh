#!/bin/bash
# Full validation from a clean start. Usage: bash tests/run-all.sh  (log: tests/output/run-all.log)
cd "$(dirname "$0")/.."
pkill -f "http.server 876" 2>/dev/null; sleep 0.5
rm -rf tests/output && mkdir -p tests/output
node tools/build-prototype.mjs
python3 -m http.server 8765 --bind 127.0.0.1 --directory site >/dev/null 2>&1 &
python3 -m http.server 8766 --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
sleep 1
echo "== unit + backend"; node --test tests/ 2>&1 | grep -E "^ℹ (pass|fail)"
for engine in chrome webkit firefox; do
  for suite in e2e e2e-more e2e-live; do
    ENGINE=$engine node tests/$suite.mjs > tests/output/$suite-$engine.log 2>&1
    echo "== $suite ($engine): $(tail -1 tests/output/$suite-$engine.log)"
    grep "✘" tests/output/$suite-$engine.log
  done
done
for engine in chrome webkit; do
  for suite in e2e e2e-more; do
    ENGINE=$engine BUNDLE=1 BASE=http://127.0.0.1:8766/prototype-local.html node tests/$suite.mjs > tests/output/bundle-$suite-$engine.log 2>&1
    echo "== bundle $suite ($engine): $(tail -1 tests/output/bundle-$suite-$engine.log)"
    grep "✘" tests/output/bundle-$suite-$engine.log
  done
done
echo "== print (chrome)"; node tests/print.mjs && for f in results-sheet results-sheet-40; do echo "$f: $(pdfinfo tests/output/$f.pdf | grep Pages)"; done
echo "== load time (chrome)"; node tests/perf.mjs
echo "== done"
