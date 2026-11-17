#!/usr/bin/env python3
"""Known-bad test pages from the Internet Archive only: listed sites are never contacted. Rules from the 2026-11-05 list brief: HTTP 200 HTML captures,
dated after the listing where the list gives a date, at least 5 KB. Writes eval/corpus-bad/<domain>.html (gitignored, third-party content, never publish) and index.json.
Usage: python3 eval/badpages-fetch.py [how many per source]"""
import json,os,random,sys,time,urllib.parse,urllib.request
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT=os.path.join(ROOT,'eval','corpus-bad'); os.makedirs(OUT,exist_ok=True)
data=json.load(open(os.path.join(ROOT,'extension','data','known-bad.json')))['entries']; N=int(sys.argv[1]) if len(sys.argv)>1 else 60
def get(url,t=30):
    req=urllib.request.Request(url,headers={'User-Agent':'subtext-eval (archive.org lookup)'})
    with urllib.request.urlopen(req,timeout=t) as r: return r.read()
random.seed(31); pools={'coi':[],'hagezi':[]}
for d,rows in data.items():
    s=rows[0]['s']
    if s=='coi' and rows[0].get('d'): pools['coi'].append((d,rows[0]['d']))
    elif s=='hagezi' and d.count('.')==1: pools['hagezi'].append((d,None))
idx=os.path.join(OUT,'index.json'); index=json.load(open(idx)) if os.path.exists(idx) else []; have={x['domain'] for x in index}
for src,pool in pools.items():
    random.shuffle(pool); got=sum(1 for x in index if x['source']==src)
    for d,date in pool[:N*5]:
        if got>=N: break
        if d in have: continue
        time.sleep(2.5)
        try:
            q={'url':d,'output':'json','filter':['statuscode:200','mimetype:text/html'],'collapse':'digest','limit':'-8','fl':'timestamp,original,length'}
            rows=json.loads(get('https://web.archive.org/cdx/search/cdx?'+urllib.parse.urlencode(q,doseq=True)) or b'[]')[1:]
            rows=[r for r in rows if int(r[2] or 0)>=2000 and (not date or r[0][:8]>=date.replace('-',''))]
            if not rows: time.sleep(0.4); continue
            ts,orig,_=rows[-1]
            html=get(f'https://web.archive.org/web/{ts}id_/{orig}',45)
            if len(html)<5000: time.sleep(0.4); continue
            with open(os.path.join(OUT,d+'.html'),'wb') as f: f.write(html)
            index.append({'domain':d,'source':src,'listed':date,'capture':ts,'original':orig,'bytes':len(html)}); got+=1; print(src,got,d,ts,len(html),flush=True); time.sleep(1)
        except Exception as e:
            print('skip',d,str(e)[:80],flush=True); time.sleep(90 if 'refused' in str(e) or '429' in str(e) else 2) # archive.org rate limit: back off
    json.dump(index,open(os.path.join(OUT,'index.json'),'w'),indent=0)
print('pages',len(index))
