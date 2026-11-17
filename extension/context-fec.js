/* Subtext: Federal Election Commission records for an organization or committee (basis 'records').
   Shows what a committee the FEC links to the subject reported raising, by two-year cycle.
   It never looks up individual donors by name. Sums of gifts by employer are not built here; see the lead's notes for why.
   Contract: docs/CONTEXT-CONTRACT.md */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./context-data.js'));
  else factory(root.SubtextContextData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (X) {
  'use strict';
  const U = X.util;
  const API = 'https://api.open.fec.gov/v1';
  const MIN_CYCLES = 4; // eight years of filings, close to the six-year rule for yearly filings

  // Reader-facing messages. None of them contains a URL or the key.
  const MSG = {
    nokey: 'A free api.data.gov key in Settings unlocks FEC records.',
    limit: 'The FEC\'s rate limit for your key was reached; try again in an hour.',
    badkey: 'The FEC did not accept the key in Settings.',
    failed: 'The FEC did not answer.'
  };

  /* Page signal: the page is about political money. Pure; exported for tests. */
  // Strong words name political money or elections. 'PAC' is case-sensitive so that 'Pac-12' does not count.
  // Weak words (donation, donor) also fill charity pages, so they count only beside a strong word.
  const STRONG = /\b(political action committees?|campaign financ\w*|(political|campaign) (donations?|contributions?|donors?)|lobbying|lobbyists?|elections?|electoral)\b/gi;
  const STRONG_UPPER = /\b(PACs?|FEC)\b(?!-\d)/g;
  const WEAK = /\b(donations?|donors?|contributions?|fundrais\w*)\b/gi;
  const strong = (s) => (s.match(STRONG) || []).length + (s.match(STRONG_UPPER) || []).length;
  function pageSignal(f) {
    const title = String((f && f.title) || ''), text = String((f && f.text) || '');
    if (strong(title) > 0) return true;
    const st = strong(text);
    return st > 0 && st + (text.match(WEAK) || []).length >= 3;
  }

  // Wikidata classes, labels checked 17 Nov 2026: political action committee, super PAC, political party.
  // The router must pass these as entity.instanceOf; the contract's Entity has no such field yet.
  const POLITICAL_Q = new Set(['Q2101438', 'Q124708886', 'Q7278']);
  function politicalEntity(e) {
    if (!e) return false;
    if (['committee', 'political_committee', 'party'].includes(e.kind)) return true;
    const types = [].concat(e.instanceOf || e.types || []);
    return types.some((q) => POLITICAL_Q.has(q));
  }

  /* Name normalizing: uppercase, & as AND, no punctuation, no leading THE, no company suffixes. */
  const SUFFIX = /\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LLC|LP|LTD|PLC)\b/g;
  function norm(s) {
    return String(s || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]+/g, ' ')
      .replace(/^\s*THE\s+/, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
  }
  function usableName(e) {
    const n = norm(e && e.label);
    return n.replace(/[^A-Z]/g, '').length >= 3 ? n : '';
  }

  // Committee types that a company, union or nonprofit can have (its separate segregated fund).
  // V and W are left out: they keep a non-contribution account that can hold the organization's own money.
  const SSF_TYPES = new Set(['Q', 'N']);
  const ORG_TYPES = new Set(['C', 'L', 'M', 'T', 'V', 'W']);
  // H, S and P (a candidate's own committee) are left out: they would attach money to a person, which this source never does.
  const POLITICAL_TYPES = new Set(['Q', 'N', 'O', 'V', 'W', 'X', 'Y', 'Z']);

  /* Which committee, if any, the FEC's own record ties to this entity.
     An organization: the FEC lists the committee's connected organization as exactly this name, and the type fits.
     A political entity: the committee's own registered name is exactly this name, and the type fits.
     Returns { committee, rule } or null. Exported for tests. */
  function matchCommittee(entity, results, now) {
    const name = usableName(entity);
    if (!name) return null;
    const political = politicalEntity(entity);
    const ok = (results || []).filter((c) => {
      if (!c || !/^C\d{8}$/.test(String(c.committee_id || ''))) return false;
      if (political) return POLITICAL_TYPES.has(c.committee_type) && norm(c.name) === name;
      return SSF_TYPES.has(c.committee_type) && ORG_TYPES.has(c.organization_type) && norm(c.affiliated_committee_name) === name;
    });
    let pick = ok;
    if (pick.length > 1) { // a terminated committee with the same connected organization is not a rival; keep the ones filing now
      const cur = currentCycle(now);
      pick = ok.filter((c) => (c.cycles || []).some((y) => y >= cur - 2));
    }
    if (pick.length !== 1) return null; // none, or more than one filing now: the record does not say which one is meant
    return { committee: pick[0], rule: political ? 'name' : 'connected' };
  }

  /* The cycle that holds today. A cycle is named for its even year. */
  function currentCycle(now) {
    // year-end reports for a cycle arrive at the end of January: until February the cycle just ended is still open
    const d = now || new Date(); const y = d.getUTCFullYear();
    if (y % 2 === 1 && d.getUTCMonth() === 0) return y - 1;
    return y % 2 === 0 ? y : y + 1;
  }

  /* Receipts by cycle. A cycle with no filing between the first and last stays null. The current cycle is left out. */
  function cyclePoints(rows, now) {
    const cur = currentCycle(now);
    const by = new Map();
    for (const r of rows || []) {
      const c = Number(r && r.cycle);
      if (Number.isInteger(c) && c % 2 === 0 && c < cur) by.set(c, U.num(r.receipts));
    }
    const cycles = [...by.keys()].sort((a, b) => a - b);
    if (!cycles.length) return [];
    const points = [];
    for (let c = cycles[0]; c <= cycles[cycles.length - 1]; c += 2) points.push({ t: String(c), v: by.has(c) ? by.get(c) : null });
    return points;
  }

  async function call(io, path, key) {
    const r = await io.get(API + path + (path.includes('?') ? '&' : '?') + 'api_key=' + U.enc(key), { accept: 'application/json' });
    if (r.status === 429) return { error: MSG.limit };
    if (r.status === 403) return { error: MSG.badkey };
    if (r.status !== 200) return { error: MSG.failed };
    const body = U.json(r.text);
    return body && Array.isArray(body.results) ? { results: body.results } : { error: MSG.failed };
  }
  const fail = (error) => ({ chart: null, facts: [], error });

  const src = {
    id: 'fec_committee',
    basis: 'records',
    scope: 'entity',
    label: 'Committee filings with the FEC',
    question: 'What did a committee linked to this organization report raising?',
    // US filers only: the FEC holds no committee of a British or Canadian party, and a same-named US committee is another body
    applies: (entity, f) => !!usableName(entity) && (entity.country === 'US' || (!entity.country && !politicalEntity(entity))) && (entity.kind === 'organization' || politicalEntity(entity)) && (pageSignal(f) || politicalEntity(entity)),
    sends: (entity) => 'the organization name \'' + String(entity.label) + '\' to the FEC (nothing is sent without your key)',
    async run(entity, f, io, now, o) {
      const key = o && o.keys && o.keys.fec;
      if (!key) return fail(MSG.nokey);
      try {
        const s = await call(io, '/committees/?q=' + U.enc(String(entity.label)) + '&per_page=50', key);
        if (s.error) return fail(s.error);
        const m = matchCommittee(entity, s.results, now);
        if (!m) return null;
        const c = m.committee;
        const t = await call(io, '/committee/' + c.committee_id + '/totals/?per_page=40&sort=-cycle', key);
        if (t.error) return fail(t.error);
        const points = cyclePoints(t.results, now);
        if (points.filter((p) => p.v > 0).length < MIN_CYCLES) return null;
        const known = points.filter((p) => p.v != null);
        const last = known[known.length - 1], first = known[0];
        const cur = (t.results || []).find((r) => Number(r.cycle) === currentCycle(now));
        const curV = cur ? U.num(cur.receipts) : null;
        const through = cur && cur.coverage_end_date ? U.fmtT(String(cur.coverage_end_date).slice(0, 10)) : '';
        const why = m.rule === 'connected'
          ? 'The FEC lists its connected organization as "' + c.affiliated_committee_name + '".'
          : 'Its registered name matches "' + entity.label + '".';
        const sentence = c.name + ' (FEC ID ' + c.committee_id + ') reported ' + U.money(last.v) + ' in receipts in the ' + last.t + ' cycle, against ' + U.money(first.v) + ' in ' + first.t + '. ' + why +
          (curV != null && through ? ' In the ' + currentCycle(now) + ' cycle, still open, it reported ' + U.money(curV) + ' through ' + through + '.' : '');
        return { chart: {
          id: 'fec_committee', basis: 'records', question: src.question,
          title: 'Receipts by election cycle: ' + c.name,
          sentence, kind: 'bars', resolution: 'cycle', points, unit: 'US dollars', nominal: true,
          note: m.rule === 'connected' ? 'A company or union PAC is funded by voluntary gifts from employees or members, not from the organization\'s own treasury.' : 'Receipts include transfers between committees, so they are not all new gifts.',
          source: { name: 'Federal Election Commission', url: 'https://www.fec.gov/data/committee/' + c.committee_id + '/' }
        }, facts: [] };
      } catch (e) {
        return fail(MSG.failed); // never pass on an exception text: it could carry the request URL
      }
    }
  };
  X.register(src);
  X.fec = { pageSignal, politicalEntity, matchCommittee, cyclePoints, currentCycle, norm, MSG };
  return X;
});
