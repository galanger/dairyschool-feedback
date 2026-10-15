#!/bin/bash
# Read-only status of a live survey: who has answered (the guide-key "progress" call) and when each answer was
# sent (a Drive export of the Sheet through clasp's sign-in, ~/.clasprc.json). Nothing is written anywhere;
# the exported copy lives in a temporary folder that is deleted when the script ends.
#
# Usage: SEMINAR=<seminar id> GUIDEKEY=<guide key> [SHEET=<spreadsheet id>] bash tools/status.sh
#   SEMINAR   the seminar id (the ?s= value of its links)
#   GUIDEKEY  the key after # in the guide link
#   SHEET     the Google Sheet id; without it only the progress part runs
#   EXEC      optional: the web app /exec URL (default: backendUrl in site/config.js)
#   CLASPRC   optional: clasp's token file (default: ~/.clasprc.json)
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
: "${SEMINAR:?set SEMINAR=<seminar id>}"
: "${GUIDEKEY:?set GUIDEKEY=<guide key>}"
SHEET="${SHEET:-}"
CLASPRC="${CLASPRC:-$HOME/.clasprc.json}"
EXEC="${EXEC:-$(node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');const m=/backendUrl:\s*'([^']+)'/.exec(s);if(!m)process.exit(1);console.log(m[1])" "$HERE/site/config.js")}"
[ -n "$EXEC" ] || { echo "no backendUrl in site/config.js (set EXEC=…)"; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export SEMINAR CLASPRC TMP
echo "== now Israel: $(TZ=Asia/Jerusalem date '+%Y-%m-%d %H:%M:%S')"
echo "== progress (guide key, read-only)"
curl -sS -L --max-time 90 -H 'Content-Type: text/plain;charset=utf-8' \
  --data "{\"action\":\"progress\",\"s\":\"$SEMINAR\",\"key\":\"$GUIDEKEY\"}" "$EXEC" > "$TMP/progress.json"
python3 -I - <<'PY'
import json, os
p = os.path.join(os.environ['TMP'], 'progress.json')
try:
    d = json.load(open(p, encoding='utf-8'))
except Exception as e:
    print('progress: not JSON', e, open(p, encoding='utf-8', errors='replace').read()[:200]); raise SystemExit(1)
if not d.get('ok'): print('progress error', d); raise SystemExit(1)
print('status:', d['status'], '| answered:', d['answered'], 'of', d['total'])
def nm(n):
    lat = (n.get('surname', '') + ' ' + n.get('given', '')).strip(); cyr = (n.get('surnameCyr', '') + ' ' + n.get('givenCyr', '')).strip()
    return lat + (f'  ({cyr})' if cyr and cyr != lat else '')
print('missing (%d):' % len(d['missing']))
for n in d['missing']: print('  -', nm(n))
print('done (%d):' % len(d['done']))
for n in d['done']: print('  +', nm(n))
PY
[ -n "$SHEET" ] || { echo "== sent times: skipped (set SHEET=<spreadsheet id> to read them)"; exit 0; }
echo "== sent times (Drive export, read-only)"
TOK=$(python3 -I - <<'PY'
import json, os, urllib.request, urllib.parse
rc = json.load(open(os.environ['CLASPRC'], encoding='utf-8'))
t = rc.get('tokens', {}).get('default') or rc.get('token') or rc
body = urllib.parse.urlencode({'client_id': t['client_id'], 'client_secret': t['client_secret'], 'refresh_token': t['refresh_token'], 'grant_type': 'refresh_token'}).encode()
r = urllib.request.urlopen(urllib.request.Request('https://oauth2.googleapis.com/token', data=body, method='POST'), timeout=60)
print(json.load(r)['access_token'])
PY
)
[ -n "$TOK" ] || { echo "no token (clasp login needed, or CLASPRC=<token file>)"; exit 1; }
curl -sS -L --max-time 120 -H "Authorization: Bearer $TOK" -o "$TMP/sheet.xlsx" \
  "https://www.googleapis.com/drive/v3/files/$SHEET/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet"
python3 -I - <<'PY'
import os, re, zipfile, xml.etree.ElementTree as ET
path = os.path.join(os.environ['TMP'], 'sheet.xlsx')
try:
    z = zipfile.ZipFile(path)
except zipfile.BadZipFile:
    print('export failed:', open(path, encoding='utf-8', errors='replace').read()[:300]); raise SystemExit(1)
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
wb = ET.fromstring(z.read('xl/workbook.xml'))
rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
rid2t = {r.get('Id'): r.get('Target') for r in rels}
sheets = [(s.get('name'), rid2t[s.get('{%s}id' % ns['r'])]) for s in wb.find('m:sheets', ns)]
ss = []
if 'xl/sharedStrings.xml' in z.namelist():
    for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns):
        ss.append(''.join(t.text or '' for t in si.iter('{%s}t' % ns['m'])))
def cellval(c):
    t = c.get('t'); v = c.find('m:v', ns)
    if t == 's': return ss[int(v.text)]
    if t == 'inlineStr': return ''.join(x.text or '' for x in c.iter('{%s}t' % ns['m']))
    return v.text if v is not None else ''
def col(ref): return re.match(r'[A-Z]+', ref).group(0)
want = os.environ['SEMINAR'] + ' · Answers'
print('tabs:', [n for n, _ in sheets])
found = False
for name, target in sheets:
    if name != want: continue
    found = True
    path = target.lstrip('/') if target.startswith('/') else 'xl/' + target.lstrip('/').replace('xl/', '', 1)
    rows = []
    for row in ET.fromstring(z.read(path)).iter('{%s}row' % ns['m']):
        rows.append({col(c.get('r')): cellval(c) for c in row.findall('m:c', ns)})
    head = rows[0] if rows else {}; sentcol = [k for k, v in head.items() if v == 'Sent (Israel time)']
    print('answer rows:', max(len(rows) - 1, 0), '| header cols:', len(head), '| sent col:', sentcol)
    if sentcol:
        times = sorted(r.get(sentcol[0], '') for r in rows[1:] if any(r.values()))
        for t in times: print('  ', t)
        print('LAST:', times[-1] if times else '-')
if not found: print('no tab named', repr(want))
PY
