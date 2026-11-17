#!/usr/bin/env python3
"""Builds extension/data/buyouts.json: sites whose company Wikidata says is owned by a private equity firm, with the year the ownership began
and the reference Wikidata gives, if any. These are LEADS: they show in the Source card as "per Wikidata, not yet checked against a closing
announcement", never in the one-line summary (the owner, 2026-11-06: a private equity buyout is useful subtext, stated as a dated, sourced fact).
Firms: items typed as private equity firm (Q5418962) or in the private equity industry (Q476115), plus large firms Wikidata does not type that way.
Query runs on the QLever Wikidata mirror (the main query service rate-limits). Usage: python3 -I scripts/build-buyouts.py [--from-owners]   (--from-owners: when the query service refuses, take the rows of extension/data/owners.json whose top owner is a listed firm; those carry no year)"""
import json,os,re,urllib.request,urllib.parse,datetime
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTRA=['Blackstone Inc.','Blackstone','KKR','Kohlberg Kravis Roberts','Carlyle Group','The Carlyle Group','TPG Inc.','TPG Capital','Bain Capital','Vista Equity Partners','Silver Lake','Silver Lake Partners','Apollo Global Management','Thoma Bravo','EQT','EQT AB','Advent International','Warburg Pincus','Hellman & Friedman','CVC Capital Partners','Permira','Cinven','BC Partners','Clayton, Dubilier & Rice','Leonard Green & Partners','General Atlantic','Francisco Partners','Insight Partners','Platinum Equity','Sycamore Partners','Cerberus Capital Management','Brookfield Asset Management','Ares Management','Onex','Apax Partners','PAI Partners','Searchlight Capital','Alden Global Capital','Fortress Investment Group','Providence Equity Partners','Clearlake Capital','Stone Point Capital','Hg','HgCapital','3i','Nordic Capital','Triton Partners','Bridgepoint','Charlesbank Capital Partners','Roark Capital','Golden Gate Capital','Vector Capital','Siris Capital','Veritas Capital','Madison Dearborn Partners','Genstar Capital','Kelso & Company','Lindsay Goldberg','Sun Capital Partners','H.I.G. Capital','Oaktree Capital Management','Pamplona Capital Management','TA Associates','Summit Partners','Accel-KKR','Marlin Equity Partners','Vector Capital Management','Trilantic Capital Partners']
vals=' '.join(json.dumps(n)+'@en' for n in EXTRA)
Q="""PREFIX wd: <http://www.wikidata.org/entity/> PREFIX wdt: <http://www.wikidata.org/prop/direct/> PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/> PREFIX pq: <http://www.wikidata.org/prop/qualifier/> PREFIX pr: <http://www.wikidata.org/prop/reference/>
PREFIX prov: <http://www.w3.org/ns/prov#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?item ?itemLabel ?site ?firm ?firmLabel ?start ?ref WHERE {
  { ?firm wdt:P31/wdt:P279* wd:Q5418962 } UNION { ?firm wdt:P452 wd:Q476115 } UNION { VALUES ?fl { %s } ?firm rdfs:label ?fl }
  { ?item p:P127 ?st . ?st ps:P127 ?firm } UNION { ?item p:P749 ?st . ?st ps:P749 ?firm }
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  ?item wdt:P856 ?site .
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?st prov:wasDerivedFrom/pr:P854 ?ref }
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel)="en")
  ?firm rdfs:label ?firmLabel . FILTER(LANG(?firmLabel)="en")
}""" % vals
u='https://qlever.dev/api/wikidata?'+urllib.parse.urlencode({'query':Q})
import sys,time
if '--from-owners' in sys.argv:
    rows=json.load(open(os.path.join(ROOT,'extension','data','owners.json')))['rows']; low={f.lower() for f in EXTRA}; out={}
    for dom,r in rows.items():
        top=str(r.get('top') or r.get('owner') or '')
        if top.lower() in low: out[dom]=[top,'','',r.get('q',''),r.get('site','')]
    data={'built':datetime.date.today().isoformat(),'notes':'domain -> [private equity firm, year ownership began (blank: not in this build), reference URL (blank), Wikidata item, site]. From extension/data/owners.json (Wikidata, CC0) where the top owner is a listed private equity firm. Leads, not checked against a closing announcement. Built by scripts/build-buyouts.py --from-owners.','domains':dict(sorted(out.items()))}
    p=os.path.join(ROOT,'extension','data','buyouts.json'); json.dump(data,open(p,'w'),separators=(',',':'),ensure_ascii=False); print('domains',len(out),'bytes',os.path.getsize(p)); sys.exit(0)
for attempt in range(6):
    try: d=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Subtext-build/0.1','Accept':'application/sparql-results+json'}),timeout=300)); break
    except urllib.error.HTTPError as e:
        if e.code!=429 or attempt==5: raise
        time.sleep(30*(attempt+1))
rows=d['results']['bindings']; out={}
for b in rows:
    site=b['site']['value']; m=re.match(r'https?://(?:www\.)?([^/:]+)',site)
    if not m: continue
    dom=m.group(1).lower(); start=b.get('start',{}).get('value','')[:4]; ref=b.get('ref',{}).get('value','')
    row=[b['firmLabel']['value'],start,ref,b['item']['value'].rsplit('/',1)[1],b['itemLabel']['value']]
    prev=out.get(dom)
    if not prev or (start and (not prev[1] or start>prev[1])): out[dom]=row  # the most recent dated owner wins
data={'built':datetime.date.today().isoformat(),'notes':'domain -> [private equity firm, year ownership began (blank if Wikidata gives none), reference URL Wikidata cites (blank if none), Wikidata item, company]. Leads from Wikidata (CC0), not checked against a closing announcement. Built by scripts/build-buyouts.py.','domains':dict(sorted(out.items()))}
p=os.path.join(ROOT,'extension','data','buyouts.json'); json.dump(data,open(p,'w'),separators=(',',':'),ensure_ascii=False)
print('rows',len(rows),'domains',len(out),'with a year',sum(1 for v in out.values() if v[1]),'with a reference',sum(1 for v in out.values() if v[2]),'bytes',os.path.getsize(p))
for k,v in list(out.items())[:12]: print(k,v[:3])
