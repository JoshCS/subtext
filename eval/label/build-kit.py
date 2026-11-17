#!/usr/bin/env python3
"""Builds the labelling kit from a replay of the frozen pool: a random sample of the flags readers would really see (severity above 0), a screenshot of each page, and the page in kit.html. Works by opening index.html; no server.
Each labeller gets their own order and saves their own file. Usage: python3 -I eval/label/build-kit.py <run.json> <shots dir> <out dir> [flags=150] [top lines=60]"""
import json,os,random,shutil,sys
run,shots,out=sys.argv[1:4]; N=int(sys.argv[4]) if len(sys.argv)>4 else 150
R=[r for r in json.load(open(run)) if not r.get('error')]
all_flags=[]
for r in R:
    for k,f in enumerate(r['findings']):
        if f['severity']>0: all_flags.append({'id':r['name']+'#'+str(k),'page':r['name'],'rule':f['id'],'url':r.get('finalUrl') or r['url'],'label':f['label'],'why':f['why'],'evidence':[str(e.get('quote'))[:260] for e in f.get('evidence',[])[:3] if e.get('quote')],'shot':'shots/'+r['name']+'.jpg'})
for f in all_flags: f['kind']='flag'
random.Random('subtext-label-kit').shuffle(all_flags)
take=[f for f in all_flags if os.path.exists(os.path.join(shots,f['page']+'.jpg'))][:N]
LINES=int(sys.argv[5]) if len(sys.argv)>5 else 60
pages=[r for r in R if r.get('reading') and os.path.exists(os.path.join(shots,r['name']+'.jpg'))]; random.Random('subtext-label-lines').shuffle(pages)
take+= [{'id':r['name']+'#line','kind':'line','page':r['name'],'rule':'top_line','url':r.get('finalUrl') or r['url'],'label':r['reading'],'why':'','evidence':[],'shot':'shots/'+r['name']+'.jpg'} for r in pages[:LINES]]
os.makedirs(os.path.join(out,'shots'),exist_ok=True)
for f in take: shutil.copy(os.path.join(shots,f['page']+'.jpg'),os.path.join(out,'shots',f['page']+'.jpg'))
shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)),'kit.html'),os.path.join(out,'index.html'))
open(os.path.join(out,'flags.js'),'w').write('window.KIT_ID='+json.dumps(os.path.basename(run))+';\nconst FLAGS='+json.dumps(take,ensure_ascii=False)+';\n')
print('all flags',len(all_flags),'pages',len(R),'in kit',len(take),'shots',len({f['page'] for f in take}))
