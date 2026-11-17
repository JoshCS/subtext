#!/usr/bin/env python3
"""Builds extension/data/owners.json: site -> owner, from Wikidata (CC0), at release, on the maintainer's machine. The browser only reads the built file, so no visited site leaves it.
Rules: a statement with an end date is over and is dropped. Big fund managers listed as owners mean "publicly traded", not owned by them. The chain is walked up at most 4 hops, keeping each hop.
A row in data/owners-overrides.json beats Wikidata; outlets.json, the hand-made table, is read first by the extension and beats this file.
Usage: python3 -I scripts/build-owners.py <tranco top-1m.csv> [top N, default 100000]. Resumes from a cache in its scratch folder if given as WD_CACHE."""
import csv,json,os,re,sys,time,urllib.parse,urllib.request
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT=os.path.join(ROOT,'extension','data','owners.json'); OVR=os.path.join(ROOT,'data','owners-overrides.json')
EP='https://query.wikidata.org/sparql'; UA='SubtextOwnerBuilder/0.1 (open-source browser extension; release build)'; CACHE=os.environ.get('WD_CACHE')
HOLDERS=re.compile(r'blackrock|vanguard|state street|fidelity|capital (group|research)|t\. rowe|invesco|norges|geode|morgan stanley|jpmorgan|goldman|wellington management|northern trust|schwab|dimensional fund|amundi|bank of america|ubs\b|allianz global',re.I)
def sparql(q,tries=5):
    for t in range(tries):
        try:
            req=urllib.request.Request(EP,data=urllib.parse.urlencode({'query':q,'format':'json'}).encode(),headers={'User-Agent':UA,'Accept':'application/sparql-results+json'})
            with urllib.request.urlopen(req,timeout=70) as r: return json.load(r)['results']['bindings']
        except Exception as e:
            time.sleep(8*(t+1))
    raise RuntimeError('wikidata failed')
qid=lambda u:u.rsplit('/',1)[-1]
def host(u):
    try:
        p=urllib.parse.urlparse(u); h=(p.hostname or '').lower()
        if p.path.strip('/') : return None # a path means a section of a site, not the site
        return h[4:] if h.startswith('www.') else h
    except Exception: return None
def sites(batch):
    vals=' '.join('<%s://%s%s/>'%(s,w,d)+' <%s://%s%s>'%(s,w,d) for d in batch for s in('http','https') for w in('','www.'))
    q='SELECT ?item ?itemLabel ?site WHERE { VALUES ?site { %s } ?item wdt:P856 ?site . SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". } }'%vals
    return sparql(q)
def links(items):
    """owner and parent statements still in force, with facts about the owner"""
    vals=' '.join('wd:'+i for i in items)
    q='''SELECT ?item ?prop ?owner ?ownerLabel ?traded ?human ?nonprofit ?gov WHERE { VALUES ?item { %s } VALUES (?prop ?ps ?p) { ("P749" ps:P749 p:P749) ("P127" ps:P127 p:P127) }
    ?item ?p ?st . ?st ?ps ?owner . ?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank) FILTER NOT EXISTS { ?st pq:P582 ?end }
    OPTIONAL { ?owner wdt:P414 ?traded } OPTIONAL { ?owner wdt:P31 wd:Q5 . BIND(1 AS ?human) } OPTIONAL { ?owner wdt:P31/wdt:P279* wd:Q163740 . BIND(1 AS ?nonprofit) } OPTIONAL { ?owner wdt:P31/wdt:P279* wd:Q327333 . BIND(1 AS ?gov) }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". } }'''%vals
    return sparql(q)
def main():
    N=int(sys.argv[2]) if len(sys.argv)>2 else 100000
    doms=[r[1].strip().lower() for r in csv.reader(open(sys.argv[1]))][:N]
    cache=json.load(open(CACHE)) if CACHE and os.path.exists(CACHE) else {'sites':{},'done':0,'links':{}}
    for i in range(cache['done'],len(doms),80):
        for b in sites(doms[i:i+80]):
            h=host(b['site']['value'])
            if h: cache['sites'].setdefault(h,[]).append([qid(b['item']['value']),b.get('itemLabel',{}).get('value','')])
        cache['done']=i+80
        if CACHE and i%800==0:
            json.dump(cache,open(CACHE,'w')); print('sites',cache['done'],len(cache['sites']),flush=True)
        time.sleep(0.25)
    traded_items=cache.setdefault('traded',{})
    def get_traded(items):
        need=sorted({i for i in items if i not in traded_items})
        for k in range(0,len(need),300):
            part=need[k:k+300]
            for i in part: traded_items[i]=False
            for b in sparql('SELECT DISTINCT ?item WHERE { VALUES ?item { %s } ?item wdt:P414 ?x }'%' '.join('wd:'+i for i in part)): traded_items[qid(b['item']['value'])]=True
            time.sleep(0.25)
    def get_links(items):
        need=sorted({i for i in items if i not in cache['links']})
        for k in range(0,len(need),150):
            part=need[k:k+150]
            for i in part: cache['links'][i]=[]
            for b in links(part):
                cache['links'][qid(b['item']['value'])].append({'p':b['prop']['value'],'q':qid(b['owner']['value']),'name':b.get('ownerLabel',{}).get('value',''),'traded':'traded' in b,'human':'human' in b,'nonprofit':'nonprofit' in b,'gov':'gov' in b})
            time.sleep(0.25)
    frontier={it[0] for v in cache['sites'].values() for it in v}
    for hop in range(4):
        get_links(frontier)
        frontier={o['q'] for i in frontier for o in cache['links'].get(i,[])}
        if CACHE: json.dump(cache,open(CACHE,'w'))
        print('hop',hop,len(frontier),flush=True)
    get_traded({it[0] for v in cache['sites'].values() for it in v})
    if CACHE: json.dump(cache,open(CACHE,'w'))
    def best(q):
        L=[o for o in cache['links'].get(q,[]) if o['q']!=q and not re.fullmatch(r'Q\d+',o['name'] or 'Q0')]
        real=[o for o in L if not HOLDERS.search(o['name'])]
        parents=[o for o in real if o['p']=='P749']; owners=[o for o in real if o['p']=='P127']
        uniq={o['q'] for o in parents} or {o['q'] for o in owners}
        pick=parents or owners
        if not pick: return None,bool(L)
        if len(uniq)>1: return None,False # several parents or owners: leave it out rather than choose one
        return pick[0],False
    rows={}
    for h,items in cache['sites'].items():
        qs={i[0] for i in items}
        if len(qs)>1: continue # one address, several items: not safe to choose
        q,label=items[0]
        if re.fullmatch(r'Q\d+',label or 'Q0'): continue
        chain=[]; cur=q; seen={q}; traded=bool(traded_items.get(q))
        # a listed company is owned by its shareholders: the walk stops there, so a big holder (a founder, a fund) is never called the owner
        for _ in range(4):
            if traded and not chain: break
            o,hold=best(cur); traded=traded or hold
            if not o or o['q'] in seen or o['human']: break # a person listed as owner is often a founder or big holder: left out unless a hand row says so
            chain.append(o); seen.add(o['q']); cur=o['q']
            if o['traded']: break
        if not chain and not traded: continue
        row={'site':label,'q':q}
        if chain:
            top=chain[-1]; row.update({'top':top['name'],'kind':'nonprofit' if top['nonprofit'] else 'government' if top['gov'] else 'public_company' if top['traded'] else 'organisation'})
        else: row['kind']='publicly_traded'
        rows[h]=row
    ovr=json.load(open(OVR)) if os.path.exists(OVR) else {'entries':{}}
    for h,e in ovr['entries'].items():
        if e.get('remove'): rows.pop(h,None)
        else: rows[h]=e
    json.dump({'source':'Wikidata (CC0), with corrections in data/owners-overrides.json','built':time.strftime('%Y-%m-%d'),'top':N,'rows':rows},open(OUT,'w'),ensure_ascii=False,separators=(',',':'))
    print('rows',len(rows),'bytes',os.path.getsize(OUT))
main()
