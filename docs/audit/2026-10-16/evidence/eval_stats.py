import csv, sys, collections, json
base = sys.argv[1]
def rows(p):
    with open(p, encoding='utf-8-sig') as f: return list(csv.DictReader(f))
for brain, pre in (("brain1","blind-b1-elig1"),("brain2","blind-b2-elig1")):
    key = rows(f"{base}/packets/{pre}/{brain}-key.csv")
    ra = rows(f"{base}/packets/{pre}/{brain}-rater-A.csv")
    rb = rows(f"{base}/packets/{pre}/{brain}-rater-B.csv")
    cases = rows(f"{base}/packets/{pre}/{brain}-cases-A.csv")
    print("==", brain, "judgement rows", len(ra), "case rows", len(cases))
    print(" A/B row ids identical & same order:", [r['row_id'] for r in ra]==[r['row_id'] for r in rb])
    print(" A/B content identical:", ra==rb)
    src = collections.Counter(k['source'] for k in key); print(" key source:", dict(src))
    percase = collections.defaultdict(lambda: collections.Counter())
    for k in key: percase[k['case_id']][k['source']] += 1
    allcases = [c['case_id'] for c in cases]
    res_cases = [c for c in allcases if percase[c]['result']>0]
    print(" cases:", len(allcases), " with >=1 system result:", len(res_cases), " with no rows at all:", sum(1 for c in allcases if sum(percase[c].values())==0))
    outcomes = collections.Counter(c.get('mushin_outcome','')[:40] for c in cases); print(" case outcomes:", outcomes.most_common(8))
    resn = [percase[c]['result'] for c in allcases]; print(" results per case:", resn)
    pooln = [percase[c]['pool'] for c in allcases]; print(" pool-only per case:", pooln)
    plat = collections.Counter(r['platform'] for r in ra); print(" platform of rated rows:", dict(plat))
    ids = collections.Counter(k['creator_id'] for k in key); print(" distinct creators:", len(ids), " appearing in >1 case:", sum(1 for v in ids.values() if v>1))
    city = collections.Counter((r['city'] or 'blank') for r in ra); print(" city field:", city.most_common(6))
    lang = collections.Counter('urdu-script' if any('؀'<=ch<='ۿ' for ch in c['query']) else 'latin' for c in cases); print(" query script:", dict(lang))
