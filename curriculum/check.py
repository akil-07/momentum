"""validate one curriculum area file: python3 check.py <area>.json [--urls]"""
import json, sys, re, urllib.request, os
HERE = os.path.dirname(os.path.abspath(__file__))
probs = json.load(open(os.path.join(HERE, '..', 'realround', 'data', 'problems.json')))['result']['problems']
CF = {f"{p['contestId']}{p['index']}": p for p in probs if p.get('contestId')}
f = sys.argv[1]; d = json.load(open(f)); errs, warns = [], []
ids = set(); nsub = 0; nprob = 0
for t in d.get('topics', []):
    for k in ('id', 'name', 'cfTags', 'subtopics'):
        if k not in t: errs.append(f"topic {t.get('id')}: missing {k}")
    for s in t.get('subtopics', []):
        nsub += 1; sid = s.get('id', '?')
        if sid in ids: errs.append(f'duplicate subtopic id {sid}')
        ids.add(sid)
        for k in ('id', 'name', 'tier', 'summary', 'learn', 'resources', 'problems'):
            if k not in s: errs.append(f'{sid}: missing {k}')
        if not re.fullmatch(r'[a-z0-9-]+', sid): errs.append(f'{sid}: id must be lowercase-kebab')
        if not isinstance(s.get('tier'), int) or not 800 <= s['tier'] <= 3500: errs.append(f'{sid}: tier must be an int rating 800-3500')
        if len(s.get('resources', [])) < 1: errs.append(f'{sid}: needs at least one resource')
        cfp = [p for p in s.get('problems', []) if p.get('src') == 'cf']
        if len(cfp) < 4: warns.append(f'{sid}: only {len(cfp)} CF problems (aim for 6+)')
        for p in s.get('problems', []):
            nprob += 1; pid = p.get('id', '')
            if p.get('src') == 'cf':
                if pid not in CF: errs.append(f'{sid}: CF problem {pid} does not exist in the problemset')
                elif not CF[pid].get('rating'): warns.append(f'{sid}: CF problem {pid} has no rating yet')
                elif p.get('rating') and p['rating'] != CF[pid]['rating']: errs.append(f"{sid}: {pid} rating {p['rating']} != real {CF[pid]['rating']}")
            elif p.get('src') == 'cses':
                if not re.fullmatch(r'cses-\d{4}', pid): errs.append(f'{sid}: CSES id must look like cses-1633, got {pid}')
            else: errs.append(f"{sid}: problem src must be cf or cses, got {p.get('src')}")
        for r in s.get('resources', []):
            if not r.get('url', '').startswith('https://'): errs.append(f"{sid}: resource without https url: {r}")
            if r.get('kind') not in ('usaco', 'cph', 'cpalgo', 'cf-edu', 'cf-blog', 'other'): errs.append(f"{sid}: bad resource kind {r.get('kind')}")
for p in d.get('prereqCheck', []): pass
for t in d.get('topics', []):
    for s in t.get('subtopics', []):
        for pr in s.get('prereq', []):
            if pr not in ids and not pr.startswith('@'): warns.append(f"{s['id']}: prereq {pr} not in this area (prefix with @ if it's in another area)")
if '--urls' in sys.argv:
    seen = set()
    for t in d.get('topics', []):
        for s in t.get('subtopics', []):
            for r in s.get('resources', []):
                u = r['url'].split('#')[0]
                if u in seen or 'cses.fi/book' in u: continue
                seen.add(u)
                try:
                    req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)'})
                    with urllib.request.urlopen(req, timeout=20) as resp: code = resp.status
                except Exception as e: code = getattr(e, 'code', str(e)[:40])
                if code != 200: errs.append(f"{s['id']}: resource url {u} -> {code}")
print(f'{f}: {nsub} subtopics, {nprob} problems, {len(errs)} errors, {len(warns)} warnings')
for e in errs: print('ERROR', e)
for w in warns[:60]: print('warn ', w)
sys.exit(1 if errs else 0)
