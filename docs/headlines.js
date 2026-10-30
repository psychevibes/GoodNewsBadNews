import { Dom, Feed, Score } from './score.js?v=6';

const SEARCH_ICON = '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const CHEVRON = '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const ALERT = '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 16.5h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>';

class Overlay {
  constructor(onCancel) {
    this.onCancel = onCancel;
    this.returnFocus = null;
    this.backdrop = Dom.el('div', { class: 'backdrop', onClick: () => this.cancel() });
    this.panel = Dom.el('div', { class: 'popover', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
    this.root = Dom.el('div', { class: 'overlay', hidden: true }, [this.backdrop, this.panel]);
    document.body.append(this.root);
    this.onKey = (event) => this.handleKey(event);
  }

  open(anchor) {
    this.returnFocus = anchor || document.activeElement;
    this.root.hidden = false;
    document.body.style.overflow = 'hidden';
    const sheet = window.matchMedia('(max-width: 899px)').matches;
    this.panel.classList.toggle('is-sheet', sheet);
    if (!sheet && anchor?.getBoundingClientRect) {
      const rect = anchor.getBoundingClientRect();
      const width = 360;
      const left = Math.min(rect.left, window.innerWidth - width - 16);
      this.panel.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 80)}px`;
      this.panel.style.left = `${Math.max(16, left)}px`;
    } else {
      this.panel.style.top = '';
      this.panel.style.left = '';
    }
    document.addEventListener('keydown', this.onKey);
    const preferred = this.panel.querySelector('input') || this.focusable()[0] || this.panel;
    preferred.focus();
  }

  close() {
    this.root.hidden = true;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', this.onKey);
    this.returnFocus?.focus?.();
    this.root.remove();
  }

  cancel() {
    this.close();
    this.onCancel?.();
  }

  focusable() {
    return [...this.panel.querySelectorAll('a, button, input, select, textarea')]
      .filter((node) => !node.disabled && !node.closest('[hidden]'));
  }

  handleKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = this.focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

class HeadlinesPage {
  constructor() {
    this.token = 0;
    this.stage = document.getElementById('stage');
    this.banner = document.getElementById('banner');
    this.shown = 10;
    this.headlines = [];
    this.latest = null;
    this.generatedAt = null;
    this.state = this.read();
    this.search = null;
    window.addEventListener('popstate', () => {
      this.state = this.read();
      this.shown = 10;
      if (this.search) this.search.value = this.state.q;
      this.paint();
    });
  }

  read() {
    const params = new URLSearchParams(window.location.search);
    const sentiment = params.get('sentiment');
    const sources = params.getAll('source');
    return {
      q: params.get('q') || '',
      sentiment: ['good', 'bad', 'neutral'].includes(sentiment) ? sentiment : 'all',
      sources: sources.length ? new Set(sources) : null,
      region: params.get('region') || 'all',
      topic: params.get('topic') || 'all',
      sort: params.get('sort') === 'oldest' ? 'oldest' : 'newest',
    };
  }

  write(replace) {
    const params = new URLSearchParams();
    if (this.state.q) params.set('q', this.state.q);
    if (this.state.sentiment !== 'all') params.set('sentiment', this.state.sentiment);
    if (this.state.sources) [...this.state.sources].sort().forEach((source) => params.append('source', source));
    if (this.state.region !== 'all') params.set('region', this.state.region);
    if (this.state.topic !== 'all') params.set('topic', this.state.topic);
    if (this.state.sort !== 'newest') params.set('sort', this.state.sort);
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ''}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (next === current) return;
    if (replace) history.replaceState(null, '', next);
    else history.pushState(null, '', next);
  }

  async start() {
    const token = ++this.token;
    this.showLoading();
    try {
      const [all, latest] = await Promise.all([
        Feed.json('data/all_headlines.json'),
        Feed.json('data/latest.json'),
      ]);
      if (token !== this.token) return;
      this.latest = latest;
      this.generatedAt = all.generated_at || latest.generated_at;
      this.headlines = Score.visibleHeadlines(all.headlines || [], this.generatedAt);
      this.sources = this.collect('source');
      this.regions = this.collect('region');
      this.topics = this.collect('topic');
      this.render(latest);
    } catch (error) {
      if (token !== this.token) return;
      this.showError();
    }
  }

  collect(key) {
    const counts = new Map();
    this.headlines.forEach((item) => {
      const name = item[key] || (key === 'topic' ? 'Other' : 'Unknown');
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  showLoading() {
    this.banner.replaceChildren();
    document.getElementById('winner').hidden = true;
    this.stage.replaceChildren(Dom.el('div', { class: 'skel-stack', 'aria-hidden': 'true' }, [
      Dom.el('div', { class: 'skel', style: 'height:48px;border-radius:999px' }),
      Dom.el('div', { class: 'skel skel-line' }),
      Dom.el('div', { class: 'skel skel-row' }),
      Dom.el('div', { class: 'skel skel-row' }),
      Dom.el('div', { class: 'skel skel-row' }),
      Dom.el('div', { class: 'skel skel-row' }),
    ]));
  }

  showError() {
    this.banner.replaceChildren();
    document.getElementById('winner').hidden = true;
    this.stage.replaceChildren(Dom.el('div', { class: 'state' }, [
      Dom.el('div', { class: 'state-card' }, [
        Dom.el('h2', { text: "The headlines didn't load" }),
        Dom.el('p', { class: 'muted', text: 'Check your connection and try again.' }),
        Dom.el('button', { class: 'btn btn-dark', type: 'button', text: 'Try again', onClick: () => this.start() }),
      ]),
    ]));
  }

  render(latest) {
    const totals = latest.totals || { positive: 0, neutral: 0, negative: 0 };
    const total = totals.positive + totals.neutral + totals.negative;
    const outlets = (latest.by_publication || []).length || this.sources.length;
    this.fillWinner(latest, totals, total, outlets);
    this.fillMeta(latest, outlets);
    const parts = Score.londonParts(this.generatedAt);
    const lede = document.getElementById('lede');
    if (lede) {
      lede.textContent = `${Score.formatCount(this.headlines.length)} headlines from ${Score.formatCount(outlets)} outlets in the last 24 hours, newest first. Updated ${Score.stamp(this.generatedAt)}.`;
    }
    const generated = Score.oldest(latest.generated_at, this.generatedAt);
    this.banner.replaceChildren(...(Score.isStale(generated)
      ? [Dom.el('div', { class: 'banner', role: 'status' }, [
        Dom.svg(ALERT),
        Dom.el('p', { text: Score.staleCopy(generated) }),
      ])]
      : []));

    this.search = Dom.el('input', {
      type: 'search',
      id: 'headline-search',
      placeholder: `Search ${Score.formatCount(this.headlines.length)} headlines...`,
      value: this.state.q,
      autocomplete: 'off',
      'aria-label': 'Search headlines',
    });
    this.search.addEventListener('input', () => {
      this.state.q = this.search.value;
      this.shown = 10;
      this.write(true);
      this.paint();
    });

    this.chips = Dom.el('div', { class: 'chips', role: 'group', 'aria-label': 'Sentiment' });
    this.sourceBtn = this.menuButton('Sources', () => this.openSources(this.sourceBtn));
    this.regionBtn = this.menuButton('Region', null);
    this.topicBtn = this.menuButton('Topic', null);
    this.sortBtn = this.menuButton('Sort', null);
    this.regionMenu = this.attachMenu(this.regionBtn, () => this.optionList(this.regions, this.state.region), (value) => {
      this.state.region = value;
      this.commitFilter();
    });
    this.topicMenu = this.attachMenu(this.topicBtn, () => this.optionList(this.topics, this.state.topic), (value) => {
      this.state.topic = value;
      this.commitFilter();
    });
    this.sortMenu = this.attachMenu(this.sortBtn, () => ([
      { value: 'newest', label: 'Newest first', selected: this.state.sort === 'newest' },
      { value: 'oldest', label: 'Oldest first', selected: this.state.sort === 'oldest' },
    ]), (value) => {
      this.state.sort = value;
      this.commitFilter();
    });

    this.filterBtn = Dom.el('button', {
      class: 'btn btn-ghost filters-mobile',
      type: 'button',
      onClick: () => this.openFilters(),
    }, [Dom.el('span', { text: 'Filters' })]);

    this.results = Dom.el('p', { class: 'results small muted', 'aria-live': 'polite' });
    this.rows = Dom.el('div', { id: 'rows' });
    this.loadRow = Dom.el('div', { class: 'load-row' });

    const listHeadDate = Dom.el('p', { class: 'caps', text: `Today · ${parts.date}` });
    const listHeadZone = Dom.el('p', { class: 'tiny muted', text: `Times in UK time (${parts.tz || 'UK'})` });

    this.stage.replaceChildren(
      Dom.el('div', { class: 'tools' }, [
        Dom.el('div', { class: 'search' }, [Dom.svg(SEARCH_ICON), this.search]),
        Dom.el('div', { class: 'tool-row' }, [
          this.chips,
          Dom.el('div', { class: 'filters-desktop' }, [
            this.sourceBtn.parentElement,
            this.regionBtn.parentElement,
            this.topicBtn.parentElement,
            this.sortBtn.parentElement,
          ]),
          this.filterBtn,
        ]),
        this.results,
      ]),
      Dom.el('div', { class: 'browser' }, [
        Dom.el('div', {}, [
          Dom.el('div', { class: 'list-head' }, [
            Dom.el('span'),
            listHeadDate,
            listHeadZone,
          ]),
          this.rows,
          this.loadRow,
        ]),
        this.glance(totals, total),
      ]),
    );
    this.paint();
  }

  menuButton(label, onClick) {
    const button = Dom.el('button', {
      class: 'btn btn-ghost menu-btn',
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
    }, [
      Dom.el('span', { class: 'menu-label', text: label }),
      Dom.svg(CHEVRON),
    ]);
    button.querySelector('svg').classList.add('chev');
    if (onClick) button.addEventListener('click', onClick);
    const wrap = Dom.el('div', { class: 'menu-wrap' }, [button]);
    return button;
  }

  attachMenu(button, getOptions, onPick) {
    const menu = Dom.el('div', { class: 'menu', role: 'listbox', hidden: true });
    button.parentElement.append(menu);
    button.setAttribute('aria-haspopup', 'listbox');
    const close = () => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      menu.replaceChildren(...getOptions().map((option) => Dom.el('button', {
        type: 'button',
        role: 'option',
        'aria-selected': option.selected ? 'true' : 'false',
        text: option.label,
        onClick: () => {
          onPick(option.value);
          close();
          button.focus();
        },
      })));
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      menu.querySelector('[aria-selected="true"]')?.focus();
    };
    button.addEventListener('click', () => (menu.hidden ? open() : close()));
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        open();
      }
    });
    menu.addEventListener('keydown', (event) => {
      const items = [...menu.querySelectorAll('button')];
      const index = items.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        button.focus();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        items[Math.min(items.length - 1, index + 1)]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        items[Math.max(0, index - 1)]?.focus();
      }
    });
    document.addEventListener('click', (event) => {
      if (!button.parentElement.contains(event.target)) close();
    });
    return menu;
  }

  optionList(rows, current) {
    return [{ value: 'all', label: 'All', selected: current === 'all' }].concat(
      rows.map((row) => ({ value: row.name, label: row.name, selected: current === row.name })),
    );
  }

  commitFilter() {
    this.shown = 10;
    this.write(false);
    this.paint();
  }

  query(overrides = {}) {
    const sentiment = overrides.sentiment ?? this.state.sentiment;
    const sources = overrides.sources === undefined ? this.state.sources : overrides.sources;
    const region = overrides.region ?? this.state.region;
    const topic = overrides.topic ?? this.state.topic;
    const q = (overrides.q ?? this.state.q).trim().toLowerCase();
    return this.headlines.filter((item) => {
      if (q) {
        const hay = `${item.title || ''} ${item.source || ''} ${item.topic || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (sources && !sources.has(item.source)) return false;
      if (region !== 'all' && item.region !== region) return false;
      if (topic !== 'all' && (item.topic || 'Other') !== topic) return false;
      if (sentiment !== 'all' && Score.sentimentKey(item.sentiment) !== sentiment) return false;
      return true;
    });
  }

  paint() {
    if (!this.rows) return;
    const base = this.query({ sentiment: 'all' });
    const counts = { good: 0, bad: 0, neutral: 0 };
    base.forEach((item) => { counts[Score.sentimentKey(item.sentiment)] += 1; });
    const matched = Score.sortHeadlines(
      this.state.sentiment === 'all' ? base : base.filter((item) => Score.sentimentKey(item.sentiment) === this.state.sentiment),
      this.state.sort,
    );
    this.chips.replaceChildren(
      this.chip('all', 'All', base.length),
      this.chip('good', 'Good', counts.good),
      this.chip('bad', 'Bad', counts.bad),
      this.chip('neutral', 'Neutral', counts.neutral),
    );
    this.setButton(this.sourceBtn, this.sourceLabel(), Boolean(this.state.sources));
    this.setButton(this.regionBtn, this.state.region === 'all' ? 'Region: All' : `Region: ${this.state.region}`, this.state.region !== 'all');
    this.setButton(this.topicBtn, this.state.topic === 'all' ? 'Topic: All' : `Topic: ${this.state.topic}`, this.state.topic !== 'all');
    this.setButton(this.sortBtn, this.state.sort === 'oldest' ? 'Oldest first' : 'Newest first', this.state.sort !== 'newest');
    const active = this.activeCount();
    this.filterBtn.replaceChildren(Dom.el('span', { text: active ? `Filters · ${active}` : 'Filters' }));
    this.filterBtn.classList.toggle('is-set', active > 0);
    const sortLabel = this.state.sort === 'oldest' ? 'oldest first' : 'newest first';
    this.results.textContent = `Showing ${Score.formatCount(matched.length)} of ${Score.formatCount(this.headlines.length)} · ${sortLabel} · last 24 h`;

    const visible = matched.slice(0, this.shown);
    if (!matched.length) {
      const filtered = Boolean(this.state.q || this.state.sentiment !== 'all' || this.state.sources || this.state.region !== 'all' || this.state.topic !== 'all');
      this.rows.replaceChildren(Dom.el('div', { class: 'empty-inline' }, [
        Dom.el('h2', { text: filtered ? 'Nothing matched' : 'No headlines in the last 24 hours' }),
        Dom.el('p', { class: 'muted', text: filtered ? 'Nothing in the last 24 hours matches these filters.' : 'The feeds were quiet, so there is nothing to read.' }),
        filtered ? Dom.el('button', { class: 'btn btn-dark', type: 'button', text: 'Clear filters', onClick: () => this.clearFilters() }) : null,
      ]));
      this.loadRow.replaceChildren();
      return;
    }
    this.rows.replaceChildren(...visible.map((item) => this.row(item)));
    const more = matched.length - visible.length;
    const footer = [
      Dom.el('span', { class: 'small muted', text: `Showing ${Score.formatCount(visible.length)} of ${Score.formatCount(matched.length)}` }),
    ];
    if (more > 0) {
      footer.unshift(Dom.el('button', {
        class: 'btn btn-ghost',
        type: 'button',
        text: `Load ${Math.min(50, more)} more`,
        onClick: () => {
          this.shown += 50;
          this.paint();
        },
      }));
    }
    this.loadRow.replaceChildren(...footer);
  }

  chip(key, label, count) {
    const pressed = this.state.sentiment === key;
    return Dom.el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': pressed ? 'true' : 'false',
      'data-sentiment': key,
      onClick: () => {
        this.state.sentiment = key;
        this.commitFilter();
      },
    }, [`${label} ${Score.formatCount(count)}`]);
  }

  setButton(button, label, active) {
    button.querySelector('.menu-label').textContent = label;
    button.classList.toggle('is-set', active);
  }

  sourceLabel() {
    const total = this.sources.length;
    if (!this.state.sources) return `Sources: All ${total}`;
    if (this.state.sources.size === 1) return `Sources: ${[...this.state.sources][0]}`;
    return `Sources: ${this.state.sources.size}`;
  }

  activeCount() {
    let count = 0;
    if (this.state.sources) count += 1;
    if (this.state.region !== 'all') count += 1;
    if (this.state.topic !== 'all') count += 1;
    if (this.state.sort !== 'newest') count += 1;
    return count;
  }

  row(item) {
    const side = Score.sentimentKey(item.sentiment);
    const meta = [item.source, item.region, item.topic].filter(Boolean).join(' · ');
    const formatted = Score.formatScore(item.score);
    const when = [
      Dom.el('time', { datetime: item.published || '', text: Score.clock(item.published) }),
    ];
    if (formatted) {
      when.push(Dom.el('span', {
        class: 'hline-score',
        'aria-label': `score ${formatted}`,
        title: 'Title and summary, scored from \u22121 (very bad) to +1 (very good). Scores are capped at \u00b11 \u2014 about 7% of rows sit at \u00b11.00. See How the score works at the bottom of this page.',
      }, [
        Dom.el('span', { class: 'hline-score-label', text: 'score ' }),
        formatted,
      ]));
    }
    return Dom.el('a', {
      class: 'hline',
      href: item.url || '#',
      target: '_blank',
      rel: 'noopener noreferrer',
    }, [
      Dom.el('span', { class: `pill pill-${side}`, text: Score.sentimentLabel(item.sentiment) }),
      Dom.el('span', {}, [
        Dom.el('span', { class: 'hline-title', text: item.title }),
        Dom.el('span', { class: 'hline-meta', text: meta }),
      ]),
      Dom.el('span', { class: 'hline-when' }, when),
    ]);
  }

  glance(totals, total) {
    return Dom.el('aside', { class: 'glance', 'aria-label': 'Today at a glance' }, [
      Dom.el('p', { class: 'caps', text: 'Today at a glance' }),
      this.glanceCard('good', 'Good news', totals.positive, total),
      this.glanceCard('bad', 'Bad news', totals.negative, total),
      this.glanceCard('neutral', 'Neutral', totals.neutral, total),
      Dom.el('div', { class: 'score-note' }, [
        Dom.el('h2', { class: 'h3', text: 'How we score' }),
        Dom.el('p', { text: 'Each headline\u2019s title and summary is scored from \u22121 (very bad) to +1 (very good). Good news is 0.05 or above, bad news is \u22120.05 or below, and scores are capped at \u00b11. We don\u2019t read the full article, so it still makes mistakes \u2014 nobody edits the results.' }),
        Dom.el('p', {}, [
          Dom.el('a', {
            href: 'https://github.com/psychevibes/GoodNewsBadNews/issues/new?title=Misread%20headline&body=Paste%20the%20headline%20and%20what%20the%20score%20got%20wrong.',
            text: 'Report a misread →',
          }),
        ]),
      ]),
    ]);
  }

  glanceCard(kind, label, count, total) {
    return Dom.el('div', { class: `glance-card glance-${kind}` }, [
      Dom.el('p', { class: 'caps', text: label }),
      Dom.el('strong', { class: 'num', text: Score.formatPercent(count, total) }),
      Dom.el('p', { class: 'small', text: `${Score.formatCount(count)} headlines` }),
    ]);
  }

  fillWinner(latest, totals, total, outlets) {
    const winner = document.getElementById('winner');
    const result = Score.winner(totals.positive, totals.negative, totals.neutral);
    winner.hidden = !total;
    winner.replaceChildren(
      Dom.el('span', { class: 'winner-kicker caps', text: 'Today' }),
      Dom.el('span', { class: 'winner-long', text: `${result.long} · ${Score.formatCount(total)} headlines · ${Score.formatCount(outlets)} outlets` }),
      Dom.el('span', { class: 'winner-short', text: result.short }),
    );
    void latest;
  }

  fillMeta(latest, outlets) {
    document.querySelectorAll('[data-feed-count]').forEach((node) => {
      node.textContent = Score.formatCount(outlets);
    });
    document.querySelectorAll('[data-generated]').forEach((node) => {
      node.textContent = Score.stamp(latest.generated_at);
      node.dateTime = latest.generated_at;
    });
  }

  clearFilters() {
    this.state = { q: '', sentiment: 'all', sources: null, region: 'all', topic: 'all', sort: 'newest' };
    this.shown = 10;
    if (this.search) this.search.value = '';
    this.write(false);
    this.paint();
  }

  openSources(anchor) {
    const draft = { sources: this.state.sources ? new Set(this.state.sources) : null };
    const overlay = new Overlay(() => {});
    overlay.panel.setAttribute('aria-label', 'Sources');
    const title = Dom.el('h2', { id: 'source-title', text: 'Sources' });
    overlay.panel.setAttribute('aria-labelledby', 'source-title');
    const count = Dom.el('p', { class: 'muted small' });
    const filter = Dom.el('input', { type: 'search', placeholder: 'Find an outlet', 'aria-label': 'Find an outlet' });
    const list = Dom.el('div', { class: 'source-list', role: 'group', 'aria-label': 'Outlets' });
    const show = Dom.el('button', { class: 'btn btn-dark', type: 'button', text: 'Show headlines' });
    const render = () => {
      const selected = draft.sources ? draft.sources.size : this.sources.length;
      count.textContent = `${Score.formatCount(selected)} of ${Score.formatCount(this.sources.length)} selected`;
      const needle = filter.value.trim().toLowerCase();
      const visible = this.sources.filter((source) => source.name.toLowerCase().includes(needle));
      list.replaceChildren(...visible.map((source) => {
        const checked = !draft.sources || draft.sources.has(source.name);
        const input = Dom.el('input', { type: 'checkbox' });
        input.checked = checked;
        input.addEventListener('change', () => {
          if (!draft.sources) draft.sources = new Set(this.sources.map((item) => item.name));
          if (input.checked) draft.sources.add(source.name);
          else draft.sources.delete(source.name);
          if (draft.sources.size === this.sources.length) draft.sources = null;
          const matched = this.query({ sources: draft.sources }).length;
          show.textContent = `Show ${Score.formatCount(matched)} headlines`;
          count.textContent = `${Score.formatCount(draft.sources ? draft.sources.size : this.sources.length)} of ${Score.formatCount(this.sources.length)} selected`;
        });
        return Dom.el('label', {}, [
          input,
          Dom.el('span', { text: source.name }),
          Dom.el('span', { class: 'count', text: Score.formatCount(source.count) }),
        ]);
      }));
      show.textContent = `Show ${Score.formatCount(this.query({ sources: draft.sources }).length)} headlines`;
    };
    filter.addEventListener('input', render);
    filter.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        list.querySelector('input')?.focus();
      }
    });
    list.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const boxes = [...list.querySelectorAll('input')];
      const index = boxes.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
      if (boxes[next]) {
        event.preventDefault();
        boxes[next].focus();
      }
    });
    show.addEventListener('click', () => {
      this.state.sources = draft.sources;
      this.commitFilter();
      overlay.close();
    });
    overlay.panel.append(
      Dom.el('header', {}, [title, count]),
      Dom.el('div', { class: 'picker-search' }, [filter]),
      Dom.el('div', { class: 'picker-actions' }, [
        Dom.el('button', { type: 'button', text: 'Select all', onClick: () => { draft.sources = null; render(); } }),
        Dom.el('button', { type: 'button', text: 'Clear', onClick: () => { draft.sources = new Set(); render(); } }),
      ]),
      list,
      Dom.el('div', { class: 'popover-footer' }, [
        Dom.el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onClick: () => overlay.cancel() }),
        show,
      ]),
    );
    render();
    overlay.open(anchor);
  }

  openFilters() {
    const draft = {
      sources: this.state.sources ? new Set(this.state.sources) : null,
      region: this.state.region,
      topic: this.state.topic,
      sort: this.state.sort,
    };
    const overlay = new Overlay(() => {});
    overlay.panel.setAttribute('aria-label', 'Filters');
    const show = Dom.el('button', { class: 'btn btn-dark', type: 'button' });
    const refresh = () => {
      show.textContent = `Show ${Score.formatCount(this.query(draft).length)} headlines`;
    };
    const choices = (rows, current, assign, withAll = true) => {
      const options = withAll ? [{ name: 'all', label: 'All' }].concat(rows.map((row) => ({
        name: row.name,
        label: row.label || row.name,
      }))) : rows.map((row) => ({ name: row.name, label: row.label || row.name }));
      const wrap = Dom.el('div', { class: 'field-options' });
      const paint = () => {
        wrap.replaceChildren(...options.map((row) => Dom.el('button', {
          class: 'choice',
          type: 'button',
          'aria-pressed': current() === row.name ? 'true' : 'false',
          text: row.label,
          onClick: () => {
            assign(row.name);
            paint();
            refresh();
          },
        })));
      };
      paint();
      return wrap;
    };
    const list = Dom.el('div', { class: 'source-list' });
    const paintSources = () => {
      list.replaceChildren(...this.sources.map((source) => {
        const input = Dom.el('input', { type: 'checkbox' });
        input.checked = !draft.sources || draft.sources.has(source.name);
        input.addEventListener('change', () => {
          if (!draft.sources) draft.sources = new Set(this.sources.map((item) => item.name));
          if (input.checked) draft.sources.add(source.name);
          else draft.sources.delete(source.name);
          if (draft.sources.size === this.sources.length) draft.sources = null;
          refresh();
        });
        return Dom.el('label', {}, [
          input,
          Dom.el('span', { text: source.name }),
          Dom.el('span', { class: 'count', text: Score.formatCount(source.count) }),
        ]);
      }));
    };
    paintSources();
    show.addEventListener('click', () => {
      this.state.sources = draft.sources;
      this.state.region = draft.region;
      this.state.topic = draft.topic;
      this.state.sort = draft.sort;
      this.commitFilter();
      overlay.close();
    });
    overlay.panel.append(
      Dom.el('h2', { text: 'Filters' }),
      Dom.el('div', { class: 'field' }, [
        Dom.el('p', { class: 'caps', text: 'Sources' }),
        Dom.el('div', { class: 'picker-actions' }, [
          Dom.el('button', { type: 'button', text: 'Select all', onClick: () => { draft.sources = null; paintSources(); refresh(); } }),
          Dom.el('button', { type: 'button', text: 'Clear', onClick: () => { draft.sources = new Set(); paintSources(); refresh(); } }),
        ]),
        list,
      ]),
      Dom.el('div', { class: 'field' }, [
        Dom.el('p', { class: 'caps', text: 'Region' }),
        choices(this.regions, () => draft.region, (value) => { draft.region = value; }),
      ]),
      Dom.el('div', { class: 'field' }, [
        Dom.el('p', { class: 'caps', text: 'Topic' }),
        choices(this.topics, () => draft.topic, (value) => { draft.topic = value; }),
      ]),
      Dom.el('div', { class: 'field' }, [
        Dom.el('p', { class: 'caps', text: 'Sort' }),
        choices(
          [{ name: 'newest', label: 'Newest first' }, { name: 'oldest', label: 'Oldest first' }],
          () => draft.sort,
          (value) => { draft.sort = value; },
          false,
        ),
      ]),
      Dom.el('div', { class: 'sheet-footer' }, [
        Dom.el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onClick: () => overlay.cancel() }),
        show,
      ]),
    );
    refresh();
    overlay.open(this.filterBtn);
  }
}

const page = new HeadlinesPage();
if (document.body.dataset.page === 'headlines') page.start();
