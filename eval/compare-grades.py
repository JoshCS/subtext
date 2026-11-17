#!/usr/bin/env python3
"""Grade table for one corpus run: today's grade next to a 'pressure only' grade (GRADE_MODE in extension/common.js), plus a symmetry table.
Usage: python3 eval/compare-grades.py eval/out-corpus/<run>.json"""
import json,sys,math
PRESSURE={'dark_pattern','urgency_scarcity','social_proof','attention','bias_exploit','deceptive_claims','rhetoric','emotional','interpersonal','charts','design_psych'}
def score(fs,pressure=False):
    per={}
    for f in fs:
        if f['severity']<=0: continue
        if pressure and f['category'] not in PRESSURE: continue
        c=0.7 if f.get('confidence') is None else f['confidence']
        per[f['category']]=per.get(f['category'],0)+f['severity']*c*math.sqrt(min(f.get('count') or 1,6))
    w=sum(min(v,10) for v in per.values()); s=round(100*(1-math.exp(-w/20)))
    sev=[f for f in fs if f['severity']>=3 and (f.get('confidence') is None or f['confidence']>=0.7) and not (f.get('lexical')) and (not pressure or f['category'] in PRESSURE)]
    if sev: s=max(s,min(70,35+15*(len(sev)-1)))
    return s,('A' if s<15 else 'B' if s<30 else 'C' if s<50 else 'D' if s<70 else 'F')
R=[r for r in json.load(open(sys.argv[1])) if not r.get('error') and not (r.get('meta') or {}).get('errorPage') and (r.get('chars') or 0)>=300]
print('| page | group | today | pressure only |\n|---|---|---|---|')
for r in sorted(R,key=lambda r:(r['group'],r['name'])):
    s,g=score(r['findings'],True); print(f"| {r['name']} | {r['group']} | {r['grade']} {r['score']} | {g} {s} |")
