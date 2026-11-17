#!/usr/bin/env python3
"""Counts how often each shop fact shows on listed and honest shops, from the extension's own run on the held-back half and the later pages
(eval/scam-run.js output), and writes them to extension/rules/dom-config.json as shopTraitRates. The train half is left out: it was tuned on.
Usage: python3 -I eval/shop-trait-rates.py <label>   (reads eval/out-corpus/<label>-scam-holdout.json and <label>-scam-fresh.json)"""
import json,os,sys
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); label=sys.argv[1]
rows=[]
for sp in ('holdout','fresh'):
    p=os.path.join(ROOT,'eval','out-corpus',f'{label}-scam-{sp}.json')
    if os.path.exists(p): rows+=[r for r in json.load(open(p)) if not r.get('error') and r.get('shop') and r.get('kind')!='hijacked_spam']
def traits(s):
    return {'social_none':s['social']=='none','social_dead':s['social']=='dead','no_phone':not s['phone'],'no_company':not s['named'],'no_terms':not s['terms'],'title_stuffed':s['titleStuffed'],'big_discounts':s['bigDiscounts'],
            'combination':s['social']!='real' and not s['phone'] and not s['named']}
bad=[traits(r['shop']) for r in rows if r['set']=='bad']; hon=[traits(r['shop']) for r in rows if r['set']=='honest']
out={'note':'Counts of shop pages showing each fact, from eval/scam-run.js on the held-back half (listed and honest) and later listed pages; train half excluded. Built by eval/shop-trait-rates.py '+label+'.','listed':len(bad),'honest':len(hon),
     'traits':{k:{'listed':sum(t[k] for t in bad),'honest':sum(t[k] for t in hon)} for k in bad[0]}}
for k,v in out['traits'].items(): print(f"{k:14s} listed {v['listed']:3d}/{out['listed']}  honest {v['honest']:3d}/{out['honest']}")
if '--write' in sys.argv:
    p=os.path.join(ROOT,'extension','rules','dom-config.json'); d=json.load(open(p)); d['shopTraitRates']=out
    json.dump(d,open(p,'w'),indent=2,ensure_ascii=False); open(p,'a').write('\n'); print('written to',p)
