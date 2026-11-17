#!/usr/bin/env python3
"""Measures candidate scam signals on the static HTML of the train half of eval/out-corpus/scam-sets.json, bad pages against honest small shops, both fetched from the Internet Archive the same way. Never reads the holdout half. Usage: TRANCO=/path/to/top-1m.csv python3 -I eval/scam-features.py [train]"""
import csv,html,json,os,re,sys,collections
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); SPLIT=sys.argv[1] if len(sys.argv)>1 else 'train'
S=[x for x in json.load(open(os.path.join(ROOT,'eval','out-corpus','scam-sets.json'))) if x['split']==SPLIT]
TOP=os.environ.get('TRANCO') or sys.exit('Set TRANCO to the path of a Tranco top-1m.csv file, for example: TRANCO=/path/to/top-1m.csv python3 -I eval/scam-features.py')
slds=set()
for r in csv.reader(open(TOP)):
    if int(r[0])>50000: break
    p=r[1].split('.')
    if len(p[0])>=5: slds.add(p[0])
WORDS=set(w.strip().lower() for w in open('/usr/share/dict/words')) if os.path.exists('/usr/share/dict/words') else set()
GEO='cz sk pl de at ch uk nz au ca us usa fr es it nl be se no dk fi hu ro bg gr pt ie eu finland suomi norge sverige danmark deutschland osterreich schweiz france espana italia nederland belgie polska cesko czech slovensko magyar montreal toronto london paris praha berlin wien sydney melbourne auckland dublin'.split()
SALE='shop store shops stores outlet outlets sale sales online eshop cheap deal deals discount official boutique mall market buy clearance factory'.split()
SUFF=sorted(GEO+SALE,key=len,reverse=True)
def brand_domain(d):
    sld=d.split('.')[0].replace('-','')
    if sld in slds: return None
    for _ in [0]:
        cur=sld;removed=[]
        changed=True
        while changed:
            changed=False
            for w in SUFF:
                if cur.endswith(w) and len(cur)-len(w)>=4: cur=cur[:-len(w)];removed.append(w);changed=True;break
                if cur.startswith(w) and len(cur)-len(w)>=4: cur=cur[len(w):];removed.append(w);changed=True;break
        if removed and cur in slds and cur not in WORDS: return cur
    return None
SOCIAL=re.compile(r'https?://(?:www\.)?(facebook|instagram|twitter|x|youtube|pinterest|tiktok|linkedin)\.com(/[^"\'\s>]*)?',re.I)
def features(x):
    b=open(os.path.join(ROOT,x['file']),'rb').read().decode('utf8','ignore'); low=b.lower(); dom=x['domain']
    t=re.search(r'<title[^>]*>(.*?)</title>',b,re.S|re.I); title=html.unescape(t.group(1)).strip().lower() if t else ''
    text=re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',re.sub(r'(?is)<(script|style|noscript)[^>]*>.*?</\1>',' ',b)))).strip(); tl=text.lower()
    f={}
    f['brand_in_domain']=bool(brand_domain(dom))
    socials=[(m.group(1).lower(),(m.group(2) or '').strip('/')) for m in SOCIAL.finditer(b)]
    real=[s for s in socials if s[1] and not re.match(r'(sharer|share|intent|dialog|tr|plugins|embed|watch|p/|pin/create|shareArticle|hashtag)',s[1],re.I)]
    f['social_dead']=bool(socials) and not real
    f['social_none']=not socials
    f['social_real']=bool(real)
    f['hash_social_icon']=bool(re.search(r'<a[^>]+href=["\']#["\'][^>]*(facebook|instagram|twitter|youtube|pinterest)',low))
    words=len(re.findall(r'\b(sale|outlet|cheap|discount|clearance|levn|sleva|slevy|výprodej|vyprodej|ale|tilbud|rabatt|günstig|gunstig|pas cher|solde|soldes|oferta|barato|goedkoop|online shop|online store|eshop|e-shop|obchod)\w*',title))
    tok=dom.split('.')[0].replace('-','')
    f['title_stuff']=words>=2
    f['title_brand_repeat']=len(re.findall(r'\b([a-z]{4,})\b.*\b\1\b',title))>0 and words>=1
    f['title_country']=bool(re.search(r'\b(cz|sk|pl|nz|uk|au|ca|finland|suomi|norge|sverige|danmark|deutschland|österreich|schweiz|france|italia|españa|nederland|polska|česká republika|praha|canada|australia|ireland)\b',title)) and words>=1
    f['no_prescription']=bool(re.search(r'(without (a )?prescription|no prescription|bez předpisu|bez receptu|sans ordonnance|ohne rezept|sin receta|senza ricetta|χωρισ συνταγη|χωρίς συνταγή|zonder recept)',tl))
    f['gambling_words']=len(re.findall(r'\b(casino|kasino|slots?|sportsbook|betting|poker|freispiele|bonus code|澳门|彩票)\b',tl))>=5
    f['pay_protected']=bool(re.search(r'paypal|apple ?pay|google ?pay|klarna|shop ?pay|amazon ?pay',low))
    f['pay_card']=bool(re.search(r'visa|mastercard|master card|american express|amex',low))
    f['pay_only_transfer']=bool(re.search(r'bank transfer|wire transfer|western union|bitcoin|crypto|zelle|gift card|banktransfer|bankovní převod',low)) and not f['pay_protected'] and not f['pay_card']
    f['address']=bool(re.search(r'\b\d{3}\s?\d{2}\b.{0,40}|\b\d{4,5}\s+[A-ZÄÖÜ][a-zäöü]+',text[-6000:]))
    f['company_form']=bool(re.search(r'\b(s\.r\.o\.|a\.s\.|gmbh|ug \(|ltd\.?|llc|inc\.|b\.v\.|sarl|s\.a\.|sp\. z o\.o\.|kg\b|ag\b|ičo|ič:|ust-?id|vat|dič|handelsregister|hrb)',tl))
    f['phone']=bool(re.search(r'tel:|\+\d{1,3}[\s-]?\d{2,3}[\s-]?\d{3}',low))
    f['imprint']=bool(re.search(r'impressum|obchodní podmínky|obchodni-podminky|kontakty|algemene voorwaarden|agb|widerruf',low))
    f['stock_free_text']=len(tl)<1500
    f['big_discount']=len(re.findall(r'-\s?(6|7|8|9)\d\s?%|(6|7|8|9)\d\s?% off',tl))>=3
    f['generator']=(re.search(r'<meta[^>]+generator[^>]+content=["\']([^"\']{2,40})',low) or [None,''])[1].split(' ')[0]
    f['_assets']=set(re.sub(r'\d+','#',m) for m in re.findall(r'(?:src|href)=["\'](?:https?:)?(?://[^/"\']+)?(/[^"\'?#]{6,80}\.(?:js|css))',low))
    f['_scripts']=set(re.findall(r'https?://([a-z0-9.-]+\.[a-z]{2,})/',low))-{dom}
    return f
F=[(x,features(x)) for x in S]
bad=[z for z in F if z[0]['set']=='bad']; hon=[z for z in F if z[0]['set']=='honest']
print('pages bad',len(bad),'honest',len(hon),'kinds',collections.Counter(x['kind'] for x,_ in bad).most_common())
keys=[k for k in F[0][1] if not k.startswith('_') and k!='generator']
rows=[]
for k in keys:
    a=sum(1 for _,f in bad if f[k]); b=sum(1 for _,f in hon if f[k]); rows.append((k,a,b,a/max(1,len(bad)),b/max(1,len(hon))))
for r in sorted(rows,key=lambda r:-(r[3]-r[4])): print(f'{r[0]:20s} bad {r[1]:4d} {r[3]:5.0%}   honest {r[2]:4d} {r[4]:5.0%}')
print('brand hits',[ (x['domain'],brand_domain(x['domain'])) for x,f in F if f['brand_in_domain']][:40])
print('honest brand hits',[ (x['domain'],brand_domain(x['domain'])) for x,f in hon if f['brand_in_domain']])
# shared code across bad pages that honest pages lack: the kit signal, kept only if it recurs across unrelated domains
for field,n in (('_assets',4),('_scripts',4)):
    c=collections.Counter(); h=collections.Counter()
    for _,f in bad:
        for a in f[field]: c[a]+=1
    for _,f in hon:
        for a in f[field]: h[a]+=1
    print(field,[(a,v,h[a]) for a,v in c.most_common(400) if v>=n and h[a]==0][:40])
print('generators bad',collections.Counter(f['generator'] for _,f in bad).most_common(12)); print('generators honest',collections.Counter(f['generator'] for _,f in hon).most_common(8))
print('--- combinations on this half')
def combos(f):
    nosoc=not f['social_real']; noph=not f['phone']; noco=not f['company_form']; noimp=not f['imprint']; noaddr=not f['address']
    return {
     'A nosocial+nophone': nosoc and noph,
     'B nosocial+nophone+nocompany': nosoc and noph and noco,
     'C nosocial+nophone+nocompany+noimprint': nosoc and noph and noco and noimp,
     'D C+noaddress': nosoc and noph and noco and noimp and noaddr,
     'E title_country or title_brand_repeat': f['title_country'] or f['title_brand_repeat'],
     'F E or D': f['title_country'] or f['title_brand_repeat'] or (nosoc and noph and noco and noimp and noaddr),
     'G E or C': f['title_country'] or f['title_brand_repeat'] or (nosoc and noph and noco and noimp),
     'H dead social + (nophone or nocompany)': f['social_dead'] and (noph or noco),
     'I G or H': f['title_country'] or f['title_brand_repeat'] or (nosoc and noph and noco and noimp) or (f['social_dead'] and noph and noco),
     'J B or E': (nosoc and noph and noco) or f['title_country'] or f['title_brand_repeat'],
    }
names=list(combos(F[0][1]))
for n in names:
    a=[x['domain'] for x,f in bad if combos(f)[n]]; b=[x['domain'] for x,f in hon if combos(f)[n]]
    print(f'{n:44s} bad {len(a):3d}/{len(bad)} {len(a)/max(1,len(bad)):4.0%}  honest {len(b):3d}/{len(hon)} {len(b)/max(1,len(hon)):4.0%}', b[:6])
