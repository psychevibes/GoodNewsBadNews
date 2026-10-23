import os
import json
import time
import hashlib
import re
import socket
import traceback
import unicodedata
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo
import nltk

import feedparser
from dateutil import parser as dateparser

# NLTK VADER setup
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

# Ensure VADER lexicon is present
# Ensure VADER lexicon is present
try:
    # Use NLTK_DATA env var if set, otherwise default
    nltk_data_path = os.environ.get('NLTK_DATA')
    if nltk_data_path:
        if nltk_data_path not in nltk.data.path:
            nltk.data.path.append(nltk_data_path)
        print(f"Using NLTK data path: {nltk_data_path}")
    
    nltk.data.find('sentiment/vader_lexicon.zip')
except LookupError:
    print("Downloading vader_lexicon...")
    nltk.download('vader_lexicon', download_dir=os.environ.get('NLTK_DATA'))

sia = SentimentIntensityAnalyzer()

# --- Configuration ---
ROLLING_DAYS = 7
OUTPUT_DIR = os.path.join('docs', 'data')
RAW_PATH = os.path.join('data', 'raw.jsonl')
LATEST_PATH = os.path.join(OUTPUT_DIR, 'latest.json')
HISTORY_PATH = os.path.join(OUTPUT_DIR, 'history.json')
ALL_HEADLINES_PATH = os.path.join(OUTPUT_DIR, 'all_headlines.json')
MAX_ARTICLES = 100000  # Limit to ~75MB to stay under GitHub's 100MB limit

# RSS feeds organized by region (same as before)
FEEDS = [
    # North America
    {"name": "BBC News", "url": "http://feeds.bbci.co.uk/news/rss.xml"},
    {"name": "CNN", "url": "http://rss.cnn.com/rss/edition.rss"},
    {"name": "Reuters", "url": "https://feeds.reuters.com/reuters/topNews"},
    {"name": "AP News", "url": "https://feeds.apnews.com/apf-topnews"},
    {"name": "NPR", "url": "https://feeds.npr.org/1001/rss.xml"},
    {"name": "CBS News", "url": "https://www.cbsnews.com/latest/rss/main"},
    {"name": "ABC News", "url": "https://abcnews.go.com/abcnews/topstories"},
    {"name": "Fox News", "url": "http://feeds.foxnews.com/foxnews/latest"},
    {"name": "NBC News", "url": "http://feeds.nbcnews.com/nbcnews/public/news"},
    {"name": "USA Today", "url": "http://rssfeeds.usatoday.com/usatoday-NewsTopStories"},
    {"name": "Wall Street Journal", "url": "https://feeds.a.dj.com/rss/RSSWorldNews.xml"},
    {"name": "New York Times", "url": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"},
    {"name": "Washington Post", "url": "http://feeds.washingtonpost.com/rss/world"},
    {"name": "CBC News", "url": "https://www.cbc.ca/cmlink/rss-world"},
    {"name": "Toronto Star", "url": "https://www.thestar.com/feeds.articles.news.world.rss"},
    
    # Europe
    {"name": "The Guardian", "url": "https://www.theguardian.com/world/rss"},
    {"name": "Financial Times", "url": "https://www.ft.com/?format=rss"},
    {"name": "The Times", "url": "https://www.thetimes.co.uk/rss"},
    {"name": "Independent", "url": "https://www.independent.co.uk/rss"},
    {"name": "Telegraph", "url": "https://www.telegraph.co.uk/rss.xml"},
    {"name": "Sky News", "url": "http://feeds.skynews.com/feeds/rss/world.xml"},
    {"name": "Euronews", "url": "https://www.euronews.com/rss"},
    {"name": "Deutsche Welle", "url": "https://rss.dw.com/xml/rss-en-all"},
    {"name": "France 24", "url": "https://www.france24.com/en/rss"},
    {"name": "RT News", "url": "https://www.rt.com/rss/news/"},
    {"name": "Sputnik News", "url": "https://sputniknews.com/export/rss2/archive/index.xml"},
    {"name": "Irish Times", "url": "https://www.irishtimes.com/cmlink/news-1.1319192"},
    
    # Asia-Pacific
    {"name": "Al Jazeera English", "url": "https://www.aljazeera.com/xml/rss/all.xml"},
    {"name": "South China Morning Post", "url": "https://www.scmp.com/rss/91/feed"},
    {"name": "Japan Times", "url": "https://www.japantimes.co.jp/rss/feed/news"},
    {"name": "The Hindu", "url": "https://www.thehindu.com/news/national/?service=rss"},
    {"name": "Times of India", "url": "https://timesofindia.indiatimes.com/rssfeedstopstories.cms"},
    {"name": "Straits Times", "url": "https://www.straitstimes.com/news/singapore/rss.xml"},
    {"name": "Australian Broadcasting Corporation", "url": "https://www.abc.net.au/news/feed/51120/rss.xml"},
    {"name": "New Zealand Herald", "url": "https://www.nzherald.co.nz/arc/outboundfeeds/rss/section/1/"},
    {"name": "Korean Herald", "url": "http://www.koreaherald.com/rss/020701000000.xml"},
    {"name": "Channel News Asia", "url": "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml"},
    
    # Middle East & Africa
    {"name": "Jerusalem Post", "url": "https://www.jpost.com/rss/rssfeedsheadlines.aspx"},
    {"name": "Haaretz", "url": "https://www.haaretz.com/srv/haaretz-com-news-feed"},
    {"name": "Middle East Eye", "url": "https://www.middleeasteye.net/rss"},
    {"name": "Times of Israel", "url": "https://www.timesofisrael.com/feed/"},
    {"name": "Daily News Egypt", "url": "https://dailynewsegypt.com/feed/"},
    {"name": "News24 South Africa", "url": "https://www.news24.com/arc/outboundfeeds/rss/?outputType=xml"},
    {"name": "AllAfrica", "url": "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf"},
    {"name": "Daily Nation Kenya", "url": "https://nation.africa/kenya/rss"},
    
    # South America
    {"name": "Buenos Aires Herald", "url": "https://www.buenosairesherald.com/rss"},
    {"name": "Brazil News", "url": "https://rss.cnn.com/rss/edition_americas.rss"},
    
    # Business & Tech (Global)
    {"name": "CNBC", "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html"},
    {"name": "Bloomberg", "url": "https://feeds.bloomberg.com/markets/news.rss"},
    {"name": "MarketWatch", "url": "http://feeds.marketwatch.com/marketwatch/topstories/"},
    {"name": "Forbes", "url": "https://www.forbes.com/news/index.xml"},
    {"name": "TechCrunch", "url": "http://feeds.feedburner.com/TechCrunch/"},
    {"name": "The Verge", "url": "https://www.theverge.com/rss/index.xml"},
    {"name": "Wired", "url": "https://www.wired.com/feed/rss"},
    {"name": "Ars Technica", "url": "http://feeds.arstechnica.com/arstechnica/index"},
    {"name": "Engadget", "url": "https://www.engadget.com/rss.xml"},
    {"name": "Mashable", "url": "http://feeds.mashable.com/Mashable"},
    
    # Sports (Global)
    {"name": "ESPN", "url": "https://www.espn.com/espn/rss/news"},
    {"name": "Sports Illustrated", "url": "https://www.si.com/rss/si_topstories.rss"},
    {"name": "BBC Sport", "url": "http://feeds.bbci.co.uk/sport/rss.xml"},
    {"name": "Sky Sports", "url": "http://www.skysports.com/rss/12040"},
]

# Enhanced topic classification with context patterns
TOPIC_PATTERNS = {
    'Politics': {
        'keywords': ['election', 'president', 'parliament', 'congress', 'minister', 'policy', 'government', 'senate', 'vote', 'campaign', 'political', 'democrat', 'republican', 'conservative', 'liberal', 'legislation', 'bill', 'law', 'ruling party', 'opposition'],
        'context_patterns': [
            r'\b(wins?|loses?|defeats?)\s+(election|vote|ballot)',
            r'\b(president|prime minister|chancellor|governor)\s+(says?|announces?|declares?)',
            r'\b(parliament|congress|senate|assembly)\s+(passes?|rejects?|debates?)',
            r'\b(political|election|campaign)\s+(rally|debate|poll)',
            r'\b(government|administration)\s+(announces?|plans?|proposes?)'
        ]
    },
    'Business': {
        'keywords': ['market', 'stocks', 'earnings', 'profit', 'merger', 'economy', 'inflation', 'startup', 'ipo', 'trading', 'finance', 'revenue', 'investment', 'banking', 'cryptocurrency', 'bitcoin', 'nasdaq', 'dow jones', 'corporate', 'ceo', 'acquisition'],
        'context_patterns': [
            r'\$[\d,]+\s*(million|billion|trillion)',
            r'\b(shares?|stock)\s+(rises?|falls?|jumps?|drops?)',
            r'\b(company|corporation)\s+(reports?|announces?|posts?)\s+(profit|loss|earnings)',
            r'\b(merger|acquisition|buyout)\s+(deal|agreement)',
            r'\b(market|economy)\s+(grows?|shrinks?|recovers?|crashes?)'
        ]
    },
    'Tech': {
        'keywords': ['ai', 'artificial intelligence', 'iphone', 'android', 'microsoft', 'google', 'apple', 'meta', 'openai', 'software', 'chip', 'semiconductor', 'startup', 'tech', 'innovation', 'digital', 'cyber', 'data', 'algorithm', 'blockchain'],
        'context_patterns': [
            r'\b(launches?|releases?|unveils?)\s+(new|latest)\s+(phone|device|app|software)',
            r'\b(ai|artificial intelligence)\s+(breakthrough|advancement|development)',
            r'\b(tech|technology)\s+(company|giant|startup)',
            r'\b(cyber|data)\s+(attack|breach|security)',
            r'\b(digital|online|internet)\s+(platform|service|tool)'
        ]
    },
    'Sports': {
        'keywords': ['match', 'game', 'tournament', 'league', 'world cup', 'olympic', 'goal', 'coach', 'player', 'team', 'football', 'basketball', 'tennis', 'soccer', 'baseball', 'hockey', 'championship', 'final', 'playoffs', 'season'],
        'context_patterns': [
            r'\b(wins?|loses?|defeats?|beats?)\s+\d+-\d+',
            r'\b(team|player|athlete)\s+(wins?|scores?|defeats?)',
            r'\b(championship|tournament|league)\s+(final|semifinal|match)',
            r'\b(olympic|world cup|playoffs)\s+(gold|medal|victory)',
            r'\b(coach|manager)\s+(fired|hired|appointed)'
        ]
    },
    'Health': {
        'keywords': ['covid', 'cancer', 'vaccine', 'health', 'disease', 'nhs', 'virus', 'medical', 'hospital', 'doctor', 'patient', 'treatment', 'cure', 'medication', 'outbreak', 'pandemic', 'symptoms', 'diagnosis'],
        'context_patterns': [
            r'\b(new|novel|deadly)\s+(virus|disease|outbreak)',
            r'\b(vaccine|treatment|cure)\s+(approved|developed|discovered)',
            r'\b(hospital|medical)\s+(study|research|trial)',
            r'\b(health|medical)\s+(emergency|crisis|alert)',
            r'\b(patients?|cases?)\s+(increase|decrease|surge)'
        ]
    },
    'Science': {
        'keywords': ['research', 'study', 'space', 'nasa', 'astronomy', 'physics', 'biology', 'climate', 'environment', 'scientist', 'discovery', 'experiment', 'laboratory', 'breakthrough', 'renewable', 'carbon', 'global warming'],
        'context_patterns': [
            r'\b(scientists?|researchers?)\s+(discover|find|reveal)',
            r'\b(study|research)\s+(shows?|reveals?|suggests?)',
            r'\b(climate|environmental)\s+(change|crisis|impact)',
            r'\b(space|mars|moon)\s+(mission|exploration|discovery)',
            r'\b(breakthrough|discovery)\s+in\s+(medicine|physics|biology)'
        ]
    },
    'Entertainment': {
        'keywords': ['movie', 'film', 'celebrity', 'music', 'box office', 'tv', 'netflix', 'streaming', 'hollywood', 'actor', 'actress', 'director', 'concert', 'album', 'show', 'series', 'award', 'oscar', 'grammy'],
        'context_patterns': [
            r'\b(movie|film)\s+(premieres?|releases?|box office)',
            r'\b(actor|actress|celebrity)\s+(dies|arrested|marries)',
            r'\b(tv|television)\s+(show|series|episode)',
            r'\b(music|album|song)\s+(tops|charts|releases?)',
            r'\b(award|oscar|grammy)\s+(wins?|nominations?)'
        ]
    },
    'World': {
        'keywords': ['ukraine', 'gaza', 'israel', 'middle east', 'eu', 'china', 'russia', 'africa', 'asia', 'europe', 'america', 'war', 'conflict', 'international', 'diplomatic', 'treaty', 'sanctions', 'embassy', 'foreign'],
        'context_patterns': [
            r'\b(war|conflict|fighting)\s+(in|between|over)',
            r'\b(diplomatic|international)\s+(crisis|relations|talks)',
            r'\b(sanctions|embargo)\s+(against|on|imposed)',
            r'\b(peace|ceasefire|treaty)\s+(agreement|talks|negotiations)',
            r'\b(foreign|international)\s+(minister|relations|policy)'
        ]
    },
    # NEW TOPICS
    'Regional': {
        'keywords': ['state', 'province', 'county', 'regional', 'statewide', 'provincial', 'territory', 'district', 'commonwealth'],
        'context_patterns': [
            r'\b(state|province|county)\s+(government|legislature|assembly)',
            r'\b(regional|statewide|provincial)\s+(election|policy|program)',
            r'\b(governor|premier|mayor)\s+(of|announces|elected)',
            r'\b(state|provincial)\s+(budget|law|regulation)',
            r'\bin\s+(california|texas|florida|ontario|quebec|bavaria|scotland)'
        ]
    },
    'Local': {
        'keywords': ['local', 'city', 'town', 'municipal', 'neighborhood', 'community', 'council', 'mayor', 'township', 'borough', 'village'],
        'context_patterns': [
            r'\b(city|town|municipal)\s+(council|government|meeting)',
            r'\b(local|community)\s+(news|event|issue|concern)',
            r'\b(mayor|councilman|alderman)\s+(says|announces|elected)',
            r'\b(neighborhood|community)\s+(project|development|issue)',
            r'\b(municipal|city)\s+(budget|ordinance|permit)'
        ]
    }
}

class Sentiment:
    """VADER bands already used for the good / neutral / bad label."""

    POSITIVE = 0.05
    NEGATIVE = -0.05

    @staticmethod
    def label(compound):
        if compound >= Sentiment.POSITIVE:
            return 'positive'
        if compound <= Sentiment.NEGATIVE:
            return 'negative'
        return 'neutral'

    @staticmethod
    def rounded(compound, label=None):
        """Three decimal places, kept inside the same band as the label."""
        score = round(float(compound), 3)
        if label == 'positive' and score < Sentiment.POSITIVE:
            return Sentiment.POSITIVE
        if label == 'negative' and score > Sentiment.NEGATIVE:
            return Sentiment.NEGATIVE
        if label == 'neutral' and score >= Sentiment.POSITIVE:
            return 0.049
        if label == 'neutral' and score <= Sentiment.NEGATIVE:
            return -0.049
        return score

    @staticmethod
    def vader(compound):
        """Raw VADER compound, already on −1..1, at three decimal places."""
        return max(-1.0, min(1.0, round(float(compound), 3)))

    @staticmethod
    def publish(adjusted, label=None):
        """Keyword-adjusted compound, clamped to [-1, 1] after the label is chosen."""
        return max(-1.0, min(1.0, Sentiment.rounded(adjusted, label)))

    @staticmethod
    def scored_text(title, summary=''):
        return f"{title}. {summary}"

    @staticmethod
    def backfill_vader(title, summary=''):
        """Compound for a stored row. Fetch passes the joined text in as the title."""
        joined = Sentiment.scored_text(title or '', summary or '')
        raw = sia.polarity_scores(Sentiment.scored_text(joined)).get('compound', 0.0)
        return Sentiment.vader(raw)


class Regions:
    """One outlet -> region map. Unknown outlets are Global."""

    FALLBACK = 'Global'
    OUTLETS = {
        'BBC News': 'Europe',
        'CNN': 'North America',
        'Reuters': 'Europe',
        'AP News': 'North America',
        'NPR': 'North America',
        'CBS News': 'North America',
        'ABC News': 'North America',
        'Fox News': 'North America',
        'NBC News': 'North America',
        'USA Today': 'North America',
        'Wall Street Journal': 'North America',
        'New York Times': 'North America',
        'Washington Post': 'North America',
        'CBC News': 'North America',
        'Toronto Star': 'North America',
        'The Guardian': 'Europe',
        'Financial Times': 'Europe',
        'The Times': 'Europe',
        'Independent': 'Europe',
        'Telegraph': 'Europe',
        'Sky News': 'Europe',
        'Euronews': 'Europe',
        'Deutsche Welle': 'Europe',
        'France 24': 'Europe',
        'RT News': 'Europe',
        'Sputnik News': 'Europe',
        'Irish Times': 'Europe',
        'Al Jazeera English': 'Middle East',
        'South China Morning Post': 'Asia-Pacific',
        'Japan Times': 'Asia-Pacific',
        'The Hindu': 'Asia-Pacific',
        'Times of India': 'Asia-Pacific',
        'Straits Times': 'Asia-Pacific',
        'Australian Broadcasting Corporation': 'Asia-Pacific',
        'New Zealand Herald': 'Asia-Pacific',
        'Korean Herald': 'Asia-Pacific',
        'Channel News Asia': 'Asia-Pacific',
        'Jerusalem Post': 'Middle East',
        'Haaretz': 'Middle East',
        'Middle East Eye': 'Middle East',
        'Times of Israel': 'Middle East',
        'Daily News Egypt': 'Middle East',
        'News24 South Africa': 'Africa',
        'AllAfrica': 'Africa',
        'Daily Nation Kenya': 'Africa',
        'Buenos Aires Herald': 'South America',
        'Brazil News': 'Global',
        'CNBC': 'North America',
        'Bloomberg': 'North America',
        'MarketWatch': 'North America',
        'Forbes': 'North America',
        'TechCrunch': 'North America',
        'The Verge': 'North America',
        'Wired': 'North America',
        'Ars Technica': 'North America',
        'Engadget': 'North America',
        'Mashable': 'North America',
        'ESPN': 'North America',
        'Sports Illustrated': 'North America',
        'BBC Sport': 'Europe',
        'Sky Sports': 'Europe',
    }
    # Named here so a run reports them instead of silently guessing.
    UNCERTAIN = {
        'Brazil News': (
            'The feed URL is CNN Americas (rss.cnn.com/rss/edition_americas.rss), '
            'not a Brazilian newsroom, so it stays Global.'
        ),
    }

    @staticmethod
    def for_source(name):
        if not name:
            return Regions.FALLBACK
        return Regions.OUTLETS.get(name, Regions.FALLBACK)

    @staticmethod
    def report(seen):
        print('Outlets not confidently placed:')
        for name, reason in Regions.UNCERTAIN.items():
            print(f'  {name}: {reason}')
        missing = sorted({name for name in seen if name and name not in Regions.OUTLETS})
        if missing:
            print('Outlets missing from the region map, scored as Global:')
            for name in missing:
                print(f'  {name}')
        else:
            print('Every outlet in this run is on the region map.')
        return missing


class Dates:
    """Parse a feed timestamp in that outlet's zone and emit UTC ISO-8601.

    ISO-8601 is read as written. dateutil's day-first mode swaps YYYY-MM-DD,
    which is how a September date can come out as 9 January. Numeric dates
    use the outlet's day/month order. Stamps more than an hour ahead are dropped.
    """

    GRACE = timedelta(hours=1)
    # Named zones dateutil no longer guesses. Explicit names beat the outlet default.
    TZINFOS = {
        'EST': ZoneInfo('America/New_York'),
        'EDT': ZoneInfo('America/New_York'),
        'CST': ZoneInfo('America/Chicago'),
        'CDT': ZoneInfo('America/Chicago'),
        'MST': ZoneInfo('America/Denver'),
        'MDT': ZoneInfo('America/Denver'),
        'PST': ZoneInfo('America/Los_Angeles'),
        'PDT': ZoneInfo('America/Los_Angeles'),
        'BST': ZoneInfo('Europe/London'),
        'GMT': ZoneInfo('UTC'),
        'UTC': ZoneInfo('UTC'),
        'CET': ZoneInfo('Europe/Paris'),
        'CEST': ZoneInfo('Europe/Paris'),
    }
    DAY_FIRST = frozenset({
        'BBC News', 'The Guardian', 'Financial Times', 'The Times', 'Independent',
        'Telegraph', 'Sky News', 'Euronews', 'Deutsche Welle', 'France 24',
        'RT News', 'Sputnik News', 'Irish Times', 'Al Jazeera English',
        'South China Morning Post', 'The Hindu', 'Times of India', 'Straits Times',
        'Australian Broadcasting Corporation', 'New Zealand Herald', 'Channel News Asia',
        'Jerusalem Post', 'Haaretz', 'Middle East Eye', 'Times of Israel',
        'Daily News Egypt', 'News24 South Africa', 'AllAfrica', 'Daily Nation Kenya',
        'Buenos Aires Herald', 'BBC Sport', 'Sky Sports',
    })
    ZONES = {
        'BBC News': 'Europe/London',
        'CNN': 'America/New_York',
        'Reuters': 'UTC',
        'AP News': 'America/New_York',
        'NPR': 'America/New_York',
        'CBS News': 'America/New_York',
        'ABC News': 'America/New_York',
        'Fox News': 'America/New_York',
        'NBC News': 'America/New_York',
        'USA Today': 'America/New_York',
        'Wall Street Journal': 'America/New_York',
        'New York Times': 'America/New_York',
        'Washington Post': 'America/New_York',
        'CBC News': 'America/Toronto',
        'Toronto Star': 'America/Toronto',
        'The Guardian': 'Europe/London',
        'Financial Times': 'Europe/London',
        'The Times': 'Europe/London',
        'Independent': 'Europe/London',
        'Telegraph': 'Europe/London',
        'Sky News': 'Europe/London',
        'Euronews': 'Europe/Paris',
        'Deutsche Welle': 'Europe/Berlin',
        'France 24': 'Europe/Paris',
        'RT News': 'Europe/Moscow',
        'Sputnik News': 'Europe/Moscow',
        'Irish Times': 'Europe/Dublin',
        'Al Jazeera English': 'Asia/Qatar',
        'South China Morning Post': 'Asia/Hong_Kong',
        'Japan Times': 'Asia/Tokyo',
        'The Hindu': 'Asia/Kolkata',
        'Times of India': 'Asia/Kolkata',
        'Straits Times': 'Asia/Singapore',
        'Australian Broadcasting Corporation': 'Australia/Sydney',
        'New Zealand Herald': 'Pacific/Auckland',
        'Korean Herald': 'Asia/Seoul',
        'Channel News Asia': 'Asia/Singapore',
        'Jerusalem Post': 'Asia/Jerusalem',
        'Haaretz': 'Asia/Jerusalem',
        'Middle East Eye': 'Europe/London',
        'Times of Israel': 'Asia/Jerusalem',
        'Daily News Egypt': 'Africa/Cairo',
        'News24 South Africa': 'Africa/Johannesburg',
        'AllAfrica': 'UTC',
        'Daily Nation Kenya': 'Africa/Nairobi',
        'Buenos Aires Herald': 'America/Argentina/Buenos_Aires',
        'Brazil News': 'America/New_York',
        'CNBC': 'America/New_York',
        'Bloomberg': 'America/New_York',
        'MarketWatch': 'America/New_York',
        'Forbes': 'America/New_York',
        'TechCrunch': 'America/New_York',
        'The Verge': 'America/New_York',
        'Wired': 'America/New_York',
        'Ars Technica': 'America/New_York',
        'Engadget': 'America/New_York',
        'Mashable': 'America/New_York',
        'ESPN': 'America/New_York',
        'Sports Illustrated': 'America/New_York',
        'BBC Sport': 'Europe/London',
        'Sky Sports': 'Europe/London',
    }

    @staticmethod
    def to_iso(dt):
        utc = dt.astimezone(timezone.utc).replace(microsecond=0)
        return utc.isoformat(timespec='seconds')

    @staticmethod
    def now_iso(now=None):
        return Dates.to_iso(now or datetime.now(timezone.utc))

    @staticmethod
    def next_run_iso(now=None):
        """Next UTC :00 or :30 strictly after now. The fetch cron is every 30 minutes."""
        utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
        minute = 0 if utc.minute < 30 else 30
        slot = utc.replace(minute=minute, second=0)
        if slot <= utc:
            slot += timedelta(minutes=30)
        return Dates.to_iso(slot)

    @staticmethod
    def _parse_string(text, day_first):
        text = str(text).strip()
        if not text:
            return None
        iso_text = text[:-1] + '+00:00' if text.endswith(('Z', 'z')) else text
        looks_iso = len(iso_text) >= 10 and iso_text[4] == '-' and iso_text[7] == '-'
        if looks_iso:
            try:
                return datetime.fromisoformat(iso_text)
            except ValueError:
                day_first = False
        try:
            return dateparser.parse(text, dayfirst=day_first, fuzzy=False, tzinfos=Dates.TZINFOS)
        except (ValueError, OverflowError, TypeError):
            pass
        if not looks_iso:
            try:
                return dateparser.parse(text, dayfirst=not day_first, fuzzy=False, tzinfos=Dates.TZINFOS)
            except (ValueError, OverflowError, TypeError):
                return None
        return None

    @staticmethod
    def _with_zone(dt, source):
        if dt.tzinfo is not None and dt.tzinfo.utcoffset(dt) is not None:
            return dt
        return dt.replace(tzinfo=ZoneInfo(Dates.ZONES.get(source, 'UTC')))

    @staticmethod
    def parse(value, source=''):
        if isinstance(value, datetime):
            parsed = value
        elif isinstance(value, time.struct_time):
            parsed = datetime(*value[:6], tzinfo=timezone.utc)
        else:
            parsed = Dates._parse_string(value, source in Dates.DAY_FIRST)
        if parsed is None:
            return None
        return Dates._with_zone(parsed, source).astimezone(timezone.utc)

    @staticmethod
    def iso(value, source='', now=None):
        parsed = Dates.parse(value, source)
        if parsed is None:
            return None
        limit = (now or datetime.now(timezone.utc)).astimezone(timezone.utc) + Dates.GRACE
        if parsed > limit:
            return None
        return Dates.to_iso(parsed)


class Headlines:
    @staticmethod
    def canonical_url(url):
        if not url or not str(url).strip():
            return ''
        parts = urlsplit(str(url).strip())
        path = parts.path or ''
        if path == '/':
            path = ''
        elif path.endswith('/'):
            path = path.rstrip('/')
        query = urlencode([
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if not key.lower().startswith('utm_')
        ])
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, query, ''))

    @staticmethod
    def normal_text(value):
        text = unicodedata.normalize('NFKC', value or '')
        for src, dst in (
            ('\u2018', "'"), ('\u2019', "'"), ('\u201b', "'"), ('\u2032', "'"),
            ('\u201c', '"'), ('\u201d', '"'),
        ):
            text = text.replace(src, dst)
        return re.sub(r'\s+', ' ', text).strip().casefold()

    @staticmethod
    def dedupe(articles):
        """Keep the earliest published copy. URL first, then title+source."""
        ordered = []
        for index, article in enumerate(articles):
            parsed = Dates.parse(article.get('published'), article.get('source', ''))
            stamp = parsed or datetime.max.replace(tzinfo=timezone.utc)
            ordered.append((stamp, index, article))
        ordered.sort(key=lambda row: (row[0], row[1]))

        seen_urls = set()
        seen_titles = set()
        kept = []
        for _, _, article in ordered:
            url = Headlines.canonical_url(article.get('url'))
            title = Headlines.normal_text(article.get('title'))
            source = Headlines.normal_text(article.get('source'))
            title_key = (title, source) if title else None
            if url and url in seen_urls:
                continue
            if title_key and title_key in seen_titles:
                continue
            if url:
                seen_urls.add(url)
            if title_key:
                seen_titles.add(title_key)
            kept.append(article)
        return kept

    @staticmethod
    def prepare(article, now, stats):
        source = article.get('source') or ''
        if source:
            stats['seen'].add(source)
        parsed = Dates.parse(article.get('published'), source)
        if parsed is None:
            stats['unparsed'] += 1
            if len(stats['unparsed_examples']) < 5:
                stats['unparsed_examples'].append((source, article.get('published'), (article.get('title') or '')[:80]))
            return None
        if parsed > now.astimezone(timezone.utc) + Dates.GRACE:
            stats['future'] += 1
            if len(stats['future_examples']) < 5:
                stats['future_examples'].append((source, article.get('published'), article.get('title', '')[:80]))
            return None
        prepared = dict(article)
        prepared['published'] = Dates.to_iso(parsed)
        prepared['region'] = Regions.for_source(source)
        if prepared['published'] != (article.get('published') or ''):
            stats['dates_rewritten'] += 1
        label = prepared.get('sentiment')
        adjusted = prepared.get('sentiment_score')
        if adjusted is None:
            adjusted = prepared.get('score')
        if adjusted is not None:
            prepared['score'] = Sentiment.publish(adjusted, label)
        if prepared.get('vader') is None:
            prepared['vader'] = Sentiment.backfill_vader(prepared.get('title'), prepared.get('summary'))
            stats['vader_filled'] = stats.get('vader_filled', 0) + 1
        else:
            prepared['vader'] = Sentiment.vader(prepared['vader'])
        if not prepared.get('id'):
            prepared['id'] = generate_article_id(prepared.get('title') or '', prepared.get('url') or '')
        return prepared

    @staticmethod
    def public(article, include_topic=False):
        row = {
            'id': article.get('id') or generate_article_id(article.get('title') or '', article.get('url') or ''),
            'title': article['title'],
            'url': article['url'],
            'source': article['source'],
            'region': article.get('region', Regions.FALLBACK),
            'published': article['published'],
            'sentiment': article['sentiment'],
        }
        if article.get('vader') is not None:
            row['vader'] = article['vader']
        if article.get('score') is not None:
            row['score'] = article['score']
        if include_topic:
            summary = article.get('summary') or ''
            row['topic'] = article.get('topic', 'Other')
            row['summary'] = (summary[:200] + '...') if summary else ''
        return row



def classify_sentiment_enhanced(title: str, summary: str = "") -> dict:
    """Enhanced sentiment classification with context awareness"""
    full_text = Sentiment.scored_text(title, summary)
    
    # Get VADER scores
    scores = sia.polarity_scores(full_text)
    raw = scores.get('compound', 0.0)
    compound = raw
    
    # Context-aware adjustments. The label uses this unclamped value.
    text_lower = full_text.lower()
    
    # Boost positive sentiment for certain contexts
    positive_boosters = [
        r'\b(breakthrough|success|victory|achievement|progress|improvement|recovery|growth)',
        r'\b(celebrates?|honors?|awards?|wins?|triumphs?)',
        r'\b(peace|agreement|resolution|solution|cure)'
    ]
    
    # Boost negative sentiment for certain contexts
    negative_boosters = [
        r'\b(crisis|disaster|tragedy|death|killing|war|conflict|attack)',
        r'\b(fails?|collapse|crash|scandal|corruption|fraud)',
        r'\b(emergency|urgent|critical|severe|devastating)'
    ]
    
    for pattern in positive_boosters:
        if re.search(pattern, text_lower):
            compound += 0.1
    
    for pattern in negative_boosters:
        if re.search(pattern, text_lower):
            compound -= 0.1
    
    label = Sentiment.label(compound)
    return {
        'label': label,
        'compound': compound,
        'vader': Sentiment.vader(raw),
        'score': Sentiment.publish(compound, label),
        'scores': scores
    }

def classify_topic_enhanced(title: str, summary: str = "") -> str:
    """Enhanced topic classification using context patterns and keywords"""
    full_text = f"{title} {summary}".lower()
    
    scores = {}
    
    for topic, patterns in TOPIC_PATTERNS.items():
        score = 0
        
        # Check context patterns (higher weight)
        for pattern in patterns['context_patterns']:
            if re.search(pattern, full_text, re.IGNORECASE):
                score += 3
        
        # Check keywords (lower weight)
        for keyword in patterns['keywords']:
            if keyword in full_text:
                score += 1
        
        scores[topic] = score
    
    # Return topic with highest score, or 'Other' if no matches
    if scores and max(scores.values()) > 0:
        return max(scores, key=scores.get)
    return 'Other'

def generate_article_id(title: str, url: str) -> str:
    """Generate unique ID for article"""
    return hashlib.md5(f"{title}#{url}".encode()).hexdigest()

def entry_published(entry):
    """Raw feed timestamp. Structured UTC is only a fallback when the string is missing."""
    raw = entry.get('published') or entry.get('updated') or ''
    if raw:
        return raw
    parsed = entry.get('published_parsed')
    if not parsed:
        return ''
    try:
        return time.strftime('%Y-%m-%dT%H:%M:%S+00:00', parsed)
    except (TypeError, ValueError):
        return ''

def fetch_rss_feeds():
    """Fetch articles from all RSS feeds"""
    articles = []
    
    for feed_config in FEEDS:
        source = feed_config['name']
        print(f"Fetching {source} ({Regions.for_source(source)})...")
        
        try:
            feed = feedparser.parse(feed_config['url'])
            
            for entry in feed.entries:
                title = entry.get('title', '')
                url = entry.get('link', '')
                summary = entry.get('summary', '') or entry.get('description', '')
                
                if not title or not url:
                    continue
                
                # Same text the label was already scored on.
                full_text = f"{title}. {summary}"
                sentiment = classify_sentiment_enhanced(full_text)
                topic = classify_topic_enhanced(title, summary)
                
                articles.append({
                    'id': generate_article_id(title, url),
                    'title': title,
                    'url': url,
                    'source': source,
                    'region': Regions.for_source(source),
                    'published': entry_published(entry),
                    'sentiment': sentiment['label'],
                    'sentiment_score': sentiment['compound'],
                    'vader': sentiment['vader'],
                    'score': sentiment['score'],
                    'topic': topic,
                    'summary': summary
                })
                
        except Exception as e:
            print(f"Error fetching {source}: {e}")
            continue
    
    return articles

def load_existing_articles():
    """Load existing articles from raw data file"""
    articles = []
    
    if os.path.exists(RAW_PATH):
        try:
            with open(RAW_PATH, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.strip():
                        article = json.loads(line)
                        # Add region if missing (for backward compatibility)
                        if 'region' not in article:
                            article['region'] = 'Global'
                        articles.append(article)
        except Exception as e:
            print(f"Error loading existing articles: {e}")
    
    return articles

def save_articles(articles):
    """Save articles to raw data file"""
    os.makedirs(os.path.dirname(RAW_PATH), exist_ok=True)
    
    with open(RAW_PATH, 'w', encoding='utf-8') as f:
        for article in articles:
            f.write(json.dumps(article) + '\n')

def filter_recent_articles(articles, hours, now):
    """Articles from the last N hours, excluding impossible future stamps."""
    cutoff = now - timedelta(hours=hours)
    limit = now + Dates.GRACE
    recent = []
    for article in articles:
        published = Dates.parse(article.get('published'), article.get('source', ''))
        if published is not None and cutoff <= published <= limit:
            recent.append(article)
    return recent

def generate_statistics(articles):
    """Generate statistics from articles"""
    if not articles:
        return {
            'totals': {'positive': 0, 'neutral': 0, 'negative': 0},
            'by_publication': [],
            'by_region': [],
            'by_topic': [],
            'sample_headlines': []
        }
    
    # Overall sentiment counts
    sentiment_counts = {'positive': 0, 'neutral': 0, 'negative': 0}
    for article in articles:
        sentiment_counts[article['sentiment']] += 1
    
    # By publication
    pub_stats = {}
    for article in articles:
        source = article['source']
        region = article.get('region', 'Global')
        if source not in pub_stats:
            pub_stats[source] = {
                'positive': 0, 'neutral': 0, 'negative': 0, 'count': 0, 'region': region
            }
        
        pub_stats[source][article['sentiment']] += 1
        pub_stats[source]['count'] += 1
    
    by_publication = [
        {'source': source, **stats}
        for source, stats in pub_stats.items()
    ]
    by_publication.sort(key=lambda x: x['count'], reverse=True)
    
    # By region
    region_stats = {}
    for article in articles:
        region = article.get('region', 'Global')
        if region not in region_stats:
            region_stats[region] = {'positive': 0, 'neutral': 0, 'negative': 0, 'count': 0}
        
        region_stats[region][article['sentiment']] += 1
        region_stats[region]['count'] += 1
    
    by_region = [
        {'region': region, **stats}
        for region, stats in region_stats.items()
    ]
    by_region.sort(key=lambda x: x['count'], reverse=True)
    
    # By topic
    topic_stats = {}
    for article in articles:
        topic = article['topic']
        if topic not in topic_stats:
            topic_stats[topic] = {'positive': 0, 'neutral': 0, 'negative': 0, 'count': 0}
        
        topic_stats[topic][article['sentiment']] += 1
        topic_stats[topic]['count'] += 1
    
    by_topic = [
        {'topic': topic, **stats}
        for topic, stats in topic_stats.items()
    ]
    by_topic.sort(key=lambda x: x['count'], reverse=True)
    
    # Sample headlines for main dashboard (limit to 100 for performance)
    sample_headlines = sorted(articles, key=lambda x: x['published'], reverse=True)[:100]
    
    return {
        'totals': sentiment_counts,
        'by_publication': by_publication,
        'by_region': by_region,
        'by_topic': by_topic,
        'sample_headlines': [Headlines.public(a) for a in sample_headlines]
    }

def save_all_headlines(articles, generated_at):
    """Save ALL recent headlines to separate file for the headlines page"""
    all_headlines = sorted(articles, key=lambda x: x['published'], reverse=True)
    
    headlines_data = {
        'generated_at': generated_at,
        'count': len(all_headlines),
        'headlines': [Headlines.public(a, include_topic=True) for a in all_headlines]
    }
    
    with open(ALL_HEADLINES_PATH, 'w', encoding='utf-8') as f:
        json.dump(headlines_data, f, indent=2)
    
    print(f"📰 Saved {len(all_headlines)} headlines to all_headlines.json")

def generate_history_data(articles, now):
    """Generate daily sentiment history for the last 7 days"""
    history = []
    start = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    
    for i in range(ROLLING_DAYS):
        day_start = start - timedelta(days=i)
        day_end = day_start + timedelta(days=1)
        
        day_articles = []
        for article in articles:
            published = Dates.parse(article.get('published'), article.get('source', ''))
            if published is not None and day_start <= published < day_end:
                day_articles.append(article)
        
        sentiment_counts = {'positive': 0, 'neutral': 0, 'negative': 0}
        for article in day_articles:
            sentiment_counts[article['sentiment']] += 1
        
        history.append({
            'date': day_start.strftime('%Y-%m-%d'),
            **sentiment_counts
        })
    
    return list(reversed(history))

def main():
    """Main execution function"""
    socket.setdefaulttimeout(30)
    
    try:
        print("🔄 Fetching news articles...")
    
        new_articles = fetch_rss_feeds()
        now = datetime.now(timezone.utc)
        generated_at = Dates.now_iso(now)
        print(f"📰 Fetched {len(new_articles)} new articles")
        
        existing_articles = load_existing_articles()
        print(f"📚 Loaded {len(existing_articles)} existing articles")
        
        stats = {
            'seen': set(), 'future': 0, 'unparsed': 0, 'dates_rewritten': 0,
            'vader_filled': 0,
            'future_examples': [], 'unparsed_examples': [],
        }
        prepared = []
        for article in existing_articles + new_articles:
            ready = Headlines.prepare(article, now, stats)
            if ready is not None:
                prepared.append(ready)
        deduped = Headlines.dedupe(prepared)
        removed = len(prepared) - len(deduped)
        print(f"📊 Prepared {len(prepared)}; removed {removed} duplicates")
        print(f"🗓️  Dropped {stats['future']} future dates and {stats['unparsed']} unparsed dates")
        print(f"🕒 Rewrote {stats['dates_rewritten']} timestamps to UTC")
        print(f"📉 Filled raw VADER on {stats['vader_filled']} stored rows")
        for source, published, title in stats['future_examples']:
            print(f"   future dropped: {source} {published} {title}")
        for source, published, title in stats['unparsed_examples']:
            print(f"   unparsed dropped: {source} {published!r} {title}")
        Regions.report(stats['seen'])
        
        all_articles = deduped
        if len(all_articles) > MAX_ARTICLES:
            print(f"✂️ Pruning articles from {len(all_articles)} to {MAX_ARTICLES}...")
            all_articles.sort(key=lambda x: x['published'], reverse=True)
            all_articles = all_articles[:MAX_ARTICLES]
            print(f"✅ Pruned to {len(all_articles)} articles")
    
        save_articles(all_articles)
        
        recent_articles = filter_recent_articles(all_articles, hours=24, now=now)
        print(f"🕐 Recent articles (24h): {len(recent_articles)}")
        
        latest_stats = generate_statistics(recent_articles)
        save_all_headlines(recent_articles, generated_at)
        
        week_articles = filter_recent_articles(all_articles, hours=24 * ROLLING_DAYS, now=now)
        history_data = generate_history_data(week_articles, now)
        
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        
        latest_output = {
            'generated_at': generated_at,
            'fetched_at': generated_at,
            'next_run_at': Dates.next_run_iso(now),
            'window_hours': 24,
            **latest_stats
        }
        
        with open(LATEST_PATH, 'w', encoding='utf-8') as f:
            json.dump(latest_output, f, indent=2)
        
        history_output = {
            'generated_at': generated_at,
            'history': history_data
        }
        
        with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
            json.dump(history_output, f, indent=2)
        
        print("✅ Dashboard data updated")
        print(f"📈 Sentiment distribution: {latest_stats['totals']}")
        print(f"🌍 Regions covered: {len(latest_stats['by_region'])}")
        print(f"📋 Topics covered: {len(latest_stats['by_topic'])}")

    except Exception as e:
        print(f"❌ Fatal error in main execution: {e}")
        traceback.print_exc()
        # We don't exit with error code to allow the workflow to "succeed" 
        # even if one run fails, unless it's critical. 
        # But for now let's exit with 1 so we know it failed in CI logs.
        exit(1)

if __name__ == "__main__":
    main()
