"""Read GA4 article metrics using the existing server-side service account."""
import datetime as dt
import json
import os
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo
from pathlib import Path
from importlib import import_module

ROOT = Path(__file__).resolve().parent.parent
GSC = import_module('sync-copywriter-gsc')
METRICS = ['screenPageViews', 'activeUsers', 'userEngagementDuration']


def report(session, property_id, start, end, paths, dimensions):
    rows, offset, metadata = [], 0, {}
    while True:
        response = session.post(f'https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport', json={
            'dateRanges': [{'startDate': start, 'endDate': end}],
            'dimensions': [{'name': name} for name in dimensions],
            'metrics': [{'name': name} for name in METRICS],
            'dimensionFilter': {'andGroup': {'expressions': [
                {'filter': {'fieldName': 'hostName', 'inListFilter': {'values': ['www.honda-bintaro.com', 'honda-bintaro.com']}}},
                {'filter': {'fieldName': 'pagePath', 'inListFilter': {'values': paths, 'caseSensitive': True}}},
            ]}},
            'limit': 100000, 'offset': offset,
        }, timeout=60)
        if not response.ok:
            if response.status_code == 403:
                raise RuntimeError('GA4 ditolak. Aktifkan Google Analytics Data API dan tambahkan service account sebagai Viewer di Admin > Property access management GA4.')
            raise RuntimeError(f'GA4 HTTP {response.status_code}. Periksa Property ID dan konfigurasi API.')
        data = response.json()
        metadata = data.get('metadata', {})
        rows.extend(data.get('rows', []))
        offset = len(rows)
        if offset >= int(data.get('rowCount', 0)):
            return rows, metadata


def metric(row):
    values = [float(value['value']) for value in row['metricValues']]
    return dict(views=values[0], activeUsers=values[1], engagementSeconds=values[2],
                averageEngagementSeconds=values[2] / values[1] if values[1] else None)


def main():
    property_id = os.environ.get('GA4_PROPERTY_ID', '')
    if not property_id.isdigit():
        raise ValueError('GA4_PROPERTY_ID must be a numeric GA4 Property ID.')
    info = json.loads(os.environ.get('GSC_SERVICE_ACCOUNT_JSON', '{}'))
    if info.get('client_email') != GSC.EXPECTED_ACCOUNT or not info.get('private_key'):
        raise ValueError('Google credentials do not match the Siska service account.')
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    session = AuthorizedSession(service_account.Credentials.from_service_account_info(info, scopes=['https://www.googleapis.com/auth/analytics.readonly']))
    year = int(os.environ.get('COPYWRITER_YEAR') or dt.datetime.now(ZoneInfo('Asia/Jakarta')).year)
    source = ROOT / 'json' / str(year) / f'kpi-copywriter-siska-{year}.json'
    database = json.loads(source.read_text())
    if database['year'] != year or database['authorId'] != 8:
        raise ValueError('Invalid Siska article database')
    paths = sorted({variant for article in database['articles'] for variant in [urlsplit(article['link']).path, urlsplit(article['link']).path.rstrip('/'), urlsplit(article['link']).path.rstrip('/') + '/']})
    # Discover property timezone from report metadata. Re-query dates using that timezone.
    discovery_date = (dt.datetime.now(ZoneInfo('Asia/Jakarta')).date() - dt.timedelta(days=3)).isoformat()
    _, meta = report(session, property_id, discovery_date, discovery_date, paths or ['/'], [])
    timezone = meta.get('timeZone')
    if not timezone:
        raise RuntimeError('GA4 did not return its reporting timezone.')
    through = min(dt.datetime.now(ZoneInfo(timezone)).date() - dt.timedelta(days=1), dt.date(year, 12, 31))
    periods = GSC.month_ranges(year, through) if through >= dt.date(year, 1, 1) else []
    if periods:
        periods.append(('All', f'{year}-01-01', through.isoformat()))
    months = []
    for month, start, end in periods:
        # Separate queries keep user counts deduplicated across paths and months.
        rows, metadata = report(session, property_id, start, end, paths, ['pagePath']) if paths else ([], meta)
        totals, _ = report(session, property_id, start, end, paths, []) if paths else ([], meta)
        by_path = {row['dimensionValues'][0]['value']: metric(row) for row in rows}
        articles = []
        for article in database['articles']:
            path = urlsplit(article['link']).path
            variants = [value for key, value in by_path.items() if key.rstrip('/') == path.rstrip('/')]
            if len(variants) > 1:
                exact, _ = report(session, property_id, start, end, [path.rstrip('/'), path.rstrip('/') + '/'], [])
                value = metric(exact[0]) if exact else None
            else:
                value = variants[0] if variants else None
            articles.append(dict(wordpressId=article['wordpressId'], metrics=value))
        months.append(dict(month=month, startDate=start, endDate=end, articles=articles,
                           total=metric(totals[0]) if totals else None, metadata=metadata))
    output = dict(version=1, year=year, property=property_id, dateTimezone=timezone,
                  lastSyncedAt=dt.datetime.now(dt.timezone.utc).isoformat(), months=months)
    destination = source.with_name(f'kpi-copywriter-siska-ga4-{year}.json')
    if destination.exists():
        previous = json.loads(destination.read_text())
        if {k:v for k,v in previous.items() if k != 'lastSyncedAt'} == {k:v for k,v in output.items() if k != 'lastSyncedAt'}:
            print('No GA4 metric changes.'); return
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(destination)
    print(f'Saved GA4 metrics for {len(months)} periods, timezone {timezone}.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, (ValueError, RuntimeError)) else f'GA4 sync failed ({type(error).__name__}). Check API/property access.')
        raise SystemExit(1)
