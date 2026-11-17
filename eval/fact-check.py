#!/usr/bin/env python3
"""Truth check for the shop facts (the owner, 2026-11-06: describe, don't categorise; no human labelling).
Every fact the extension states as an absence ("no phone", "no company name", "no social profile") is false if the page shows the thing.
A second reader (Claude Haiku) is asked to find each thing and copy it exactly; code keeps an answer only if the copied text is really on the page.
A kept answer against a stated absence is a false fact. Reads eval/out-corpus/<label>-scam-<split>.json and the archived HTML; writes eval/out-corpus/<label>-factcheck.json.
Usage: python3 -I eval/fact-check.py <label> <split> [<split> ...]   Needs SUBTEXT_ANTHROPIC_KEY_FILE set to a file that holds an Anthropic key. Cost: about a third of a cent per page."""
import html,json,os,re,sys,urllib.request,concurrent.futures as cf
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); label=sys.argv[1]; splits=sys.argv[2:]
KEY=open(os.environ.get('SUBTEXT_ANTHROPIC_KEY_FILE') or sys.exit('Set SUBTEXT_ANTHROPIC_KEY_FILE to a file that holds an Anthropic key.')).read().strip()
S={x['domain']:x for x in json.load(open(os.path.join(ROOT,'eval','out-corpus','scam-sets.json')))}
SOC=re.compile(r'https?://(?:www\.)?(?:facebook|instagram|twitter|x|youtube|pinterest|tiktok|linkedin)\.com/[^"\'\s>]*',re.I)
def page(d):
    b=open(os.path.join(ROOT,S[d]['file']),'rb').read().decode('utf8','ignore')
    vis=re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',re.sub(r'(?is)<(script|style|noscript|template)[^>]*>.*?</\1>',' ',b)))).strip()
    links=sorted(set(SOC.findall(b)))[:40]; tels=sorted(set(re.findall(r'href=["\']tel:([^"\']+)',b,re.I)))[:5]
    anchors=[]
    for m in re.finditer(r'<a\b[^>]*href=["\']([^"\'#][^"\']*)["\'][^>]*>(.*?)</a>',b,re.I|re.S):
        t=re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',m.group(2)))).strip()[:60]; h=html.unescape(m.group(1))[:120]
        if (h,t) not in anchors: anchors.append((h,t))
    return vis,links,tels,anchors[:250]
SYSTEM='You check facts about a web shop page. Copy text exactly as it appears; never write text that is not in the input. Answer with JSON only.'
def ask(d):
    vis,links,tels,anchors=page(d); text=vis if len(vis)<=14000 else vis[:5000]+' … '+vis[-9000:]
    user=('PAGE TEXT:\n'+text+'\n\nSOCIAL LINKS IN THE HTML:\n'+('\n'.join(links) or '(none)')+'\n\nPHONE LINKS (tel:):\n'+(', '.join(tels) or '(none)')+'\n\nALL LINKS (url | text):\n'+'\n'.join(h+' | '+t for h,t in anchors)+
      '\n\nFind, for the business running this shop:\n1. phone: a phone number of the shop, copied exactly from PAGE TEXT or PHONE LINKS, or null.\n'
      '2. company: the legal name of the company with its legal form (for example "Acme Ltd", "Novák s.r.o.", "Muster GmbH"), or a company registration, VAT or IČO number, copied exactly from PAGE TEXT, or null. A domain name or brand name alone is not a company.\n'
      '2b. address: a postal street address of the business, copied exactly from PAGE TEXT, or null.\n'
      '3. social: one link from SOCIAL LINKS that goes to this shop\'s own profile (not a share button, not the network\'s home page, not a different company), copied exactly, or null.\n'
      '4. terms: a link to the shop\'s terms of sale, general conditions, legal notice or imprint (any language, for example AGB, Impressum, algemene voorwaarden, obchodní podmínky), copied exactly as its url from ALL LINKS, or null.\n'
      'Reply as {"phone": ..., "company": ..., "address": ..., "social": ..., "terms": ...}')
    body=json.dumps({'model':'claude-haiku-5-5','max_tokens':1000,'system':SYSTEM,'messages':[{'role':'user','content':user}]}).encode()
    req=urllib.request.Request('https://api.anthropic.com/v1/messages',data=body,headers={'x-api-key':KEY,'anthropic-version':'2023-06-01','content-type':'application/json'})
    for _ in range(3):
        try:
            r=json.load(urllib.request.urlopen(req,timeout=90)); t=''.join(c.get('text','') for c in r['content'])
            j=json.loads(re.search(r'\{.*\}',t,re.S).group(0)); break
        except Exception as e: j={'error':str(e)[:120],'text':(locals().get('t') or '')[:200]}
    norm=lambda s: re.sub(r'\s+',' ',str(s)).strip().lower()
    hay=norm(vis); raw=norm(' '.join(links+tels+[h for h,_ in anchors]))
    kept={}
    for k in ('phone','company','address','social','terms'):
        v=j.get(k)
        if v and len(norm(v))>=5 and (norm(v) in hay or norm(v) in raw): kept[k]=str(v)[:120]
    return d,kept,j
rows=[]
for sp in splits:
    rows+=[r for r in json.load(open(os.path.join(ROOT,'eval','out-corpus',f'{label}-scam-{sp}.json'))) if r.get('shop') and not r.get('error')]
out=[]
with cf.ThreadPoolExecutor(6) as ex:
    for d,kept,j in ex.map(ask,[r['domain'] for r in rows]): out.append({'domain':d,'kept':kept,'answer':j})
by={o['domain']:o for o in out}
stated={'phone':0,'company':0,'social':0,'terms':0}; false={'phone':[],'company':[],'social':[],'terms':[]}; present={'phone':[0,0],'company':[0,0],'social':[0,0],'terms':[0,0]}; errors=sum(1 for o in out if 'error' in o['answer'])
for r in rows:
    s=r['shop']; k=by[r['domain']]['kept']
    k=dict(k); co=k.get('company') or k.get('address')
    if co: k['company']=co
    for fact,absent in (('phone',not s['phone']),('company',not s['named']),('social',s['social']!='real'),('terms',not s['terms'])):
        if absent:
            stated[fact]+=1
            if fact in k: false[fact].append((r['domain'],r['set'],k[fact]))
        else:  # how often the reader finds a thing the extension found: a missed quote proves nothing, so this sets how much the false counts can be trusted
            present[fact][0]+=1; present[fact][1]+=int(fact in k)
json.dump({'rows':out,'stated':stated,'false':false,'present':present},open(os.path.join(ROOT,'eval','out-corpus',f'{label}-factcheck.json'),'w'),indent=1,ensure_ascii=False)
print('shop pages',len(rows),'reader errors',errors)
for f in stated: print(f'no {f}: stated on {stated[f]} pages, shown false on {len(false[f])}; reader found it on {present[f][1]} of {present[f][0]} pages where the extension found it'); [print('   ',x) for x in false[f]]
