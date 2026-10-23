import { Dom, Feed, Score } from './score.js?v=5';

const ICONS = {
  alert: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 16.5h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.3-5.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 4v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  empty: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

class Dashboard {
  constructor(root) {
    this.root = root;
    this.token = 0;
    this.score = null;
  }

  async start() {
    const token = ++this.token;
    this.showLoading();
    try {
      const [latest, history, all] = await Promise.all([
        Feed.json('data/latest.json'),
        Feed.json('data/history.json'),
        Feed.json('data/all_headlines.json'),
      ]);
      if (token !== this.token) return;
      this.render(latest, history, all);
    } catch (error) {
      if (token !== this.token) return;
      this.showError();
    }
  }

  showLoading() {
    this.hideWinner();
    this.root.ariaBusy = 'true';
    this.root.replaceChildren(
      Dom.el('div', { class: 'skel skel-hero', 'aria-hidden': 'true' }),
      Dom.el('div', { class: 'wrap page-stack' }, [
        Dom.el('div', { class: 'skel skel-title' }),
        Dom.el('div', { class: 'skel-grid' }, [
          Dom.el('div', { class: 'skel skel-card' }),
          Dom.el('div', { class: 'skel skel-card' }),
          Dom.el('div', { class: 'skel skel-card' }),
          Dom.el('div', { class: 'skel skel-card' }),
        ]),
        Dom.el('div', { class: 'skel skel-bar' }),
      ]),
    );
  }

  showError() {
    this.hideWinner();
    this.root.ariaBusy = 'false';
    this.root.replaceChildren(Dom.el('div', { class: 'state' }, [
      Dom.el('div', { class: 'state-card' }, [
        Dom.el('div', { class: 'state-mark error' }, [Dom.svg(ICONS.retry)]),
        Dom.el('h2', { text: "The score didn't load" }),
        Dom.el('p', { class: 'muted', text: 'Check your connection and try again.' }),
        Dom.el('button', { class: 'btn btn-dark', type: 'button', text: 'Try again', onClick: () => this.start() }),
      ]),
    ]));
  }

  showEmpty(latest) {
    this.hideWinner();
    this.applyMeta(latest, 0);
    this.root.ariaBusy = 'false';
    this.root.replaceChildren(Dom.el('div', { class: 'state' }, [
      Dom.el('div', { class: 'state-card' }, [
        Dom.el('div', { class: 'state-mark' }, [Dom.svg(ICONS.empty)]),
        Dom.el('h2', { text: 'No headlines in the last 24 hours' }),
        Dom.el('p', { class: 'muted', text: "The feeds were quiet, so there's no score to show." }),
      ]),
    ]));
  }

  hideWinner() {
    const winner = document.getElementById('winner');
    if (winner) winner.hidden = true;
  }

  applyMeta(latest, outlets) {
    const stamp = latest?.generated_at ? Score.stamp(latest.generated_at) : '—';
    document.querySelectorAll('[data-feed-count]').forEach((node) => {
      node.textContent = outlets ? Score.formatCount(outlets) : 'the';
    });
    document.querySelectorAll('[data-generated]').forEach((node) => {
      node.textContent = stamp;
      if (latest?.generated_at) node.dateTime = latest.generated_at;
    });
  }

  fillWinner(latest, total, outlets) {
    const winner = document.getElementById('winner');
    if (!winner) return;
    const result = Score.winner(latest.totals.positive, latest.totals.negative, latest.totals.neutral);
    winner.hidden = false;
    winner.replaceChildren(
      Dom.el('span', { class: 'winner-kicker caps', text: 'Today' }),
      Dom.el('span', {
        class: 'winner-long',
        text: `${result.long} · ${Score.formatCount(total)} headlines · ${Score.formatCount(outlets)} outlets`,
      }),
      Dom.el('span', { class: 'winner-short', text: result.short }),
    );
  }

  render(latest, history, all) {
    const totals = latest.totals || { positive: 0, neutral: 0, negative: 0 };
    const total = totals.positive + totals.neutral + totals.negative;
    const outlets = (latest.by_publication || []).length;
    this.applyMeta(latest, outlets);
    if (!total) {
      this.showEmpty(latest);
      return;
    }
    this.score = { latest, totals, total, outlets };
    this.fillWinner(latest, total, outlets);
    const generated = Score.oldest(latest.generated_at, history.generated_at, all.generated_at);
    const kept = Score.visibleHeadlines(all.headlines || latest.sample_headlines || [], all.generated_at || latest.generated_at);
    const goodStories = Score.sortHeadlines(kept.filter((item) => Score.sentimentKey(item.sentiment) === 'good')).slice(0, 4);
    const badStories = Score.sortHeadlines(kept.filter((item) => Score.sentimentKey(item.sentiment) === 'bad')).slice(0, 4);
    const banner = Score.isStale(generated) ? this.staleBanner(generated) : null;
    const stack = Dom.el('div', { class: 'wrap page-stack' }, [
      this.sides(totals, goodStories, badStories),
      this.week(history, latest.generated_at),
      this.where(latest),
      this.shareSection(),
    ]);
    this.root.ariaBusy = 'false';
    this.root.replaceChildren(...[banner, this.hero(latest, totals, total, outlets), stack].filter(Boolean));
    this.bindShare();
  }

  staleBanner(iso) {
    return Dom.el('div', { class: 'wrap' }, [
      Dom.el('div', { class: 'banner', role: 'status' }, [
        Dom.svg(ICONS.alert),
        Dom.el('p', { text: Score.staleCopy(iso) }),
      ]),
    ]);
  }

  hero(latest, totals, total, outlets) {
    const parts = Score.londonParts(latest.generated_at);
    const hero = Dom.el('section', { class: 'hero', id: 'today', 'aria-label': "Today's score" });
    const bands = [
      ['good', totals.positive, `${Score.formatPercent(totals.positive, total)}`, `${Score.formatCount(totals.positive)} good headlines`],
      ['neutral', totals.neutral, `${Score.formatPercent(totals.neutral, total)}`, 'Neutral'],
      ['bad', totals.negative, `${Score.formatPercent(totals.negative, total)}`, `${Score.formatCount(totals.negative)} bad headlines`],
    ];
    bands.forEach(([name, count, pct, sub]) => {
      if (!count) return;
      const band = Dom.el('div', { class: `hero-band hero-${name}` });
      band.style.flex = `${count} 1 0`;
      if (name === 'neutral') {
        band.append(
          Dom.el('p', { class: 'caps', text: 'Neutral' }),
          Dom.el('p', { class: 'hero-pct num', text: pct }),
        );
      } else {
        band.append(
          Dom.el('p', { class: 'hero-pct num', text: pct }),
          Dom.el('p', { class: 'hero-sub', text: sub }),
        );
      }
      hero.append(band);
    });
    const meta = Dom.el('p', {
      class: 'hero-meta mono',
      text: `Last ${latest.window_hours || 24} hours · ${Score.formatCount(outlets)} outlets · updated ${parts.time} ${parts.tz} · refreshes every 30 min`,
    });
    return Dom.el('div', {}, [hero, Dom.el('div', { class: 'wrap' }, [meta])]);
  }

  sides(totals, goodStories, badStories) {
    return Dom.el('section', { 'aria-labelledby': 'sides-title' }, [
      Dom.el('div', { class: 'section-head' }, [
        Dom.el('h2', { id: 'sides-title', text: "Today's two sides" }),
        Dom.el('p', { class: 'muted', text: 'The latest headlines pulling each way. Tap a card to read the story at the source.' }),
      ]),
      Dom.el('div', { class: 'sides', style: 'margin-top: 24px' }, [
        this.column('good', totals.positive, goodStories),
        this.column('bad', totals.negative, badStories),
      ]),
    ]);
  }

  column(side, count, stories) {
    const label = side === 'good' ? 'Good' : 'Bad';
    return Dom.el('div', { class: 'side' }, [
      Dom.el('div', { class: 'side-kicker' }, [
        Dom.el('span', { class: `pill pill-${side}`, text: label }),
        Dom.el('span', { class: 'muted small', text: `${Score.formatCount(count)} ${label.toLowerCase()} headlines · newest first` }),
      ]),
      Dom.el('div', { class: 'stories' }, stories.length
        ? stories.map((story) => this.storyCard(story, side))
        : [Dom.el('p', { class: 'muted', text: `No ${label.toLowerCase()} headlines in this window.` })]),
      Dom.el('a', { class: 'text-link', href: `headlines.html?sentiment=${side}`, text: `See all ${label.toLowerCase()} headlines →` }),
    ]);
  }

  storyCard(story, side) {
    const bits = [
      story.source,
      Score.relativeTime(story.published),
      story.region,
      story.topic,
    ].filter(Boolean);
    return Dom.el('a', {
      class: `story story-${side}`,
      href: story.url || '#',
      target: '_blank',
      rel: 'noopener noreferrer',
      'aria-label': `${story.title}. ${story.source || 'Unknown source'}. Read at source.`,
    }, [
      Dom.el('span', { class: `pill pill-${side}`, text: side === 'good' ? 'Good' : 'Bad' }),
      Dom.el('span', { class: 'story-title', text: story.title }),
      Dom.el('p', { class: 'story-meta', text: bits.join(' · ') }),
      Dom.el('span', { class: 'story-read', text: 'Read →' }),
    ]);
  }

  week(history, generatedAt) {
    const days = history.history || [];
    const sum = Score.sumDays(days);
    const total = sum.positive + sum.neutral + sum.negative;
    const max = Math.max(1, ...days.map((day) => day.positive + day.neutral + day.negative));
    return Dom.el('section', { id: 'week', 'aria-labelledby': 'week-title' }, [
      Dom.el('div', { class: 'section-head' }, [
        Dom.el('h2', { id: 'week-title', text: 'This week' }),
        Dom.el('p', { class: 'muted', text: "Share of each day's headlines, good on top, bad underneath. Net = good − bad in points. Today is still filling up." }),
      ]),
      Dom.el('div', { class: 'week-layout', style: 'margin-top: 24px' }, [
        Dom.el('div', {}, [
          Dom.el('div', { class: 'days', role: 'list' }, days.map((day) => this.dayColumn(day, generatedAt, max))),
          Dom.el('div', { class: 'legend' }, [
            Dom.el('span', {}, [Dom.el('i', { class: 'swatch good' }), 'Good']),
            Dom.el('span', {}, [Dom.el('i', { class: 'swatch neutral' }), 'Neutral']),
            Dom.el('span', {}, [Dom.el('i', { class: 'swatch' }), 'Bad']),
            Dom.el('span', {}, [Dom.el('i', { class: 'swatch partial' }), 'today so far']),
          ]),
        ]),
        Dom.el('div', { class: 'week-cards' }, [
          this.stat('good', `Good · ${days.length} days`, Score.formatPercent(sum.positive, total)),
          this.stat('bad', `Bad · ${days.length} days`, Score.formatPercent(sum.negative, total)),
          this.stat('neutral', `Neutral · ${days.length} days`, Score.formatPercent(sum.neutral, total)),
          Dom.el('div', { class: 'stat stat-count' }, [
            Dom.el('b', { class: 'num', text: Score.formatCount(total) }),
            Dom.el('p', { text: 'headlines' }),
            Dom.el('p', { class: 'muted', text: Score.weekRecord(days) }),
          ]),
        ]),
      ]),
    ]);
  }

  dayColumn(day, generatedAt, max) {
    const count = day.positive + day.neutral + day.negative;
    const net = Score.dayNet(day.positive, day.negative, day.neutral);
    const partial = Score.isPartialDay(day.date, generatedAt);
    const height = Math.max(8, Math.round((count / max) * 132));
    const bar = Dom.el('div', { class: 'day-bar', style: `height:${height}px` });
    if (count) {
      bar.append(
        Dom.el('i', { class: 'seg-good', style: `flex:${day.positive} 1 0` }),
        Dom.el('i', { class: 'seg-neutral', style: `flex:${day.neutral} 1 0` }),
        Dom.el('i', { class: 'seg-bad', style: `flex:${day.negative} 1 0` }),
      );
    }
    const sign = net > 0 ? `+${net}` : String(net);
    return Dom.el('div', { class: `day${partial ? ' is-partial' : ''}`, role: 'listitem' }, [
      Dom.el('span', { class: `day-net num ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}`, text: sign }),
      bar,
      Dom.el('span', { class: 'day-label', text: `${Score.dayLabel(day.date)}${partial ? '*' : ''}` }),
      Dom.el('span', { class: 'day-count num', text: Score.formatCount(count) }),
    ]);
  }

  stat(kind, label, value) {
    return Dom.el('div', { class: `stat stat-${kind}` }, [
      Dom.el('p', { class: 'caps', text: label }),
      Dom.el('b', { class: 'num', text: value }),
    ]);
  }

  where(latest) {
    const totals = latest.totals || {};
    const total = (totals.positive || 0) + (totals.neutral || 0) + (totals.negative || 0);
    const ranked = [...(latest.by_region || [])].sort((a, b) => b.count - a.count);
    const regions = ranked.filter((row) => row.region !== 'Global');
    const global = ranked.find((row) => row.region === 'Global');
    const topics = [...(latest.by_topic || [])].sort((a, b) => b.count - a.count);
    const regionGroup = this.meterGroup('By region', regions, 'region');
    const globalCount = global ? global.count : 0;
    regionGroup.append(Dom.el('p', {
      class: 'meter-aside',
      text: `Global is separate: ${Score.formatCount(globalCount)} headlines (${Score.formatPercent(globalCount, total)}) from outlets with no home region. They are not a bar.`,
    }));
    return Dom.el('section', { id: 'where', 'aria-labelledby': 'where-title' }, [
      Dom.el('div', { class: 'section-head' }, [
        Dom.el('h2', { id: 'where-title', text: "Who's winning where" }),
        Dom.el('p', { class: 'muted', text: 'Each bar is one home region or topic over the last 24 hours. A tie is under 2 points. Smaller samples are faded. Global is counted beside the region bars.' }),
      ]),
      Dom.el('div', { class: 'where-grid', style: 'margin-top: 8px' }, [
        regionGroup,
        this.meterGroup('By topic', topics, 'topic'),
      ]),
    ]);
  }

  meterGroup(title, rows, key) {
    return Dom.el('div', {}, [
      Dom.el('h3', { text: title }),
      Dom.el('div', { class: 'meter-list' }, rows.map((row) => this.meter(row[key], row))),
    ]);
  }

  meter(name, row) {
    const result = Score.meter(row.positive, row.negative, row.neutral, row.count);
    const sample = result.faded ? ' · short sample' : '';
    return Dom.el('div', { class: `meter${result.faded ? ' is-short' : ''}` }, [
      Dom.el('div', { class: 'meter-top' }, [
        Dom.el('span', { class: 'meter-name', text: name }),
        Dom.el('span', { class: 'meter-n', text: `${Score.formatCount(row.count)} headlines${sample}` }),
        Dom.el('span', { class: `meter-result num ${result.side}`, text: result.label }),
      ]),
      Dom.el('div', { class: 'meter-track' }, [
        Dom.el('span', { class: `meter-fill ${result.side === 'good' ? 'good' : 'bad'}`, style: `width:${result.width}%` }),
      ]),
    ]);
  }

  shareSection() {
    return Dom.el('section', { class: 'share', id: 'share', 'aria-labelledby': 'share-title' }, [
      Dom.el('div', {}, [
        Dom.el('h2', { id: 'share-title', text: "Share today's score" }),
        Dom.el('p', { text: "A ready-made card of today's tug of war (1200×630 for X, LinkedIn and link previews)." }),
      ]),
      Dom.el('div', { class: 'share-actions' }, [
        Dom.el('button', { class: 'btn btn-dark', type: 'button', id: 'download-card', text: 'Download image' }),
        Dom.el('button', { class: 'btn btn-ghost', type: 'button', id: 'copy-link', text: 'Copy link' }),
      ]),
    ]);
  }

  bindShare() {
    document.getElementById('download-card')?.addEventListener('click', () => this.downloadCard());
    document.getElementById('copy-link')?.addEventListener('click', (event) => this.copyLink(event.currentTarget));
  }

  async copyLink(button) {
    const url = new URL(window.location.href);
    url.hash = '';
    url.search = '';
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch (error) {
      const input = Dom.el('textarea', { text: url.toString() });
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    const previous = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(() => { button.textContent = previous; }, 1600);
  }

  async downloadCard() {
    if (!this.score) return;
    await document.fonts.ready;
    const { totals, total, outlets, latest } = this.score;
    const width = 1200;
    const height = 630;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const goodW = (totals.positive / total) * width;
    const neutralW = (totals.neutral / total) * width;
    ctx.fillStyle = '#FFD43B';
    ctx.fillRect(0, 0, goodW, height);
    ctx.fillStyle = '#C9C3B4';
    ctx.fillRect(goodW, 0, neutralW, height);
    ctx.fillStyle = '#16161D';
    ctx.fillRect(goodW + neutralW, 0, width - goodW - neutralW, height);
    const result = Score.winner(totals.positive, totals.negative, totals.neutral);
    ctx.fillStyle = '#16161D';
    ctx.font = '700 28px "Space Grotesk", sans-serif';
    ctx.fillText('GOOD NEWS', 48, 80);
    ctx.font = '700 92px "Space Grotesk", sans-serif';
    ctx.fillText(Score.formatPercent(totals.positive, total), 48, 230);
    ctx.font = '500 24px Inter, sans-serif';
    ctx.fillText(`${Score.formatCount(totals.positive)} good headlines`, 48, 280);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 28px "Space Grotesk", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('BAD NEWS', width - 48, 80);
    ctx.font = '700 92px "Space Grotesk", sans-serif';
    ctx.fillText(Score.formatPercent(totals.negative, total), width - 48, 230);
    ctx.font = '500 24px Inter, sans-serif';
    ctx.fillText(`${Score.formatCount(totals.negative)} bad headlines`, width - 48, 280);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#16161D';
    ctx.font = '700 22px "Space Grotesk", sans-serif';
    ctx.fillText(Score.formatPercent(totals.neutral, total), goodW + neutralW / 2, height / 2);
    ctx.font = '700 18px "Space Grotesk", sans-serif';
    const pill = `${result.long} · ${Score.formatCount(total)} headlines · ${outlets} outlets`;
    ctx.fillStyle = '#16161D';
    const pillW = Math.min(width - 80, ctx.measureText(pill).width + 48);
    ctx.fillRect((width - pillW) / 2, height - 120, pillW, 48);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(pill, width / 2, height - 90);
    ctx.font = '500 18px "IBM Plex Mono", monospace';
    ctx.fillText('goodnewsbadnews.xyz', width / 2, height - 36);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const link = Dom.el('a', { href: URL.createObjectURL(blob), download: 'goodnewsbadnews-today.png' });
    link.click();
    URL.revokeObjectURL(link.href);
    void latest;
  }
}

const root = document.getElementById('main');
if (root && document.body.dataset.page === 'dashboard') {
  new Dashboard(root).start();
}
