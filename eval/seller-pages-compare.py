#!/usr/bin/env python3
"""Compares two scam-run results, before and after the follow-the-links seller check, on the shops that have archived own pages
(eval/corpus-seller/index.json): how many 'no company name' and 'no phone' statements went away, on listed and honest shops, and whether
each company name the check reports appears in the archived page it came from. Usage: python3 -I eval/seller-pages-compare.py <before label> <after label>"""
import json,os,re,sys,html
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); B,A=sys.argv[1],sys.argv[2]
idx=json.load(open(os.path.join(ROOT,'eval','corpus-seller','index.json')))
def load(l): return {r['domain']:r for sp in ('holdout','fresh') if os.path.exists(os.path.join(ROOT,'eval','out-corpus',f'{l}-scam-{sp}.json')) for r in json.load(open(os.path.join(ROOT,'eval','out-corpus',f'{l}-scam-{sp}.json')))}
b,a=load(B),load(A)
for st in ('bad','honest'):
    doms=[d for d,r in a.items() if r['set']==st and r.get('shop') and d in idx and idx[d]['pages'] and d in b and b[d].get('shop')]
    nc_b=sum(1 for d in doms if not b[d]['shop']['named']); nc_a=sum(1 for d in doms if not a[d]['shop']['named'])
    np_b=sum(1 for d in doms if not b[d]['shop']['phone']); np_a=sum(1 for d in doms if not a[d]['shop']['phone'])
    cb=sum(1 for d in doms if (b[d].get('sellerSev') or 0)>=2); ca=sum(1 for d in doms if (a[d].get('sellerSev') or 0)>=2)
    read=sum(1 for d in doms if (a[d].get('offPage') or {}).get('fetched'))
    print(f"{st}: shops with archived own pages {len(doms)}, own pages read on {read}; 'no company name' {nc_b} -> {nc_a}; 'no phone' {np_b} -> {np_a}; seller line in top line {cb} -> {ca}")
bad=[]; ok=0
for d,r in a.items():
    o=r.get('offPage') or {}
    if not o.get('entity'): continue
    texts=' '.join(re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',open(os.path.join(ROOT,'eval','corpus-seller',p['file']),encoding='utf8',errors='ignore').read()))) for p in idx.get(d,{}).get('pages',[]) if p['file'].endswith('.html'))
    if o['entity'].split(',')[0][:25] in texts: ok+=1
    else: bad.append((d,o['entity']))
    print('  named:',d,r['set'],'|',o['entity'],'|',o.get('kind'))
print('company names found in the archived page text:',ok,'not found:',bad)
