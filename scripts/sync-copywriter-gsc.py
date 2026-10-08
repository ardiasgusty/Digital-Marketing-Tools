"""Import GSC web-search metrics without placing Google credentials in the site."""
import datetime as dt
import json
import os
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
EXPECTED_ACCOUNT = 'siska-kpi-sync@honda-bintaro-252404.iam.gserviceaccount.com'


def month_ranges(year, through):
    """Dates use Search Console's Pacific timezone, independently of publication dates."""
    ranges = []
    for month in range(1, 13):
        start = dt.date(year, month, 1)
        if start > through:
            break
        next_month = dt.date(year + (month == 12), month % 12 + 1, 1)
        end = min(next_month - dt.timedelta(days=1), through)
        ranges.append((f'{year}-{month:02}', start.isoformat(), end.isoformat()))
    return ranges


def query_pages(session, property_name, start, end):
    endpoint = f'https://www.googleapis.com/webmasters/v3/sites/{quote(property_name, safe="")}/searchAnalytics/query'
    pages = {}
    offset = 0
    while True:
        response = session.post(endpoint, json={
            'startDate': start, 'endDate': end, 'dimensions': ['page'],
            'type': 'web', 'dataState': 'final', 'rowLimit': 25000, 'startRow': offset,
        }, timeout=60)
        if not response.ok:
            # Do not log requests, credentials, tokens, or full Google responses.
            raise RuntimeError(f'GSC HTTP {response.status_code}. Periksa akses properti, API, dan kredensial Google.')
        rows = response.json().get('rows', [])
        for row in rows:
            keys = row.get('keys', [])
            if len(keys) != 1:
                raise ValueError('Unexpected Search Console page dimensions')
            clicks, impressions = row['clicks'], row['impressions']
            pages[keys[0]] = {
                'clicks': clicks, 'impressions': impressions,
                'ctr': clicks / impressions if impressions else 0,
                'position': row['position'],
            }
        if len(rows) < 25000:
            return pages
        offset += len(rows)


def article_metrics(articles, pages):
    """Match canonical page URLs exactly; absent rows are not invented zero results."""
    return [dict(wordpressId=article['wordpressId'], link=article['link'],
                 metrics=pages.get(article.get('canonicalUrl') or article['link']))
            for article in articles]


def main():
    secret = os.environ.get('GSC_SERVICE_ACCOUNT_JSON', '')
    property_name = os.environ.get('GSC_PROPERTY', '')
    if not secret or not property_name:
        raise RuntimeError('Set GSC_SERVICE_ACCOUNT_JSON secret and GSC_PROPERTY variable first.')
    if property_name in ('https://www.honda-bintaro.com', 'https://honda-bintaro.com'):
        property_name += '/'
    if property_name not in ('sc-domain:honda-bintaro.com', 'https://www.honda-bintaro.com/', 'https://honda-bintaro.com/'):
        raise ValueError('GSC_PROPERTY must be the exact Honda Bintaro property registered in GSC.')
    try:
        credentials_data = json.loads(secret)
    except json.JSONDecodeError:
        raise ValueError('GSC_SERVICE_ACCOUNT_JSON must contain the complete Google JSON key.') from None
    if credentials_data.get('client_email') != EXPECTED_ACCOUNT or not credentials_data.get('private_key'):
        raise ValueError('Google credentials do not match the configured Siska service account.')
    # Imports stay inside main so offline tests need no Google credentials or dependencies.
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    credentials = service_account.Credentials.from_service_account_info(
        credentials_data, scopes=['https://www.googleapis.com/auth/webmasters.readonly'])
    session = AuthorizedSession(credentials)
    year = int(os.environ.get('COPYWRITER_YEAR') or dt.datetime.now(ZoneInfo('Asia/Jakarta')).year)
    source = ROOT / 'json' / str(year) / f'kpi-copywriter-siska-{year}.json'
    database = json.loads(source.read_text())
    if database['year'] != year or database['authorId'] != 8:
        raise ValueError('Invalid Siska article database')
    # Use a conservative three-day delay and finalized metrics; never label these real-time.
    through = dt.datetime.now(ZoneInfo('America/Los_Angeles')).date() - dt.timedelta(days=3)
    months = []
    for month, start, end in month_ranges(year, through):
        pages = query_pages(session, property_name, start, end)
        months.append({'month': month, 'startDate': start, 'endDate': end,
                       'articles': article_metrics(database['articles'], pages)})
    output = {'version': 1, 'year': year, 'property': property_name, 'searchType': 'web',
              'dateTimezone': 'America/Los_Angeles', 'dataState': 'final',
              'lastSyncedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'months': months}
    destination = source.with_name(f'kpi-copywriter-siska-gsc-{year}.json')
    if destination.exists():
        previous = json.loads(destination.read_text())
        if {k: v for k, v in previous.items() if k != 'lastSyncedAt'} == {k: v for k, v in output.items() if k != 'lastSyncedAt'}:
            print('No GSC metric changes.')
            return
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(destination)
    print(f'Saved GSC metrics for {len(months)} months; absent page rows remain null.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Library auth exceptions may contain server details; do not echo their messages.
        if isinstance(error, (ValueError, RuntimeError)):
            print(str(error))
        else:
            print(f'GSC sync failed ({type(error).__name__}). Check service account/API access.')
        raise SystemExit(1)
