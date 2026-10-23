"""Checks for URL canonicalisation, dedupe, region fallback, and dates."""

import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('NLTK_DATA', os.path.join(ROOT, 'nltk_data'))
sys.path.insert(0, ROOT)

from fetcher import FEEDS, Dates, Headlines, Regions, Sentiment  # noqa: E402

NOW = datetime(2026, 10, 23, 12, 0, tzinfo=timezone.utc)


def test_canonical_url():
    assert Headlines.canonical_url(
        'HTTPS://Example.COM/path/?utm_source=rss&utm_medium=feed&id=7#section'
    ) == 'https://example.com/path?id=7'
    assert Headlines.canonical_url('https://example.com/path/') == 'https://example.com/path'
    assert Headlines.canonical_url('https://example.com/path/#frag') == 'https://example.com/path'
    assert Headlines.canonical_url('https://example.com/') == 'https://example.com'
    assert Headlines.canonical_url('') == ''


def test_dedupe_keeps_earliest():
    later = {
        'title': 'New headline',
        'url': 'HTTPS://Example.com/story/?utm_source=rss&id=3#x',
        'source': 'BBC News',
        'published': '2026-10-23T10:00:00+00:00',
    }
    earlier = {
        'title': 'Old headline',
        'url': 'https://example.com/story?id=3',
        'source': 'BBC News',
        'published': '2026-10-23T07:00:00+00:00',
    }
    other = {
        'title': 'Different story',
        'url': 'https://example.com/other',
        'source': 'BBC News',
        'published': '2026-10-23T06:00:00+00:00',
    }
    kept = Headlines.dedupe([later, earlier, other])
    assert len(kept) == 2
    assert kept[0]['title'] == 'Different story'
    assert kept[1]['title'] == 'Old headline'

    curly = {
        'title': 'Israel orders ‘full lockdown’ of West Bank',
        'url': 'https://a.example/1',
        'source': 'NBC News',
        'published': '2026-10-23T09:00:00+00:00',
    }
    straight = {
        'title': "Israel orders 'full lockdown' of West Bank",
        'url': 'https://a.example/2',
        'source': 'nbc news',
        'published': '2026-10-23T08:00:00+00:00',
    }
    titled = Headlines.dedupe([curly, straight])
    assert len(titled) == 1
    assert titled[0]['published'] == '2026-10-23T08:00:00+00:00'


def test_region_fallback():
    assert Regions.FALLBACK == 'Global'
    assert Regions.for_source('Not A Real Outlet') == 'Global'
    assert Regions.for_source('') == 'Global'
    assert Regions.for_source('Brazil News') == 'Global'
    assert 'Brazil News' in Regions.UNCERTAIN
    assert Regions.for_source('Fox News') == 'North America'
    assert Regions.for_source('Independent') == 'Europe'
    for feed in FEEDS:
        assert feed['name'] in Regions.OUTLETS, feed['name']
        assert feed['name'] in Dates.ZONES, feed['name']


def test_dates_day_month_and_utc():
    # UK numeric dates are day/month. The same string on a US outlet is month/day.
    assert Dates.iso('09/01/2026 16:08', 'Independent', now=NOW) == '2026-01-09T16:08:00+00:00'
    assert Dates.iso('09/01/2026 16:08', 'Fox News', now=NOW) == '2026-09-01T20:08:00+00:00'
    # ISO must not be swapped just because the outlet is day-first.
    assert Dates.iso('2026-09-01T16:08:00+00:00', 'Independent', now=NOW) == '2026-09-01T16:08:00+00:00'
    assert Dates.iso('2026-10-23T07:00:57-04:00', 'CBS News', now=NOW) == '2026-10-23T11:00:57+00:00'
    assert Dates.iso('Fri, 23 Oct 2026 09:02:10 GMT', 'Independent', now=NOW) == '2026-10-23T09:02:10+00:00'
    # EST is US Eastern, including on a UTC-default wire. 23 Oct 2026 is still EDT.
    assert Dates.iso('Fri, 23 Oct 2026 09:00:00 EST', 'Reuters', now=NOW) == '2026-10-23T13:00:00+00:00'
    assert Dates.iso('Fri, 23 Oct 2026 09:00:00 BST', 'Reuters', now=NOW) == '2026-10-23T08:00:00+00:00'
    # The stored Independent stamp is in the future, so it is dropped.
    assert Dates.iso('2027-01-09T16:08:00+00:00', 'Independent', now=NOW) is None
    assert Dates.iso('Saturday 09 January 2027 16:08 GMT', 'Independent', now=NOW) is None
    assert Dates.now_iso(NOW) == '2026-10-23T12:00:00+00:00'


def test_sentiment_thresholds():
    assert Sentiment.label(0.05) == 'positive'
    assert Sentiment.label(0.049) == 'neutral'
    assert Sentiment.label(-0.05) == 'negative'
    assert Sentiment.label(-0.049) == 'neutral'
    assert Sentiment.rounded(0.0281, 'neutral') == 0.028
    assert Sentiment.rounded(0.04979999999999998, 'neutral') == 0.049


if __name__ == '__main__':
    tests = [value for name, value in sorted(globals().items()) if name.startswith('test_')]
    for test in tests:
        test()
        print('ok', test.__name__)
    print(f'{len(tests)} tests passed')
