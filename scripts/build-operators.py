#!/usr/bin/env python3
"""Builds extension/data/operators.json: which company runs a domain, from the public sellers.json files of ad exchanges.
An exchange's sellers.json lists the publishers it pays, with each publisher's domain and the name on its contract. A row is kept only when
the name carries a company legal form (so private bloggers' personal names are never shipped), and records how many exchanges list that
same name for that domain. Input: a JSON map domain -> {name: count} made from the sellers.json files (research script fetch_sellers.py + count_sellers.py),
and the date those files were fetched. Usage: python3 -I scripts/build-operators.py <seller_domain_names.json> <fetched YYYY-MM-DD>"""
import json,os,re,sys,unicodedata
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src=json.load(open(sys.argv[1])); fetched=sys.argv[2]
FORM=re.compile(r"\b(inc|incorporated|llc|l\.l\.c|ltd|limited|plc|gmbh|ag|se|kg|s\.?a\.?s?|sarl|s\.?r\.?l|s\.?p\.?a|b\.?v|n\.?v|pty|corp|corporation|co\.?,? ltd|oy|ab|as|a/s|aps|kft|d\.o\.o|sp\.? z o\.?o|s\.r\.o|a\.s|lda|s\.l|kk|k\.k|pvt|private limited|llp|lp|gk|company)\.?$",re.I)
BUSINESS=r'(media|group|games?|labs?|studios?|digital|network|networks|publishing|ventures|holdings|partners|solutions|tech|technologies|software|systems|interactive|entertainment|productions|press|news|online|marketing|ventures|capital|consulting|services|international|global|company|enterprises|industries|brands|collective|works|creative|apps?|web|sports?|travel|health|foods?|communications|broadcasting|radio|tv|magazine|records)'
PERSON=re.compile(r'^(?:[A-Z][a-z]+)(?: [A-Z]\.?)? (?!(?i:'+BUSINESS+r')\b)[A-Z][a-z]+(?:-[A-Z][a-z]+)?$')
def norm(n):
    n=unicodedata.normalize('NFKC',n).strip().strip('.,').lower(); n=re.sub(r'[^\w&]+',' ',n); n=re.sub(r'\b(inc|incorporated|llc|l l c|ltd|limited|plc|gmbh|corp|corporation|co|company|the)\b',' ',n)
    return re.sub(r'\s+',' ',n).strip()
out={}
for dom,names in src.items():
    if not re.match(r'^[a-z0-9.-]+\.[a-z]{2,}$',dom): continue
    good={n:c for n,c in names.items() if FORM.search(n.strip()) and len(n)<=80 and not re.search(r'@|https?:',n)}
    good={n:c for n,c in good.items() if not PERSON.match(FORM.sub('',n.strip()).strip(' ,.'))}  # 'Jane Smith LLC' names a person: never shipped
    if not good: continue
    groups={}
    for n,c in good.items(): groups.setdefault(norm(n),[]).append((c,n))
    key,members=max(groups.items(),key=lambda kv:sum(c for c,_ in kv[1]))
    count=sum(c for c,_ in members); best=max(members)[1].strip()
    if not key: continue
    out[dom]=[best,count]
data={'built':fetched,'notes':'domain -> [company name on its ad-exchange contracts, how many exchange listings carry that name]. From the public sellers.json files of 27 ad exchanges, fetched '+fetched+'. Only names with a company legal form are kept. The company that runs the site day to day; its owner may be a parent company. Built by scripts/build-operators.py.','domains':dict(sorted(out.items()))}
p=os.path.join(ROOT,'extension','data','operators.json'); json.dump(data,open(p,'w'),separators=(',',':'),ensure_ascii=False)
print('domains',len(out),'with 2+ listings',sum(1 for v in out.values() if v[1]>=2),'bytes',os.path.getsize(p))
