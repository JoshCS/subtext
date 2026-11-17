#!/usr/bin/env python3
"""Honest small-shop control pages from the Internet Archive only: the shops are never contacted, and fetching is done exactly as in badpages-fetch.py
(CDX lookup, HTTP 200 HTML, `id_` raw fetch, 5 KB minimum), so a test cannot separate honest from known-bad pages by how they were fetched.
Candidates are domains that a named third party vouches for (trust-mark and trade-body member directories), collected by hand into a JSON-lines file:
{"domain","directory","directory_url","date"}. Directories are for our private test only; nothing here is redistributed (eval/corpus-honest/ is gitignored).
Filters: drops domains in the Tranco top 100,000 (--tranco FILE, rank,domain) and domains in extension/data/known-bad.json (counted, never fetched).
Selection: per directory, a fixed shuffle (random.Random('subtext-honest-controls')); directories are then taken in turn until the target is reached. Page content is never read or judged.
Writes eval/corpus-honest/<domain>.html and index.json (domain, source, directory_url, capture, original, bytes). Only web.archive.org is contacted.
Usage: python3 eval/honest-fetch.py CANDIDATES.jsonl --tranco top-1m.csv [--target 180] [--dry]"""
import argparse,json,os,random,time,urllib.parse,urllib.request
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT=os.path.join(ROOT,'eval','corpus-honest'); os.makedirs(OUT,exist_ok=True)
ap=argparse.ArgumentParser(); ap.add_argument('candidates'); ap.add_argument('--tranco'); ap.add_argument('--target',type=int,default=180); ap.add_argument('--dry',action='store_true'); a=ap.parse_args()
SLD={'co.uk','org.uk','me.uk','com.au','net.au','co.nz','com.br','co.za','com.pl','com.es','com.tr','co.il','com.mx','co.jp','com.ar'}
def reg(d):
    p=d.split('.'); return '.'.join(p[-3:]) if len(p)>=3 and '.'.join(p[-2:]) in SLD else '.'.join(p[-2:])
bad=set(json.load(open(os.path.join(ROOT,'extension','data','known-bad.json')))['entries'])
top=set()
if a.tranco:
    for line in open(a.tranco):
        r,_,d=line.strip().partition(',')
        if r.isdigit() and int(r)<=100000: top.add(d.lower())
def parents(d):
    p=d.split('.'); return ['.'.join(p[i:]) for i in range(len(p)-1)]
rows=[]; seen=set(); st={'raw':0,'duplicate':0,'tranco_top100k':0,'known_bad':0}
for line in open(a.candidates):
    if not line.strip(): continue
    c=json.loads(line); d=c['domain'].lower().removeprefix('www.'); st['raw']+=1
    if reg(d) in seen: st['duplicate']+=1; continue
    seen.add(reg(d))
    if any(x in bad for x in parents(d)): st['known_bad']+=1; continue
    if any(x in top for x in parents(d)): st['tranco_top100k']+=1; continue
    rows.append({**c,'domain':d})
by={}
for r in rows: by.setdefault(r['directory'],[]).append(r)
rng=random.Random('subtext-honest-controls')
for k in sorted(by): rng.shuffle(by[k])  # fixed order of directories, fixed shuffle inside each
order=[]; i=0
while any(i<len(v) for v in by.values()):
    for k in sorted(by):
        if i<len(by[k]): order.append(by[k][i])
    i+=1
print('candidates',st,'kept',len(rows),{k:len(v) for k,v in sorted(by.items())},flush=True)
if a.dry: raise SystemExit
def get(url,t=30):
    req=urllib.request.Request(url,headers={'User-Agent':'subtext-eval (archive.org lookup)'})
    with urllib.request.urlopen(req,timeout=t) as r: return r.read()
idx=os.path.join(OUT,'index.json'); index=json.load(open(idx)) if os.path.exists(idx) else []; have={x['domain'] for x in index}
tried=set(); log=os.path.join(OUT,'tried.json')
if os.path.exists(log): tried=set(json.load(open(log)))
OPERATORS={'ehi.org','ehi-siegel.de','guetezeichen.at','apek.cz','thuiswinkel.org','confianzaonline.es','trustedshops.de'}  # directory operators' own sites are not shops
PACE=4.0  # seconds before each lookup: slower than badpages-fetch.py (2.5), which drew a connection refusal for about one lookup in four and then waited 90 s each time
for c in order:
    if len(index)>=a.target: break
    d=c['domain']
    if d in have or d in tried or reg(d) in OPERATORS: continue
    for attempt in range(3):
        time.sleep(PACE)
        try:
            q={'url':d,'output':'json','filter':['statuscode:200','mimetype:text/html'],'from':'20240101','collapse':'digest','limit':'-8','fl':'timestamp,original,length'}
            r=json.loads(get('https://web.archive.org/cdx/search/cdx?'+urllib.parse.urlencode(q,doseq=True)) or b'[]')[1:]
            r=[x for x in r if int(x[2] or 0)>=2000 and x[0][:8]>='20240101']
            tried.add(d)
            if not r: time.sleep(0.4); break
            ts,orig,_=r[-1]
            html=get(f'https://web.archive.org/web/{ts}id_/{orig}',45)
            if len(html)<5000: time.sleep(0.4); break
            with open(os.path.join(OUT,d+'.html'),'wb') as f: f.write(html)
            index.append({'domain':d,'source':c['directory'],'directory_url':c['directory_url'],'capture':ts,'original':orig,'bytes':len(html)}); have.add(d)
            print(c['directory'],len(index),d,ts,len(html),flush=True); time.sleep(3)
            break
        except Exception as e:
            print('skip',d,str(e)[:80],flush=True)
            if 'refused' in str(e) or '429' in str(e): time.sleep(90); continue # archive.org rate limit: back off, then try this domain again
            time.sleep(2); break
    json.dump(index,open(idx,'w'),indent=0); json.dump(sorted(tried),open(log,'w'))
json.dump(index,open(idx,'w'),indent=0)
print('pages',len(index))
