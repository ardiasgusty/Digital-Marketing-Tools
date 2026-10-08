import datetime as dt
import importlib.util
from pathlib import Path

path = Path(__file__).resolve().parent.parent / 'scripts' / 'sync-copywriter-gsc.py'
spec = importlib.util.spec_from_file_location('gsc', path)
gsc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gsc)

assert gsc.month_ranges(2026, dt.date(2026, 2, 3)) == [('2026-01', '2026-01-01', '2026-01-31'), ('2026-02', '2026-02-01', '2026-02-03')]
assert gsc.month_ranges(2027, dt.date(2026, 12, 31)) == []
assert gsc.month_ranges(2024, dt.date(2024, 3, 1))[1][2] == '2024-02-29'


class Response:
    ok = True
    def json(self):
        return {'rows': [{'keys': ['https://www.honda-bintaro.com/a/'], 'clicks': 3, 'impressions': 100, 'ctr': .03, 'position': 7.2}]}


class Session:
    def post(self, url, json, timeout):
        assert 'sc-domain%3Ahonda-bintaro.com' in url
        assert json['dataState'] == 'final' and json['dimensions'] == ['page']
        return Response()


pages = gsc.query_pages(Session(), 'sc-domain:honda-bintaro.com', '2026-01-01', '2026-01-31')
matched = gsc.article_metrics([{'wordpressId': 1, 'link': 'https://www.honda-bintaro.com/a/'}, {'wordpressId': 2, 'link': 'https://www.honda-bintaro.com/b/'}], pages)
assert matched[0]['metrics']['ctr'] == .03
assert matched[1]['metrics'] is None
alias = gsc.article_metrics([{'wordpressId': 3, 'link': 'https://www.honda-bintaro.com/a#section'}], pages)
assert alias[0]['metrics']['clicks'] == 3
assert alias[0]['matchedPage'] == 'https://www.honda-bintaro.com/a/'
assert gsc.article_metrics([{'wordpressId': 4, 'link': 'https://other.example/a/'}], pages)[0]['metrics'] is None
ambiguous = {**pages, 'https://www.honda-bintaro.com/a': pages['https://www.honda-bintaro.com/a/']}
assert gsc.article_metrics([{'wordpressId': 5, 'link': 'https://www.honda-bintaro.com/a#section'}], ambiguous)[0]['metrics'] is None
class DatesSession:
    def post(self, url, json, timeout):
        assert json['dimensions'] == ['date'] and json['dataState'] == 'final'
        assert json['endDate'] == '2026-10-09'
        return type('Dates', (), {'ok': True, 'json': lambda self: {'rows': [{'keys': ['2026-10-07']}, {'keys': ['2026-10-08']}]}})()
assert gsc.latest_final_date(DatesSession(), 'sc-domain:honda-bintaro.com', 2026, dt.date(2026, 10, 9)) == dt.date(2026, 10, 8)
assert gsc.latest_final_date(DatesSession(), 'sc-domain:honda-bintaro.com', 2027, dt.date(2026, 10, 9)) is None


class ForbiddenSession:
    def post(self, *args, **kwargs):
        return type('Forbidden', (), {'ok': False, 'status_code': 403})()


try:
    gsc.query_pages(ForbiddenSession(), 'sc-domain:honda-bintaro.com', '2026-01-01', '2026-01-31')
    raise AssertionError('Permission failure should stop import')
except RuntimeError as error:
    assert '403' in str(error)
disabled = type('Disabled', (), {'status_code': 403, 'json': lambda self: {'error': {'details': [{'reason': 'SERVICE_DISABLED'}]}}})()
assert 'belum aktif' in gsc.google_access_error(disabled)
class SitesSession:
    def get(self, *args, **kwargs):
        return type('Sites', (), {'ok': True, 'json': lambda self: {'siteEntry': [{'siteUrl': 'sc-domain:honda-bintaro.com', 'permissionLevel': 'siteFullUser'}]}})()
gsc.verify_property(SitesSession(), 'sc-domain:honda-bintaro.com')
try:
    gsc.verify_property(SitesSession(), 'https://www.honda-bintaro.com/')
    raise AssertionError('Wrong property should fail')
except RuntimeError as error:
    assert 'sc-domain:honda-bintaro.com' in str(error)
print('PASS: monthly date boundaries, leap year, exact page matching, CTR, missing data, authorization failure.')
