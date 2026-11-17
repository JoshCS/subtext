#!/usr/bin/env python3
"""Builds extension/data/tracker-lists.json: third-party domains that public, openly licensed tracker lists name, beyond the hand-kept rules/trackers.json.
Sources (licences read from their files, 2026-11-06):
  - AdGuard companies database (https://github.com/AdguardTeam/companiesdb, CC BY-SA 4.0): domain -> tracker -> company and category.
  - EasyPrivacy (https://easylist.to/easylist/easyprivacy.txt, GPL-3.0+ or CC BY-SA 3.0+, used here under CC BY-SA 4.0, credit "The EasyList authors"): domain-only rules.
Only tracking categories are kept (advertising, site analytics, social media, customer interaction, mobile analytics, audio/video ads are not). Usage:
  python3 -I scripts/build-tracker-lists.py <dir with adguard_companiesdb_trackers.json, adguard_companiesdb_companies.json, easyprivacy.txt, public_suffix_list.dat>"""
import json,os,re,sys,datetime
D=sys.argv[1]; ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rules=set(); exc=set()
for l in open(os.path.join(D,'public_suffix_list.dat'),encoding='utf8'):
    l=l.strip()
    if not l or l.startswith('//'): continue
    (exc.add(l[1:]) if l.startswith('!') else rules.add(l))
def reg(h):
    p=h.lower().strip('.').split('.')
    for i in range(len(p)):
        s='.'.join(p[i:])
        if s in exc: return s
        if s in rules or ('*.'+'.'.join(p[i+1:])) in rules: return '.'.join(p[max(0,i-1):])
    return '.'.join(p[-2:])
KEEP={'advertising':'advertising','site_analytics':'analytics','social_media':'social','customer_interaction':'customer interaction','mobile_analytics':'analytics','pornvertising':'advertising','consent':'consent'}
ag=json.load(open(os.path.join(D,'adguard_companiesdb_trackers.json'))); co=json.load(open(os.path.join(D,'adguard_companiesdb_companies.json')))
companies=co.get('companies',co); cats={str(k):v for k,v in ag['categories'].items()}
out={}
for dom,tid in ag['trackerDomains'].items():
    t=ag['trackers'].get(tid) or {}; cat=KEEP.get(cats.get(str(t.get('categoryId')),''))
    if not cat: continue
    c=companies.get(t.get('companyId')) or {}; name=c.get('name') or t.get('name') or ''
    out[reg(dom)]=[name[:60],cat,'a']
ep=0
for l in open(os.path.join(D,'easyprivacy.txt'),encoding='utf8',errors='ignore'):
    m=re.match(r'^\|\|([a-z0-9.-]+\.[a-z]{2,})\^(\$third-party)?\s*$',l.strip())
    if m:
        r=reg(m.group(1))
        if r not in out: out[r]=['','tracking','e']; ep+=1
data={'built':datetime.date.today().isoformat(),'notes':'Domain -> [company, category, source]; source a = AdGuard companies database (CC BY-SA 4.0), e = EasyPrivacy (The EasyList authors, CC BY-SA). Built by scripts/build-tracker-lists.py. Vendor facts only: a domain on these lists was contacted by the page.','domains':dict(sorted(out.items()))}
p=os.path.join(ROOT,'extension','data','tracker-lists.json'); json.dump(data,open(p,'w'),separators=(',',':'),ensure_ascii=False)
print('domains',len(out),'from AdGuard',len(out)-ep,'EasyPrivacy only',ep,'bytes',os.path.getsize(p))
