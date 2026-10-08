"""Import GSC web-search metrics without placing Google credentials in the site."""
import datetime as dt
import json
import os
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
EXPECTED_ACCOUNT = 'siska-kpi-sync@honda-bintaro-252404.iam.gserviceaccount.com'


def google_access_error(response):
    """Report only recognized error codes; never echo a raw Google response."""
    try:
        error = response.json().get('error', {})
        reasons = {item.get('reason') for item in error.get('details', []) + error.get('errors', [])}
    except (ValueError, AttributeError, TypeError):
        reasons = set()
    if reasons & {'SERVICE_DISABLED', 'API_DISABLED', 'accessNotConfigured'}:
        return 'Google Search Console API belum aktif pada project honda-bintaro-252404. Aktifkan API tersebut di Google Cloud.'
    if reasons & {'forbidden', 'insufficientPermissions', 'PERMISSION_DENIED'}:
        return 'Akses GSC ditolak. Pastikan service account sudah ditambahkan ke properti GSC yang dipilih dengan izin membaca performa.'
    return f'GSC HTTP {response.status_code}. Periksa akses properti, API, dan kredensial Google.'


def verify_property(session, property_name):
    response = session.get('https://www.googleapis.com/webmasters/v3/sites', timeout=60)
    if not response.ok:
        raise RuntimeError(google_access_error(response))
    sites = response.json().get('siteEntry', [])
    allowed = ('sc-domain:honda-bintaro.com', 'https://www.honda-bintaro.com/', 'https://honda-bintaro.com/')
    available = [item['siteUrl'] for item in sites if item.get('siteUrl') in allowed and item.get('permissionLevel') != 'siteUnverifiedUser']
    if property_name not in available:
        if available:
            raise RuntimeError('GSC_PROPERTY tidak cocok. Properti Honda yang dapat diakses: ' + ', '.join(available))
        raise RuntimeError('Service account belum memiliki akses properti Honda Bintaro di GSC. Tambahkan email service account melalui Settings > Users and permissions.')


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
            raise RuntimeError(google_access_error(response))
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


def latest_final_date(session, property_name, year, today):
    start = dt.date(year, 1, 1)
    end = min(today, dt.date(year, 12, 31))
    if end < start:
        return None
    endpoint = f'https://www.googleapis.com/webmasters/v3/sites/{quote(property_name, safe="")}/searchAnalytics/query'
    response = session.post(endpoint, json={
        'startDate': start.isoformat(), 'endDate': end.isoformat(),
        'dimensions': ['date'], 'type': 'web', 'dataState': 'final', 'rowLimit': 1000,
    }, timeout=60)
    if not response.ok:
        raise RuntimeError(google_access_error(response))
    dates = [dt.date.fromisoformat(row['keys'][0]) for row in response.json().get('rows', [])]
    return max(dates) if dates else None


def normalized_url(value):
    """Ignore a fragment and trailing slash, but preserve host, scheme, query and path case."""
    parts = urlsplit(value)
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip('/') or '/', parts.query, ''))


def article_metrics(articles, pages):
    """Prefer exact canonical/link matches. Never invent metrics or merge ambiguous URLs."""
    aliases = {}
    for url in pages:
        aliases.setdefault(normalized_url(url), []).append(url)
    result = []
    for article in articles:
        candidates = list(dict.fromkeys([article.get('canonicalUrl') or article['link'], article['link']]))
        matched = next((url for url in candidates if url in pages), None)
        if matched is None:
            for url in candidates:
                matches = aliases.get(normalized_url(url), [])
                if len(matches) == 1:
                    matched = matches[0]
                    break
        result.append(dict(wordpressId=article['wordpressId'], link=article['link'],
                           matchedPage=matched, metrics=pages.get(matched)))
    return result


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
    verify_property(session, property_name)
    year = int(os.environ.get('COPYWRITER_YEAR') or dt.datetime.now(ZoneInfo('Asia/Jakarta')).year)
    source = ROOT / 'json' / str(year) / f'kpi-copywriter-siska-{year}.json'
    database = json.loads(source.read_text())
    if database['year'] != year or database['authorId'] != 8:
        raise ValueError('Invalid Siska article database')
    # Discover actual finalized dates from Google, instead of discarding three days locally.
    through = latest_final_date(session, property_name, year, dt.datetime.now(ZoneInfo('America/Los_Angeles')).date())
    months = []
    for month, start, end in (month_ranges(year, through) if through else []):
        pages = query_pages(session, property_name, start, end)
        months.append({'month': month, 'startDate': start, 'endDate': end,
                       'articles': article_metrics(database['articles'], pages)})
    output = {'version': 1, 'year': year, 'property': property_name, 'searchType': 'web',
              'dateTimezone': 'America/Los_Angeles', 'dataState': 'final',
              'latestFinalDate': through.isoformat() if through else None,
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
