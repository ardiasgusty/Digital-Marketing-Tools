import importlib.util
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
spec = importlib.util.spec_from_file_location('ga4', Path(__file__).resolve().parent.parent / 'scripts/sync-copywriter-ga4.py')
ga4 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ga4)
assert ga4.metric({'metricValues':[{'value':'10'},{'value':'2'},{'value':'90'}]})['averageEngagementSeconds'] == 45
assert ga4.metric({'metricValues':[{'value':'0'},{'value':'0'},{'value':'0'}]})['averageEngagementSeconds'] is None
class Response:
    ok = True
    def __init__(self, data): self.data=data
    def json(self): return self.data
class Session:
    def __init__(self): self.calls=[]
    def post(self, url, json, timeout):
        self.calls.append(json)
        return Response({'rowCount':2,'rows':[{'metricValues':[]}], 'metadata':{'timeZone':'Asia/Jakarta'}})
session=Session()
rows, meta=ga4.report(session,'123','2026-01-01','2026-01-31',['/article/'],['pagePath'])
assert len(rows)==2 and session.calls[1]['offset']==1
assert session.calls[0]['dimensionFilter']['andGroup']['expressions'][0]['filter']['fieldName']=='hostName'
assert meta['timeZone']=='Asia/Jakarta'
print('PASS: weighted engagement, empty denominator, pagination and host/path scope')
