#!/usr/bin/env python3
"""The corpus HARs were recorded before Subtext read ads.txt, so replay would abort that request. This keeps one copy per site in eval/corpus-ads/ (gitignored). corpus-run.js serves it. Usage: python3 -I eval/corpus-ads.py"""
import json,os,urllib.request,concurrent.futures as cf
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT=os.path.join(ROOT,'eval','corpus-ads'); os.makedirs(OUT,exist_ok=True)
hosts=sorted({p['url'].split('/')[2] for p in json.load(open(os.path.join(ROOT,'eval','real','corpus-pages.json')))})
def reg(h):
    h=h.replace('www.',''); return h
def get(h):
    for host in (reg(h),'www.'+reg(h)):
        try:
            r=urllib.request.Request('https://'+host+'/ads.txt',headers={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36','Accept':'text/plain,*/*'})
            with urllib.request.urlopen(r,timeout=15) as f:
                b=f.read(600000)
                if f.status==200: open(os.path.join(OUT,reg(h)+'.txt'),'wb').write(b); return h,len(b)
        except Exception: pass
    return h,0
with cf.ThreadPoolExecutor(8) as ex: res=list(ex.map(get,hosts))
print('hosts',len(res),'with a file',sum(1 for _,n in res if n))
