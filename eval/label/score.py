#!/usr/bin/env python3
"""Scores two labellers' files: wrong rate with its 95% interval (Clopper-Pearson), per-rule counts, agreement (Cohen's kappa), and the disagreements to settle. Usage: python3 -I eval/label/score.py labels-a.json labels-b.json [flags.js]"""
import json,sys,math,collections,re
def betainv(p,a,b):
    lo,hi=0.0,1.0
    def I(x,a,b,n=4000): # numeric regularised incomplete beta, adequate here
        s=0.0;h=x/n
        lg=math.lgamma(a+b)-math.lgamma(a)-math.lgamma(b)
        for i in range(n):
            t=(i+0.5)*h; s+=math.exp((a-1)*math.log(t)+(b-1)*math.log(1-t)+lg)*h
        return s
    for _ in range(40):
        m=(lo+hi)/2
        if I(m,a,b)<p: lo=m
        else: hi=m
    return (lo+hi)/2
def ci(k,n):
    lo=0.0 if k==0 else betainv(.025,k,n-k+1); hi=1.0 if k==n else betainv(.975,k+1,n-k); return lo,hi
A,B=[json.load(open(p)) for p in sys.argv[1:3]]
rule_of={}
if len(sys.argv)>3:
    for f in json.loads(open(sys.argv[3]).read().split('const FLAGS=')[1].rstrip(';\n')): rule_of[f['id']]=f['rule']
line=lambda i: i.endswith('#line')
ids=sorted(i for i in set(A['labels'])&set(B['labels']) if not line(i)); lines=sorted(i for i in set(A['labels'])&set(B['labels']) if line(i))
if not ids: sys.exit('no flags labelled by both')
a=[A['labels'][i]['label'] for i in ids]; b=[B['labels'][i]['label'] for i in ids]
agree=sum(x==y for x,y in zip(a,b))/len(ids); cats=set(a)|set(b); pe=sum(a.count(c)/len(a)*b.count(c)/len(b) for c in cats); kappa=(agree-pe)/(1-pe) if pe<1 else 1
print(f'both labelled {len(ids)}; {A["who"]} {len(A["labels"])}, {B["who"]} {len(B["labels"])}; agree {agree:.0%}; kappa {kappa:.2f}')
for who,lab in ((A['who'],a),(B['who'],b)):
    c=collections.Counter(lab); n=len(lab)-c['cant_tell']; lo,hi=ci(c['wrong'],n) if n else (0,0)
    print(f'{who}: {dict(c)}; wrong {c["wrong"]}/{n} = {c["wrong"]/max(n,1):.0%} (95% interval {lo:.0%} to {hi:.0%})')
either=sum('wrong' in (x,y) for x,y in zip(a,b)); n=sum(not(x=='cant_tell' and y=='cant_tell') for x,y in zip(a,b)); lo,hi=ci(either,n) if n else (0,0)
print(f'wrong by either labeller (the strict count): {either}/{n} = {either/max(n,1):.0%} (95% interval {lo:.0%} to {hi:.0%})')
print('bar: on 150 flags, 30 or fewer wrong has an upper bound near 27% and meets the bar; 38 does not. Both counts must be read after settling the disagreements below.')
for i,x,y in zip(ids,a,b):
    if x!=y and 'wrong' in (x,y): print('settle',i,x,y)

facts=re.compile(r'^(tracker\.|source\.ownership)')
if rule_of:
    no=[i for i in ids if not facts.match(rule_of.get(i,''))]; w=sum('wrong' in (A['labels'][i]['label'],B['labels'][i]['label']) for i in no); lo,hi=ci(w,len(no)) if no else (0,0)
    print(f'without tracker and ownership facts: wrong by either {w}/{len(no)} = {w/max(1,len(no)):.0%} (95% interval {lo:.0%} to {hi:.0%})')
    by=collections.defaultdict(lambda:[0,0])
    for i in ids: r=rule_of.get(i,'?'); by[r][0]+=1; by[r][1]+='wrong' in (A['labels'][i]['label'],B['labels'][i]['label'])
    for r,(n,wr) in sorted(by.items(),key=lambda kv:-kv[1][0]): print(f'  {r:40s} {n:3d} flags, {wr} wrong')
if lines:
    for who,L in ((A['who'],A),(B['who'],B)): print(who,'top lines:',dict(collections.Counter(L['labels'][i]['label'] for i in lines)))
    a=[A['labels'][i]['label'] for i in lines]; b=[B['labels'][i]['label'] for i in lines]; print('top lines agree',f'{sum(x==y for x,y in zip(a,b))/len(lines):.0%}','of',len(lines))
