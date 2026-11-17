#!/usr/bin/env python3
"""Fetches archived copies of each test shop's own contact, legal-notice, terms and about pages, plus robots.txt and sitemap.xml,
from the Internet Archive only (never the live site), near the date of the archived home page. Lets eval/scam-run.js serve them
so the follow-the-links seller check can be measured. Writes eval/corpus-seller/<domain>/NN.html and eval/corpus-seller/index.json.
Usage: python3 -I eval/seller-pages-fetch.py <split> [<split> ...]   (splits of eval/out-corpus/scam-sets.json)
       python3 -I eval/seller-pages-fetch.py --missed <label>   (also fetch the same-site pages a replay asked for and did not get: eval/out-corpus/<label>-scam-*.json)"""
import html,json,os,re,sys,time,hashlib,urllib.request,urllib.parse
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT=os.path.join(ROOT,'eval','corpus-seller'); os.makedirs(OUT,exist_ok=True)
IDX=os.path.join(OUT,'index.json'); index=json.load(open(IDX)) if os.path.exists(IDX) else {}
WORDS=re.compile(r'impressum|imprint|legal|kontakt|contact|about|o-nas|over-ons|ueber|uber-uns|qui-sommes|quienes|terms|conditions|voorwaarden|podminky|podmienky|agb|bedingungen|condiciones|condizioni|regulamin|villkor|provozovatel|prevadzkovatel|colofon|company|firma|mentions|aviso|policy|privacy|datenschutz|ochrana|privacidad|faq|help|service',re.I)
UA='Mozilla/5.0 (research; Subtext evaluation)'
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':UA})
    for i in range(3):
        try:
            with urllib.request.urlopen(req,timeout=40) as r: return r.geturl(), r.read(3_000_000)
        except urllib.error.HTTPError as e:
            if e.code in (404,403,410): return None,None
            time.sleep(3*(i+1))
        except Exception: time.sleep(3*(i+1))
    return None,None
ALL={x['domain']:x for x in json.load(open(os.path.join(ROOT,'eval','out-corpus','scam-sets.json')))}
if sys.argv[1]=='--missed':
    import glob
    for f in glob.glob(os.path.join(ROOT,'eval','out-corpus',sys.argv[2]+'-scam-*.json')):
        for r in json.load(open(f)):
            d=r['domain']; x=ALL[d]; have={g['url'] for g in index.get(d,{}).get('pages',[])}; tried=set(index.get(d,{}).get('tried',[]))
            todo=[u for u in (r.get('missed') or []) if u not in have and u not in tried][:8]
            if not todo: continue
            ent=index.setdefault(d,{'set':x['set'],'split':x['split'],'candidates':0,'pages':[]}); ent.setdefault('tried',[])
            for u in todo:
                ent['tried'].append(u); final,body=get('https://web.archive.org/web/'+x['capture']+'id_/'+u); time.sleep(1.2)
                if not body: continue
                m=re.search(r'/web/(\d{14})',final or ''); ts=m.group(1) if m else ''
                if ts and abs(int(ts[:4])-int(x['capture'][:4]))>1: continue
                n=len(os.listdir(os.path.join(OUT,d))) if os.path.isdir(os.path.join(OUT,d)) else 0
                fn=f'm{n:02d}'+('.xml' if '.xml' in u else '.txt' if u.endswith('.txt') else '.html'); os.makedirs(os.path.join(OUT,d),exist_ok=True)
                open(os.path.join(OUT,d,fn),'wb').write(body); ent['pages'].append({'url':u,'file':d+'/'+fn,'capture':ts})
            json.dump(index,open(IDX,'w'),indent=1); print(d,'missed',len(todo),'now',len(ent['pages']),flush=True)
    sys.exit(0)
S=[x for x in ALL.values() if x['split'] in sys.argv[1:]]
if os.environ.get('LIMIT'): S=S[:int(os.environ['LIMIT'])]
for x in S:
    d=x['domain']
    if d in index: continue
    b=open(os.path.join(ROOT,x['file']),'rb').read().decode('utf8','ignore'); base=x['original']; host=urllib.parse.urlparse(base).hostname or d
    reg=lambda h: '.'.join((h or '').lower().split('.')[-2:])
    cands=[]
    for m in re.finditer(r'<a\b[^>]*href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>',b,re.I|re.S):
        try: u=urllib.parse.urljoin(base,html.unescape(m.group(1)).strip())
        except Exception: continue
        p=urllib.parse.urlparse(u)
        if p.scheme not in ('http','https') or reg(p.hostname)!=reg(host): continue
        t=re.sub(r'<[^>]+>',' ',m.group(2))
        if (WORDS.search(p.path) or WORDS.search(t)) and u.split('#')[0] not in cands and p.path not in ('','/'): cands.append(u.split('#')[0])
    cands=cands[:10]+[urllib.parse.urljoin(base,'/robots.txt'),urllib.parse.urljoin(base,'/sitemap.xml')]
    got=[]
    for i,u in enumerate(cands):
        final,body=get('https://web.archive.org/web/'+x['capture']+'id_/'+u); time.sleep(1.2)
        if not body: continue
        m=re.search(r'/web/(\d{14})',final or ''); ts=m.group(1) if m else ''
        if ts and abs(int(ts[:4])-int(x['capture'][:4]))>1: continue  # too far from the home page's date
        fn=f'{i:02d}'+('.xml' if u.endswith('.xml') else '.txt' if u.endswith('.txt') else '.html'); os.makedirs(os.path.join(OUT,d),exist_ok=True)
        open(os.path.join(OUT,d,fn),'wb').write(body); got.append({'url':u,'file':d+'/'+fn,'capture':ts})
    index[d]={'set':x['set'],'split':x['split'],'candidates':len(cands),'pages':got}
    json.dump(index,open(IDX,'w'),indent=1)
    print(d,x['set'],'candidates',len(cands),'archived',len(got),flush=True)
