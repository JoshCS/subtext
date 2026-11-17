#!/usr/bin/env python3
"""Writes docs/RELIABILITY.md from the judges' per-rule results and the live tiers. Usage: python3 eval/reliability-report.py <folder with *_rules.json, merged.json> [results paragraph file]"""
import json,os,sys,collections
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); S=sys.argv[1]
m=json.load(open(os.path.join(S,'merged.json'))); tiers=json.load(open(os.path.join(ROOT,'extension','rules','reliability.json')))['tiers']
app={}
for f in ('policy','sale','measured'):
    p=os.path.join(S,f+'_applied.json')
    if os.path.exists(p):
        for r in json.load(open(p)): app[r['rule']]=r
intro=open(sys.argv[2]).read() if len(sys.argv)>2 else ''
out=['# Which rules are reliable, and why','',intro,'']
names={'policy':'Privacy and terms clauses','sale':'Sale language','reader':'How text argues','measured':'Measured page checks'}
tierword={'flag':'Flag','note':'Quiet note','hold':'Held'}
for fam in ('policy','sale','reader','measured'):
    rows=[(k,v) for k,v in m.items() if v['family']==fam]
    c=collections.Counter(tiers.get(k,'hold') for k,v in rows)
    out+=[f'## {names[fam]}','',f"{c['flag']} flag, {c['note']} quiet note, {c['hold']} held.",'','| Rule | Now | Pages fired on (of 126) | Judged: useful / ordinary / wrong | Why | What changed |','|---|---|---:|---:|---|---|']
    order={'flag':0,'note':1,'hold':2}
    for k,v in sorted(rows,key=lambda kv:(order[tiers.get(kv[0],'hold')],kv[0])):
        j=v['judged']; a=app.get(k); clean=lambda s:str(s or '').replace('|','/').replace('\n',' ')
        changed=('Fixed. ' if a and a.get('applied') is True else '')+clean(v['fix'])[:220] if v['status']=='fix' else {'retire':'Stays off. Word matching or this check cannot do it.','demote':'True but ordinary.','no_evidence':'Not enough real firings to tell.','reliable':''}.get(v['status'],'')
        out.append(f"| `{k}` | {tierword[tiers.get(k,'hold')]} | {v['pages']} | {j.get('supported',0)} / {j.get('ordinary',0)} / {j.get('wrong',0)} | {clean(v['cause'])[:260]} | {changed} |")
    out.append('')
open(os.path.join(ROOT,'docs','RELIABILITY.md'),'w').write('\n'.join(out))
print('rules',len(m),collections.Counter(tiers.get(k,'hold') for k in m))
