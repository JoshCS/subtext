#!/usr/bin/env python3
"""Draws the frozen page pool for the human labelling test (docs/CALIBRATION.md section 7). Fixed procedure, no looking.
Source: the Tranco top 1M list named by LIST_ID. Strata by rank so long-tail sites are not drowned out by famous ones. Sites already used to tune Subtext and sites on our
known-bad list are removed, because the first are not unseen and the second would break the rule against visiting listed sites live. Draws more than needed; the capture script takes them
in this order and stops at the target, so a dead site cannot be replaced by choice. The file is written once and refuses to overwrite.
Usage: python3 -I eval/pool-freeze.py <path to top-1m.csv>"""
import csv,hashlib,json,os,random,sys
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'eval','pool','frozen-pool-2026-11-05.json')
LIST_ID='JZPGY'; SEED='subtext-frozen-pool-2026-11-05'
STRATA=[('top-1k',1,1000,40),('1k-10k',1001,10000,80),('10k-100k',10001,100000,120),('100k-1m',100001,1000000,160)]
DRAW=3 # draw three times the target from each stratum, for dead sites, blocks and unsafe sites
if os.path.exists(OUT): sys.exit('already frozen: '+OUT)
rows=[(int(r),d.strip().lower()) for r,d in csv.reader(open(sys.argv[1]))]
digest=hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest()
used=set()
for p in json.load(open(os.path.join(ROOT,'eval','real','corpus-pages.json'))):
    host=(p.get('url') or '').split('/')[2] if '//' in (p.get('url') or '') else ''
    used.add(host.replace('www.',''))
known=set(json.load(open(os.path.join(ROOT,'extension','data','known-bad.json')))['entries'])
def excluded(d): return d in used or d in known or any(d.endswith('.'+k) for k in used if k)
pool=[]
for name,lo,hi,target in STRATA:
    cand=[(r,d) for r,d in rows if lo<=r<=hi and not excluded(d)]
    random.Random(SEED+name).shuffle(cand)
    pool.extend({'stratum':name,'target':target,'order':i,'rank':r,'domain':d} for i,(r,d) in enumerate(cand[:target*DRAW]))
json.dump({'list':'Tranco '+LIST_ID,'list_sha256':digest,'seed':SEED,'strata':[s[0] for s in STRATA],'targets':{s[0]:s[3] for s in STRATA},'excluded_used':len(used),'pool':pool},open(OUT,'w'),indent=0)
print('frozen',len(pool),'domains; sha256 of pool file',hashlib.sha256(open(OUT,'rb').read()).hexdigest())
