/* Subtext context source: incidents a software vendor reported on its own status page.
   Runs on a page about the service itself (pricing, product, front page) and only when that page links to its status page
   (`f.statusPages`, origins read from links in the page's own footer, header or navigation). A host is never guessed, and only a
   host under the site's own domain is ever asked (see "Identity" below). Contract: docs/CONTEXT-CONTRACT.md.

   Feed: `<origin>/api/v2/incidents.json`, the public incident feed of Atlassian Statuspage. One request, a fixed path, nothing
   about the page in it. Response shape (probed 17 Nov 2026 on 55 status hosts of 51 services):
     { page: { id, name, url, time_zone, updated_at },
       incidents: [{ id, name, status, impact ('none' | 'minor' | 'major' | 'critical' | 'maintenance'), created_at, updated_at,
                     resolved_at (null while open), started_at, shortlink, scheduled_for (maintenance only), incident_updates, components }] }
   Statuspage returns its latest 50 entries. Status pages hosted by incident.io answer the same path with the same field names
   (25 entries, no `shortlink`, `started_at` or `time_zone`), so they are read by the same code; that is the only second format.
   `?page=`, `?limit=` and `?per_page=` are ignored by both, so there is no second request to make.
   Not accepted: an answer with top-level `status` or `components` (the page summary, which arrived from two hosts that
   redirect and drop the path; it held 10 entries, and on the one host compared they were the first 10 of the feed. One host
   is thin evidence for what that window is, so it is not read), HTML, an error object, any other product's JSON.

   The feed is a window, not a history. What the probes showed, and the rules that follow:
   - Entries are ordered by when they were resolved (an open entry by its last update), not by when they were created: 34 of
     37 saved feeds were exactly in that order, the other three had one to three entries out of place, and only 8 were in
     creation order. An incident that is missing from the feed can therefore have been created as late as the earliest
     resolution time in it. The code takes the earliest time over all entries, not the last entry. Months are counted from the month after the
     later of (a) the oldest creation date and (b) the earliest resolution date among the returned entries, through the last
     finished month. The month in progress is dropped. Inside that range a month with no incident is a true 0.
   - An entry resolved more than a day before it was created is an older incident added later (two probed hosts had imported
     their history this way: every imported entry carried the day of the import). Such an entry is never counted, and nothing
     created up to that day is counted either: the feed does not say which older incidents it leaves out.
   - Counted: entries the vendor labelled minor, major or critical. Not counted: impact "none", scheduled maintenance, any other
     label. A vendor that labels every entry "none" (one probed host did, 50 of 50) gets no chart and no list.
   - Months and dates are UTC, the clock the rest of the context code uses for "the month in progress".

   Minimum to show something (probe numbers in the comments at MIN_*):
   - bars by month: at least MIN_MONTHS covered months AND at least MIN_INCIDENTS counted incidents inside them. At most
     MAX_MONTHS recent months are drawn.
   - otherwise a dated list (kind 'list'): at least MIN_LIST counted incidents on the days the feed fully covers (the days after
     the day of that same boundary). The sentence gives the count between the first and last of those dates and claims
     nothing about months.
   - otherwise null. Also null when the newest entry of any kind is more than STALE_DAYS old: the feed cannot tell a quiet
     service from a status page that is no longer updated.

   Identity: the status host must sit under the site's own domain (`X.ownStatusHost`: a host under the registrable domain the
   worker worked out, `f.registrable`, and never the site's own host; a page on a subdomain is given only hosts under that
   subdomain, because many platforms give each tenant a subdomain). No other host is requested, whatever the page links to and
   whatever a host calls itself: a link anyone can post must not choose where a request goes, and the name inside a feed is that
   host's own claim. A status page on a vendor's domain (example.statuspage.io, examplestatus.com) therefore gives no chart.
   The request does not follow redirects (`redirect: 'error'`): a status host that redirects gives no chart. Links in the result
   are built from the origin the page linked to and the entry's id; no address and no name is taken from the feed. The name shown
   is the site's. The router says what the chart is about (on an inner page: the site, not this page).
   Everything in the feed is written by the vendor. The title, sentence and note say so. Incident names are shown as text only,
   and every string is cut to MAX_RAW characters before any pattern runs on it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./context-data.js'));
  else factory(root.SubtextContextData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (X) {
  'use strict';
  const U = X.util;
  const PATH = '/api/v2/incidents.json';
  const GROUPS = new Set(['other', 'organization', 'shop']); // pages that are about the site itself
  // Of 36 hosts whose feed parsed on 17 Nov 2026: 21 covered 6 or more months (6 to 89), 5 covered exactly 5, 10 covered 0 to 3.
  // Six bars is the same floor the yearly filings use. Five would move those five hosts from a list to a five-bar chart that says
  // little more than the list's sentence does.
  const MIN_MONTHS = 6;
  const MIN_INCIDENTS = 5; // counted incidents inside the drawn months; fewer is a list, not a rate
  const MIN_LIST = 3;
  const MAX_MONTHS = 24; // one host covered 84 months with 74 zeros and nothing after June 2025: old months say little about the service today
  const STALE_DAYS = 365; // two probed hosts had no entry of any kind after June 2025 and March 2025 while their sites were live
  // Two probed hosts had moved their history to a new status page: 21 and 24 of their 25 entries carried the day of the move as the
  // creation date and resolution dates up to eight years earlier. Back-dated entries on other hosts were at most 16.5 hours apart.
  const LATE_HOURS = 24;
  const MAX_ROWS = 6;
  const MAX_NAME = 90; // longest incident name seen in the probes: 168 characters
  const MAX_RAW = 400; // a string is cut to this before any pattern runs on it: the tag pattern is quadratic on a long run of "<"
  const LEVELS = ['critical', 'major', 'minor'];
  const MAINTENANCE = new Set(['scheduled', 'in_progress', 'verifying', 'completed']);

  // ---------- which host may be asked ----------
  // the same test the worker applies to the page's own host: a private, intranet or numeric address is never requested
  const publicHost = (h) => !!h && h.includes('.') && !h.endsWith('.') && !h.includes(':') && !h.startsWith('[') && !/(^|\.)\d+$/.test(h) && !/^0x/i.test(h) && !/\.(local|localhost|internal|test|invalid|lan|home|corp|intranet)$/.test(h);
  const originOf = (s) => {
    let u; try { u = new URL(String(s)); } catch (e) { return ''; }
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return '';
    const h = u.hostname.toLowerCase();
    return publicHost(h) ? 'https://' + h : '';
  };
  const hostOf = (origin) => origin.slice(8);
  // only hosts under the site's own domain, checked here again whatever the facts hold; at most two
  const origins = (f) => [...new Set((Array.isArray(f && f.statusPages) ? f.statusPages : []).map(originOf).filter((o) => o && X.ownStatusHost(hostOf(o), f.domain, f.registrable)))].slice(0, 2);

  // ---------- reading the feed ----------
  const ms = (s) => { const t = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : null; };
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const month = (t) => new Date(t).toISOString().slice(0, 7);
  const nextMonth = (m) => { const y = Number(m.slice(0, 4)), n = Number(m.slice(5)); return n === 12 ? (y + 1) + '-01' : y + '-' + String(n + 1).padStart(2, '0'); };
  // vendor-written text: cut to MAX_RAW first, then tags and angle brackets removed, whitespace collapsed, length capped. The card escapes it again.
  const plain = (s) => { const t = (typeof s === 'string' ? s : s == null ? '' : String(s)).slice(0, MAX_RAW).replace(/<[^>]*>/g, ' ').replace(/[<>\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > MAX_NAME ? t.slice(0, MAX_NAME - 1).trimEnd() + '\u2026' : t; };
  /* -> { entries: [{ created, bound, impact, counted, name, id }] } or null when the answer is not this feed.
     `bound` is the latest moment the entry's place in the vendor's ordering can stand for: when it was resolved, or its last
     update while it is still open. */
  function readFeed(text, now) {
    const d = U.json(text);
    if (!d || typeof d !== 'object' || Array.isArray(d) || !d.page || typeof d.page !== 'object' || !Array.isArray(d.incidents)) return null;
    if ('components' in d || 'status' in d) return null; // the page summary, not the incident feed
    const entries = [];
    for (const x of d.incidents.slice(0, 200)) {
      if (!x || typeof x !== 'object' || typeof x.impact !== 'string') return null;
      const created = ms(x.created_at); if (created == null) return null; // an entry with no date: the window cannot be worked out
      if (created > now.getTime()) continue; // dated in the future
      const impact = x.impact.toLowerCase();
      const maintenance = impact === 'maintenance' || x.scheduled_for != null || MAINTENANCE.has(String(x.status || '').toLowerCase());
      const resolved = ms(x.resolved_at), updated = ms(x.updated_at);
      // resolved more than a day before it was created: an older incident added later (an imported history, a late entry). Its creation date is not its date
      const late = resolved != null && resolved < created - LATE_HOURS * 3600e3;
      entries.push({ created, late, bound: resolved != null ? resolved : updated != null ? updated : created, impact, counted: !late && !maintenance && LEVELS.includes(impact),
        name: plain(x.name), id: typeof x.id === 'string' && /^[A-Za-z0-9]{4,40}$/.test(x.id) ? x.id : '' });
    }
    // the feed's own page name. Only hosts under the site's own domain are ever asked, so this is the site naming itself ("Help Scout", sometimes "Help Scout Status")
    const pageName = typeof d.page.name === 'string' ? plain(d.page.name).replace(/\s+(system\s+)?status(\s+page)?$/i, '').trim() : '';
    return { entries, pageName: pageName.length >= 2 && pageName.length <= 60 ? pageName : '' };
  }

  // ---------- words ----------
  const list = (xs) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const count = (n) => n + (n === 1 ? ' incident' : ' incidents');
  // ": 4 critical, 10 major and 10 minor, by its own labels." or ", all labelled minor by the vendor." (the labels are the vendor's)
  const byLevel = (xs) => { const parts = LEVELS.map((l) => [xs.filter((x) => x.impact === l).length, l]).filter(([n]) => n); return parts.length === 1 ? ', ' + (xs.length === 1 ? '' : 'all ') + 'labelled ' + parts[0][1] + ' by the vendor.' : ': ' + list(parts.map(([n, l]) => n + ' ' + l)) + ', by its own labels.'; };

  function build(origin, name, feed, now) {
    const all = feed.entries; if (!all.length) return null;
    // nothing of any kind for a year: a quiet service and a status page that is no longer updated look the same from here
    if (Math.max(...all.map((x) => x.created)) < now.getTime() - STALE_DAYS * 864e5) return null;
    const counted = all.filter((x) => x.counted).sort((a, b) => b.created - a.created);
    const noImpact = all.filter((x) => x.impact === 'none').length;

    // months the feed fully covers (see the top of the file), then at most the last MAX_MONTHS of them
    const oldest = Math.min(...all.map((x) => x.created)), bound = Math.min(...all.map((x) => x.bound));
    const added = Math.max(0, ...all.filter((x) => x.late).map((x) => x.created)); // the last time older incidents were added to the page
    const cut = Math.max(oldest, bound, added); // the feed holds every incident created after this moment
    const cur = month(now.getTime());
    let months = [];
    for (let m = nextMonth(month(cut)); m < cur && months.length < 600; m = nextMonth(m)) months.push(m);
    const capped = months.length > MAX_MONTHS; if (capped) months = months.slice(-MAX_MONTHS);
    const per = new Map(months.map((m) => [m, 0]));
    const inside = counted.filter((x) => per.has(month(x.created)));
    for (const x of inside) per.set(month(x.created), per.get(month(x.created)) + 1);

    const host = hostOf(origin);
    const row = (x) => ({ t: day(x.created), text: (x.name || 'Untitled incident') + ' (' + x.impact + ')', url: x.id ? origin + '/incidents/' + x.id : origin + '/history' });
    const limits = 'This is ' + name + '\'s own account, not an independent record. Entries it labelled as no impact' + (noImpact ? ' (' + noImpact + ')' : '') + ' and scheduled maintenance are not counted. ';
    const base = {
      id: 'status_incidents', basis: 'records', question: 'How often does this service report incidents?',
      title: 'Incidents ' + name + ' reported on its own status page',
      unit: 'incidents', rowsLabel: 'Most recent incidents listed, with ' + name + '\'s own impact label',
      source: { name: name + ' status page (' + host + ')', url: origin + '/history' }
    };

    if (months.length >= MIN_MONTHS && inside.length >= MIN_INCIDENTS) {
      const points = months.map((m) => ({ t: m, v: per.get(m) }));
      const top = Math.max(...points.map((p) => p.v)); const peaks = points.filter((p) => p.v === top); const zeros = points.filter((p) => p.v === 0).length;
      let sentence = name + '\'s own status page lists ' + count(inside.length) + ' with an impact from ' + U.fmtT(months[0]) + ' to ' + U.fmtT(months[months.length - 1]) + byLevel(inside);
      sentence += ' The most in one month was ' + top + (peaks.length <= 2 ? ', in ' + list(peaks.map((p) => U.fmtT(p.t))) : ', in ' + peaks.length + ' of the months') + '.';
      if (zeros) sentence += ' ' + zeros + ' of the ' + months.length + ' months ' + (zeros === 1 ? 'lists' : 'list') + ' none.';
      // a run of empty months up to today: say where the list stops, so a page that is no longer updated is not read as a quiet service
      if (month(counted[0].created) < months[months.length - 1]) sentence += ' The latest incident with an impact it lists is dated ' + U.fmtT(day(counted[0].created)) + '.';
      return Object.assign(base, { sentence, kind: 'bars', resolution: 'month', points, rows: counted.slice(0, MAX_ROWS).map(row),
        note: limits + (capped ? 'Only the last ' + MAX_MONTHS + ' months are shown. ' : 'The feed returns only the most recent entries (' + all.length + ' here), so earlier months are not shown. ') + 'Dates are in UTC.' });
    }
    // the list: only days the feed fully covers (the days after the day of `cut`), so "from A to B" leaves nothing out
    const recent = counted.filter((x) => day(x.created) > day(cut));
    if (recent.length < MIN_LIST) return null;
    const first = day(recent[recent.length - 1].created), last = day(recent[0].created);
    return Object.assign(base, {
      sentence: name + '\'s own status page lists ' + count(recent.length) + ' with an impact ' + (first === last ? 'on ' + U.fmtT(first) : 'from ' + U.fmtT(first) + ' to ' + U.fmtT(last)) + byLevel(recent),
      kind: 'list', resolution: 'day', points: [], rows: recent.slice(0, MAX_ROWS).map(row),
      note: limits + 'The feed returns only the most recent entries (' + all.length + ' here). Dates are in UTC.' });
  }

  X.register({
    id: 'status_incidents',
    basis: 'records',
    scope: 'page',
    label: 'Incidents on its own status page',
    question: 'How often does this service report incidents?',
    applies: (f) => !!f && GROUPS.has(f.group) && origins(f).length > 0,
    sends: (f) => {
      const o = origins(f); if (!o.length) return 'nothing';
      return 'a request to this site\'s status page (' + hostOf(o[0]) + ')' + (o[1] ? ', then to ' + hostOf(o[1]) + ' if the first has no incident feed' : '');
    },
    async run(f, io, now) {
      if (!f || !GROUPS.has(f.group)) return null;
      now = now || new Date();
      // the site's own name; its domain when it gives none. A page title used as a site name ("Example: all-in-one toolkit for teams") is cut at its first separator
      const short = (s) => { const t = plain(s); return t.length > 40 ? t.split(/\s*[:|\u2013\u2014]\s+|\s+-\s+/)[0].trim() : t; };
      const given = plain(f.siteName) || plain(f.brand); const name = short(given) || plain(f.domain);
      const weak = !given || given.length > 40; // the site gave no name, or a page title in place of one
      if (!name) return null;
      for (const origin of origins(f)) { // at most two requests: one for each status page under the site's own domain that the page links to
        const r = await io.get(origin + PATH, { accept: 'application/json', redirect: 'error' }); // a redirect is not followed
        if (!r || r.status !== 200) continue;
        const feed = readFeed(r.text, now);
        if (!feed) continue;
        const chart = build(origin, weak && feed.pageName ? feed.pageName : name, feed, now); // the site's own name stands; the feed's short name only when the site gave none
        return chart ? { chart, facts: [] } : null;
      }
      return null;
    }
  });
  return X;
});
