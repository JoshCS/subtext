#!/usr/bin/env python3
"""Builds a judging sample from a corpus run: up to N instances per rule, plus each page's reading. Usage: python3 eval/judge-sample.py <run.json> <outdir> [N]"""
import json,sys,random,collections
run,out=sys.argv[1],sys.argv[2]; N=int(sys.argv[3]) if len(sys.argv)>3 else 5
R=[r for r in json.load(open(run)) if not r.get('error') and not (r.get('meta') or {}).get('errorPage') and (r.get('chars') or 0)>=300]
random.seed(7); by=collections.defaultdict(list); pages=[]
for r in R:
    pages.append({'page':r['name'],'group':r['group'],'url':r['url'],'title':r.get('title'),'grade':r.get('grade'),'score':r.get('score'),'reading':r.get('reading'),'outlet':r.get('outlet'),'asks':{k:v for k,v in (r['meta'].get('asks') or {}).items() if k in('ads','pixels','affiliate','subscription','newsletter','support','commerce','marketing','consentOrPay')},'pageKind':r['meta'].get('pageKind')})
    for f in r['findings']:
        if f['severity']<=0 or f['id'].startswith('tracker.') or f['id'].startswith('source.ownership'): continue
        by[f['id']].append({'rule':f['id'],'page':r['name'],'group':r['group'],'url':r['url'],'label':f['label'],'why':f['why'],'severity':f['severity'],'count':f['count'],'evidence':[{'quote':str(e.get('quote'))[:260],'match':e.get('match')} for e in f['evidence'][:2]]})
sample=[]
for rid,l in sorted(by.items()):
    random.shuffle(l); sample+=l[:N]
for i,s in enumerate(sample): s['n']=i
json.dump(sample,open(out+'/instances.json','w'),indent=0); json.dump(pages,open(out+'/readings.json','w'),indent=0)
print(len(sample),'instances from',len(by),'rules;',len(pages),'pages'); print('fire counts:',json.dumps({k:len(v) for k,v in sorted(by.items(),key=lambda kv:-len(kv[1]))}))
