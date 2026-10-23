/**
 * Shared score rules for the dashboard and the headlines page.
 * Both pages load this as a plain ES module. There is no build step.
 */

export class Score {
  static LONDON = 'Europe/London';
  static HOUR = 60 * 60 * 1000;
  static STALE_AFTER = 2 * this.HOUR;
  static FUTURE_GRACE = 1 * this.HOUR;
  static SHORT_SAMPLE = 30;
  static TIE_MARGIN = 1;
  static METER_TIE = 2;

  static shares(good, bad, neutral) {
    const total = (good || 0) + (bad || 0) + (neutral || 0);
    if (!total) return { good: 0, bad: 0, neutral: 0, total: 0 };
    return {
      good: (good / total) * 100,
      bad: (bad / total) * 100,
      neutral: (neutral / total) * 100,
      total,
    };
  }

  static format1(value) {
    return (Math.round((value + Number.EPSILON) * 10) / 10).toFixed(1);
  }

  /** VADER compound, three decimal places, for the headline meta line. */
  static formatScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    const text = number.toFixed(3);
    if (text === '-0.000') return '0.000';
    return text.replace('-', '\u2212');
  }

  static formatPercent(count, total) {
    if (!total) return '0.0%';
    return `${this.format1((count / total) * 100)}%`;
  }

  static formatCount(value) {
    return new Intl.NumberFormat('en-GB').format(value || 0);
  }

  /**
   * Tie when the unrounded good/bad gap is under 1 point.
   * Otherwise the pill uses that gap rounded to 1 decimal
   * (so 6.66 points reads "6.7", matching the approved score).
   */
  static winner(good, bad, neutral) {
    const share = this.shares(good, bad, neutral);
    const margin = Math.abs(share.good - share.bad);
    if (!share.total || margin < this.TIE_MARGIN) {
      return { side: 'tie', margin, long: 'Tie', short: 'Tie' };
    }
    const side = share.good > share.bad ? 'good' : 'bad';
    const points = this.format1(margin);
    const name = side === 'good' ? 'GOOD' : 'BAD';
    return {
      side,
      margin,
      long: `${name} wins by ${points} points`,
      short: `${name} wins by ${points} pts`,
    };
  }

  static meter(good, bad, neutral, count) {
    const share = this.shares(good, bad, neutral);
    const diff = Math.abs(share.good - share.bad);
    const tie = !share.total || diff < this.METER_TIE;
    const side = share.good === share.bad ? 'tie' : share.good > share.bad ? 'good' : 'bad';
    const points = Math.round(diff);
    return {
      tie,
      side: tie ? 'tie' : side,
      points,
      width: tie ? 0 : Math.min(100, (diff / 50) * 100),
      faded: (count || 0) < this.SHORT_SAMPLE,
      label: tie ? 'TIE' : `${side === 'good' ? 'GOOD' : 'BAD'} +${points}`,
    };
  }

  static dayNet(good, bad, neutral) {
    const share = this.shares(good, bad, neutral);
    if (!share.total) return 0;
    return Math.round(share.good - share.bad);
  }

  static weekRecord(days) {
    let good = 0;
    let bad = 0;
    for (const day of days) {
      const net = this.dayNet(day.positive, day.negative, day.neutral);
      if (net > 0) good += 1;
      else if (net < 0) bad += 1;
    }
    const total = days.length;
    if (bad > good) return `Bad won ${bad} of ${total} days`;
    if (good > bad) return `Good won ${good} of ${total} days`;
    return `Split week, ${good} apiece`;
  }

  static sumDays(days) {
    return days.reduce(
      (sum, day) => ({
        positive: sum.positive + (day.positive || 0),
        neutral: sum.neutral + (day.neutral || 0),
        negative: sum.negative + (day.negative || 0),
      }),
      { positive: 0, neutral: 0, negative: 0 },
    );
  }

  static parseTime(value) {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  }

  static utcDay(iso) {
    const time = this.parseTime(iso);
    if (time == null) return '';
    return new Date(time).toISOString().slice(0, 10);
  }

  static isPartialDay(date, generatedAt) {
    return Boolean(date) && date === this.utcDay(generatedAt);
  }

  static isStale(iso, now = Date.now()) {
    const time = this.parseTime(iso);
    if (time == null) return false;
    return now - time > this.STALE_AFTER;
  }

  static ageHours(iso, now = Date.now()) {
    const time = this.parseTime(iso);
    if (time == null) return 0;
    return Math.max(0, Math.floor((now - time) / this.HOUR));
  }

  static oldest(...isos) {
    return isos
      .filter((iso) => this.parseTime(iso) != null)
      .sort((a, b) => this.parseTime(a) - this.parseTime(b))[0] || null;
  }

  static visibleHeadlines(list, generatedAt) {
    const generated = this.parseTime(generatedAt);
    if (generated == null) return [];
    const cutoff = generated + this.FUTURE_GRACE;
    return (list || []).filter((item) => {
      const time = this.parseTime(item.published);
      return time != null && time <= cutoff;
    });
  }

  static sortHeadlines(list, direction = 'newest') {
    return list
      .map((item, index) => ({ item, index, time: this.parseTime(item.published) ?? 0 }))
      .sort((a, b) => {
        if (a.time === b.time) return a.index - b.index;
        return direction === 'oldest' ? a.time - b.time : b.time - a.time;
      })
      .map((row) => row.item);
  }

  static londonParts(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return { date: '—', time: '—', tz: '' };
    const day = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.LONDON,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date);
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.LONDON,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
    const tz = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.LONDON,
      timeZoneName: 'short',
    })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value || '';
    return { date: day, time, tz };
  }

  static stamp(iso) {
    const parts = this.londonParts(iso);
    return `${parts.date}, ${parts.time} ${parts.tz}`.trim();
  }

  static clock(iso) {
    return this.londonParts(iso).time;
  }

  static dayLabel(dateStr) {
    const date = new Date(`${dateStr}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return dateStr;
    const weekday = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(date);
    return `${weekday} ${date.getUTCDate()}`;
  }

  static relativeTime(iso, now = Date.now()) {
    const time = this.parseTime(iso);
    if (time == null) return '';
    const minutes = Math.round((now - time) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.round(hours / 24);
    return `${days} d ago`;
  }

  static staleCopy(iso, now = Date.now()) {
    const hours = this.ageHours(iso, now);
    const when = this.londonParts(iso).date;
    const unit = hours === 1 ? 'hour' : 'hours';
    return `Data from ${when} is ${hours} ${unit} old. The score may have moved.`;
  }

  static sentimentKey(value) {
    if (value === 'positive' || value === 'good') return 'good';
    if (value === 'negative' || value === 'bad') return 'bad';
    return 'neutral';
  }

  static sentimentLabel(value) {
    const key = this.sentimentKey(value);
    if (key === 'good') return 'Good';
    if (key === 'bad') return 'Bad';
    return 'Neutral';
  }
}

export class Feed {
  static delays = [0, 400, 1000, 2200];

  static async json(url) {
    let lastError = null;
    for (let attempt = 0; attempt < this.delays.length; attempt += 1) {
      if (this.delays[attempt]) {
        await new Promise((resolve) => setTimeout(resolve, this.delays[attempt]));
      }
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Failed to load ${url} (${response.status})`);
        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`Failed to load ${url}`);
  }
}

export class Dom {
  static el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value == null || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'hidden') node.hidden = Boolean(value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, String(value));
    });
    children.forEach((child) => {
      if (child == null || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  static clear(node) {
    node.replaceChildren();
  }

  static svg(path, label) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', label ? 'false' : 'true');
    svg.setAttribute('fill', 'none');
    if (label) svg.setAttribute('aria-label', label);
    else svg.setAttribute('focusable', 'false');
    svg.innerHTML = path;
    return svg;
  }
}
