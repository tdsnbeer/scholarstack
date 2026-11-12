/* ScholarStack core: pure functions (no DOM), shared by the app and the node tests.
   Dates are 'YYYY-MM-DD' strings in the phone's local time. */
(function (root) {
  'use strict';

  const STATUSES = ['todo', 'started', 'drafted', 'submitted', 'skipped'];
  const STATUS_LABEL = { todo: 'Not started', started: 'Started', drafted: 'Essay drafted',
    submitted: 'Submitted', skipped: 'Skipped' };
  const SKIP_REASONS = ['Essay felt pointless', 'Forgot', 'Not eligible after all', 'Too much work',
    'Deadline passed', 'Needs a document I don\'t have', 'Didn\'t want to share my info', 'Award too small', 'Other'];
  const PROMPTED_BY = ['Nudge', 'Parent said something', 'Own idea', 'School', 'Other'];
  const FRICTIONS = ['Nothing got in the way', 'No matching award', 'Essay', 'Forms or documents',
    'Unsure about eligibility', 'No time', 'Forgot', 'Lost motivation', 'Wrong deadline on list', 'Other'];
  const THEMES = { 'career-goals': 'Your goals / why this career', 'why-engineering': 'Why engineering',
    'leadership': 'Leadership', 'community-service': 'Community service', 'adversity': 'A challenge you overcame',
    'personal-statement': 'Personal statement (about you)', 'other': 'Other prompt' };
  const WINDOW_DAYS = 56, FREEZE_DAY = 14, HARD_STOP = '2027-02-28';

  // ---- dates ---------------------------------------------------------------
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function today() { return iso(new Date()); }

  // ---- list ----------------------------------------------------------------
  /** Deadline order: dated and still ahead first (soonest first), then undated, then past. */
  function sortItems(items, now) {
    const rank = it => !it.deadline ? 1 : (it.deadline < now ? 2 : 0);
    return items.slice().sort((a, b) => rank(a) - rank(b) ||
      (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.name.localeCompare(b.name));
  }
  function deadlineLabel(it, now) {
    if (!it.deadline) return it.opens ? 'Opens ' + it.opens + ' · deadline not published yet' : 'Deadline not published yet';
    const n = daysBetween(now, it.deadline);
    if (n < 0) return 'Deadline passed (' + it.deadline + ')';
    if (n === 0) return 'Due TODAY';
    return 'Due ' + it.deadline + ' · ' + n + (n === 1 ? ' day' : ' days') + ' left';
  }
  function sourceLabel(it) {
    const host = (it.deadline_source || '').replace(/^https?:\/\//, '').split('/')[0];
    const st = { 'verified-current': 'Checked', 'last-year-date': 'Last year\'s date only, seen',
      'not-published': 'Not published yet, checked', 'closed': 'Closed, checked' }[it.deadline_status] || 'Seen';
    return st + ' on ' + (host || 'unknown source') + (it.deadline_checked ? ' (' + it.deadline_checked + ')' : '');
  }

  // ---- progress --------------------------------------------------------------
  function entry(state, id) {
    state.items = state.items || {};
    return state.items[id] || (state.items[id] = { status: 'todo', history: [] });
  }
  /** Mark an application; extra = {date, reason, prompted, essayMin, reused, guessMin, timed}. */
  function mark(state, id, status, extra, now) {
    if (!STATUSES.includes(status)) throw new Error('bad status ' + status);
    extra = extra || {};
    const e = entry(state, id), at = extra.date || now;
    e.status = status;
    e.history.push({ s: status, at: now });
    if (status !== 'todo' && status !== 'skipped' && !e.startedAt) e.startedAt = at;
    if (status === 'drafted') { e.draftedAt = at; }
    if (status === 'submitted') { e.submittedAt = at; if (extra.prompted) e.prompted = extra.prompted; }
    else delete e.submittedAt;
    if (status === 'skipped') { e.skipReason = extra.reason || 'Other'; e.skippedAt = at; }
    else { delete e.skipReason; delete e.skippedAt; }
    if (status === 'todo') { delete e.startedAt; delete e.draftedAt; }
    for (const k of ['essayMin', 'reused', 'guessMin', 'timed']) if (extra[k] !== undefined) e[k] = extra[k];
    return e;
  }
  function statusOf(state, id) { return (state.items && state.items[id] && state.items[id].status) || 'todo'; }
  function intends(state, it) {
    const e = state.items && state.items[it.id];
    if (e && typeof e.intend === 'boolean') return e.intend;
    return (it.fit !== 'check' || !!(e && e.eligible === true)) && it.deadline_status !== 'closed';
  }

  /** What to do this week: the 3 soonest open, unfinished applications the student intends to do. */
  function nextUp(list, state, now) {
    return sortItems(list, now).filter(it => it.deadline && it.deadline >= now &&
      !['submitted', 'skipped'].includes(statusOf(state, it.id)) && intends(state, it)).slice(0, 3);
  }
  function nextStep(status) {
    return { todo: 'Open the application and read what it needs (10 min).', started: 'Draft the essay or fill the form.',
      drafted: 'Finish the form and press Submit.', submitted: 'Done.', skipped: '' }[status];
  }

  // ---- essays ----------------------------------------------------------------
  /** Group applications by essay theme so one essay can be reused. */
  function essayGroups(list) {
    const groups = {}, none = [];
    for (const it of list) {
      if (!it.essay) { none.push(it); continue; }
      const t = THEMES[it.essay.theme] ? it.essay.theme : 'other';
      (groups[t] = groups[t] || []).push(it);
    }
    const out = Object.keys(groups).map(t => ({ theme: t, label: THEMES[t], items: groups[t] }))
      .sort((a, b) => b.items.length - a.items.length);
    return { groups: out, noEssay: none };
  }

  // ---- pilot (Foundry work 88) ----------------------------------------------
  function requiredSubmissions(b) {
    if (b === null || b === undefined || b === 'unknown') return 2;
    if (b === 0) return 2;
    if (b === 1) return 3;
    return 2 * b;
  }
  function minDeadlines(b) { return Math.max(4, requiredSubmissions(b) + 2); }

  /** Eligibility for scoring (work 88, metric (c)): uncertain ("check") awards count only after the student
   *  confirms they qualify; anything marked not eligible never counts. */
  function eligibleForScoring(state, it) {
    const e = state.items && state.items[it.id];
    if (e && (e.eligible === false || e.skipReason === 'Not eligible after all')) return false;
    if (it.fit === 'check') return !!(e && e.eligible === true);
    return true;
  }
  function setEligible(state, id, v) { entry(state, id).eligible = v === true ? true : v === false ? false : undefined; }

  /** Applications that count: confirmed eligible, open in the window, deadline inside it. */
  function countable(list, state, start) {
    const end = addDays(start, WINDOW_DAYS);
    return list.filter(it => it.deadline && it.deadline >= start && it.deadline <= end &&
      it.deadline_status !== 'closed' && (!it.opens || it.opens <= end) && eligibleForScoring(state, it));
  }
  function baselineMissing(b) { return b === null || b === undefined || b === 'unknown'; }

  /** Freeze the list on day 14 of the window (once). Returns true if it froze now. */
  function maybeFreeze(list, state, now) {
    const p = state.pilot;
    if (!p || !p.day0 || p.freeze) return false;
    if (daysBetween(p.day0, now) < FREEZE_DAY) return false;
    p.freeze = { date: addDays(p.day0, FREEZE_DAY), ids: countable(list, state, p.day0).map(it => it.id) };
    return true;
  }

  function median(xs) {
    if (!xs.length) return null;
    const s = xs.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function metrics(list, state, now) {
    const items = state.items || {}, p = state.pilot || {};
    const intended = list.filter(it => intends(state, it));
    const started = list.filter(it => items[it.id] && items[it.id].startedAt);
    const submitted = list.filter(it => items[it.id] && items[it.id].status === 'submitted');
    const skipped = list.filter(it => items[it.id] && items[it.id].status === 'skipped');
    const tally = (arr, key) => arr.reduce((o, it) => { const k = items[it.id][key] || 'Not recorded'; o[k] = (o[k] || 0) + 1; return o; }, {});
    const daysToSubmit = submitted.filter(it => items[it.id].startedAt)
      .map(it => daysBetween(items[it.id].startedAt, items[it.id].submittedAt));
    const fromDay0 = p.day0 ? submitted.map(it => daysBetween(p.day0, items[it.id].submittedAt)).filter(n => n >= 0) : [];
    const weeks = p.weeks || [];
    const essayMin = list.reduce((s, it) => s + ((items[it.id] && items[it.id].essayMin) || 0), 0);
    return {
      intended: intended.length, started: started.length, submitted: submitted.length, skipped: skipped.length,
      skipReasons: tally(skipped, 'skipReason'), promptedBy: tally(submitted, 'prompted'),
      medianDaysStartToSubmit: median(daysToSubmit), medianDaysDay0ToSubmit: median(fromDay0),
      checkins: weeks.length, nudgesOnTime: weeks.filter(w => w.nudgeOnTime === true).length,
      parentMinutes: weeks.reduce((s, w) => s + (w.parentMin || 0), 0), essayMinutes: essayMin,
      frictions: weeks.reduce((o, w) => { if (w.friction) o[w.friction] = (o[w.friction] || 0) + 1; return o; }, {}),
    };
  }

  /** The pre-set pass/fail rule from Foundry work 88. Always labelled one family, not proof. */
  function verdict(list, state, now) {
    const p = state.pilot || {};
    const base = { label: 'One family, not proof.' };
    if (!p.day0) return Object.assign(base, { state: 'not-started', text: 'Pilot not started. Day 0 is the first weekly check-in.' });
    const b = p.baseline, R = requiredSubmissions(b), D = minDeadlines(b);
    const end = addDays(p.day0, WINDOW_DAYS), day = daysBetween(p.day0, now);
    const ids = p.freeze ? p.freeze.ids : countable(list, state, p.day0).map(it => it.id);
    const items = state.items || {};
    const subs = ids.filter(id => items[id] && items[id].status === 'submitted' &&
      items[id].submittedAt >= p.day0 && items[id].submittedAt <= end).length;
    const weeks = (p.weeks || []).filter(w => w.date >= p.day0 && w.date <= end);
    const onTime = weeks.filter(w => w.nudgeOnTime === true).length;
    const out = Object.assign(base, { R, Dmin: D, D: ids.length, submittedCounted: subs, nudgesOnTime: onTime,
      week: Math.min(8, Math.floor(day / 7) + 1), windowEnd: end, frozen: !!p.freeze,
      baselineNote: baselineMissing(b) ? 'No baseline entered: the final verdict will be inconclusive (a result can only be a "directional" note). Enter it in Numbers.' : '' });
    if (p.freeze && ids.length < D) {
      return Object.assign(out, { state: now > HARD_STOP ? 'inconclusive' : 'not-informative',
        text: now > HARD_STOP ? 'Inconclusive: never enough open deadlines by ' + HARD_STOP + '.'
          : 'Not informative yet: ' + ids.length + ' open, eligible deadlines in this window; the rule needs ' + D +
            '. Restart the window when the February awards open (hard stop ' + HARD_STOP + ').' });
    }
    if (now <= end) {
      return Object.assign(out, { state: 'running', text: 'Week ' + out.week + ' of 8. ' + subs + ' submission(s) count so far, rule needs ' + R +
        ' (only awards whose deadline falls inside the 8 weeks count); ' + ids.length + (p.freeze ? '' : ' (provisional, freezes day 14)') +
        ' open deadlines, rule needs ' + D + '.' });
    }
    if (onTime < 7) return Object.assign(out, { state: 'inconclusive', text: 'Inconclusive: only ' + onTime + ' of 8 weekly nudges logged on time (rule needs 7).' });
    if (baselineMissing(b)) return Object.assign(out, { state: 'inconclusive',
      directional: subs >= R ? 'support' : 'refute',
      text: 'Inconclusive: no baseline was recorded. Directional note only: ' + subs + ' submitted (the no-baseline floor is ' + R +
        (subs >= R ? ', met' : ', missed') + ').' });
    if (subs >= R) return Object.assign(out, { state: 'support', text: 'SUPPORT: ' + subs + ' submitted (needed ' + R + ').' });
    return Object.assign(out, { state: 'refute', text: 'REFUTE: ' + subs + ' submitted (needed ' + R + ') with enough deadlines and nudges on time.' });
  }

  function restartWindow(state, now) {
    const p = state.pilot = state.pilot || {};
    (p.pastWindows = p.pastWindows || []).push({ day0: p.day0, freeze: p.freeze || null, endedAt: now });
    p.day0 = now; delete p.freeze;
  }

  // ---- weekly check-in ---------------------------------------------------------
  function checkin(state, rec, now) {
    const p = state.pilot = state.pilot || {};
    if (!p.day0) p.day0 = now;
    p.weeks = p.weeks || [];
    const week = Math.floor(daysBetween(p.day0, now) / 7) + 1;
    const row = Object.assign({ week, date: now }, rec);
    const i = p.weeks.findIndex(w => w.week === week && w.date >= p.day0);
    if (i >= 0) p.weeks[i] = row; else p.weeks.push(row);
    return row;
  }

  // ---- calendar (.ics) -------------------------------------------------------
  function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function fold(line) {  // RFC 5545: lines over 75 octets are folded (approximate by characters)
    const out = []; let s = line;
    while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); }
    out.push(s); return out.join('\r\n');
  }
  function stamp(d) { return d.replace(/-/g, ''); }
  function alarm(trigger, text) { return ['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:' + trigger, 'DESCRIPTION:' + icsEscape(text), 'END:VALARM']; }
  function vevent(uid, lines) { return ['BEGIN:VEVENT', 'UID:' + uid + '@scholarstack', 'DTSTAMP:20261112T000000Z'].concat(lines, ['END:VEVENT']); }

  /** Weekday of the first occurrence on/after `from` (0=Sun..6=Sat). */
  function nextWeekday(from, wd) { const d = parse(from); d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7)); return iso(d); }

  /**
   * Calendar file: every dated deadline (alarms 7 days and 2 days before, at 6pm the evening before is too
   * late for most forms), every known opening date, a Monday "plan your week" and a Friday check-in for 16 weeks.
   */
  function buildICS(list, state, opts, now) {
    opts = Object.assign({ planDay: 1, checkinDay: 5, time: '19:00', weeks: 16, appUrl: '' }, opts || {});
    const t = opts.time.replace(':', '') + '00';
    let L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ScholarStack//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:ScholarStack'];
    for (const it of sortItems(list, now)) {
      const st = statusOf(state, it.id);
      if (st === 'submitted' || st === 'skipped') continue;
      if (it.deadline && it.deadline >= now) {
        L = L.concat(vevent('due-' + it.id, ['DTSTART;VALUE=DATE:' + stamp(it.deadline),
          'DTEND;VALUE=DATE:' + stamp(addDays(it.deadline, 1)), 'SUMMARY:' + icsEscape('DUE: ' + it.name + ' (' + it.amount + ')'),
          'DESCRIPTION:' + icsEscape('Submit before the deadline. ' + (it.link || '')), 'TRANSP:TRANSPARENT'],
        ).slice(0, -1).concat(alarm('-P7D', '1 week left: ' + it.name), alarm('-P2D', '2 days left: ' + it.name),
          alarm('-PT6H', 'Due today: ' + it.name), ['END:VEVENT']));
      }
      if (it.opens && it.opens >= now) {
        L = L.concat(vevent('opens-' + it.id, ['DTSTART;VALUE=DATE:' + stamp(it.opens), 'DTEND;VALUE=DATE:' + stamp(addDays(it.opens, 1)),
          'SUMMARY:' + icsEscape('OPENS: ' + it.name), 'DESCRIPTION:' + icsEscape('Application should be open now. ' + (it.link || '')),
          'TRANSP:TRANSPARENT']).slice(0, -1).concat(alarm('PT9H', 'Open now: ' + it.name), ['END:VEVENT']));
      }
    }
    const weekly = (uid, wd, summary, desc) => {
      const d = nextWeekday(addDays(now, 1), wd);
      return vevent(uid, ['DTSTART:' + stamp(d) + 'T' + t, 'DURATION:PT10M', 'RRULE:FREQ=WEEKLY;COUNT=' + opts.weeks,
        'SUMMARY:' + icsEscape(summary), 'DESCRIPTION:' + icsEscape(desc + (opts.appUrl ? ' ' + opts.appUrl : ''))])
        .slice(0, -1).concat(alarm('PT0M', summary), ['END:VEVENT']);
    };
    L = L.concat(weekly('plan', opts.planDay, 'ScholarStack: plan this week (2 min)',
      'Open ScholarStack, look at Next up, and book one 45-minute slot before Wednesday.'));
    L = L.concat(weekly('checkin', opts.checkinDay, 'ScholarStack: weekly check-in (1 min)',
      'Open ScholarStack > Check-in. Mark what you started or submitted this week.'));
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  /** One work session (implementation intention): a 45-minute event with a reminder at start. */
  function buildSlotICS(it, date, time, now) {
    const t = time.replace(':', '') + '00';
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ScholarStack//EN', 'METHOD:PUBLISH']
      .concat(vevent('slot-' + it.id + '-' + stamp(date) + t, ['DTSTART:' + stamp(date) + 'T' + t, 'DURATION:PT45M',
        'SUMMARY:' + icsEscape('Work on: ' + it.name), 'DESCRIPTION:' + icsEscape((it.link || '') + ' Due ' + (it.deadline || 'TBD'))])
        .slice(0, -1).concat(alarm('-PT10M', 'In 10 min: ' + it.name), ['END:VEVENT']), ['END:VCALENDAR']);
    return L.map(fold).join('\r\n') + '\r\n';
  }

  // ---- export ----------------------------------------------------------------
  function csvCell(v) { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportCSV(list, state, now) {
    const m = metrics(list, state, now), v = verdict(list, state, now), items = state.items || {};
    const rows = [['section', 'name', 'scope', 'deadline', 'intended', 'eligible_for_rule', 'status', 'started', 'essay_drafted', 'submitted',
      'days_start_to_submit', 'skip_reason', 'prompted_by', 'essay_minutes', 'essay_reused', 'essay_guess_minutes']];
    for (const it of sortItems(list, now)) {
      const e = items[it.id] || {};
      rows.push(['application', it.name, it.scope, it.deadline || '', intends(state, it) ? 'yes' : 'no', eligibleForScoring(state, it) ? 'yes' : 'no', e.status || 'todo',
        e.startedAt || '', e.draftedAt || '', e.submittedAt || '',
        e.startedAt && e.submittedAt ? daysBetween(e.startedAt, e.submittedAt) : '', e.skipReason || '', e.prompted || '',
        e.essayMin || '', e.reused === undefined ? '' : (e.reused ? 'yes' : 'no'), e.guessMin || '']);
    }
    rows.push([]);
    rows.push(['week', 'date', 'nudge_on_time', 'friction', 'parent_minutes', 'note']);
    for (const w of ((state.pilot || {}).weeks || [])) rows.push(['week ' + w.week, w.date, w.nudgeOnTime ? 'yes' : 'no', w.friction || '', w.parentMin || 0, w.note || '']);
    rows.push([]);
    rows.push(['summary', 'value']);
    const p = state.pilot || {};
    for (const [k, val] of [['exported', now], ['day0', p.day0 || ''], ['baseline_b', p.baseline === undefined ? '' : p.baseline],
      ['intended', m.intended], ['started', m.started], ['submitted', m.submitted], ['skipped', m.skipped],
      ['median_days_start_to_submit', m.medianDaysStartToSubmit], ['median_days_day0_to_submit', m.medianDaysDay0ToSubmit],
      ['checkins', m.checkins], ['nudges_on_time', m.nudgesOnTime], ['parent_minutes', m.parentMinutes],
      ['essay_minutes', m.essayMinutes], ['rule_R', v.R || ''], ['rule_D_needed', v.Dmin || ''], ['rule_D_open', v.D === undefined ? '' : v.D],
      ['verdict', v.text], ['label', v.label]]) rows.push([k, val]);
    for (const [k, n] of Object.entries(m.skipReasons)) rows.push(['skip_reason: ' + k, n]);
    for (const [k, n] of Object.entries(m.frictions)) rows.push(['friction: ' + k, n]);
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function summaryText(list, state, now) {
    const m = metrics(list, state, now), v = verdict(list, state, now);
    const fmt = o => Object.entries(o).map(([k, n]) => k + ' ' + n).join(', ') || 'none';
    return ['ScholarStack pilot, ' + now + ' (one family, not proof)',
      'Intended ' + m.intended + ' · started ' + m.started + ' · submitted ' + m.submitted + ' · skipped ' + m.skipped,
      'Median days start→submit: ' + (m.medianDaysStartToSubmit === null ? '–' : m.medianDaysStartToSubmit),
      'Skip reasons: ' + fmt(m.skipReasons), 'Who prompted submissions: ' + fmt(m.promptedBy),
      'Check-ins ' + m.checkins + ' (nudge on time ' + m.nudgesOnTime + ') · parent minutes ' + m.parentMinutes + ' · essay minutes ' + m.essayMinutes,
      'Rule (work 88): ' + v.text].join('\n');
  }

  // ---- hand-off payload (URL fragment; never sent to any server) -------------------
  function b64urlFromBytes(bytes) {
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function bytesFromB64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  /** '#d=<base64url raw-deflate JSON>' or '#j=<base64url JSON>' -> list payload. */
  async function decodeHash(hash) {
    const m = /^#?([dj])=([A-Za-z0-9_-]+)/.exec(hash || '');
    if (!m) return null;
    const bytes = bytesFromB64url(m[2]);
    const text = m[1] === 'd' ? await inflate(bytes) : new TextDecoder().decode(bytes);
    return cleanList(JSON.parse(text));
  }

  /** One-code hand-off: the list sits on the site locked (AES-256-GCM, iv|ciphertext|tag in base64url); the key comes
   *  from the QR code's link fragment, which browsers never send to the site. Wrong key or altered file: throws. */
  async function openSealed(keyB64, lockedB64) {
    const subtle = (root.crypto || globalThis.crypto).subtle;
    const key = await subtle.importKey('raw', bytesFromB64url(keyB64), 'AES-GCM', false, ['decrypt']);
    const all = bytesFromB64url(String(lockedB64).trim());
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
    const payload = new TextDecoder().decode(plain);
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error('not a ScholarStack list');
    return decodeHash('#d=' + payload);
  }

  /** Anyone can craft a link, so a list is rebuilt from known fields with checked types before it is stored. */
  function cleanList(data) {
    if (!data || !Array.isArray(data.s) || data.s.length > 200) throw new Error('not a ScholarStack list');
    const str = (v, n) => typeof v === 'string' ? v.slice(0, n || 400) : undefined;
    const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    const url = v => typeof v === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : undefined;
    const one = (v, opts, d) => opts.includes(v) ? v : d;
    const seen = new Set();
    const s = data.s.map(it => {
      if (!it || typeof it.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(it.id) || seen.has(it.id)) throw new Error('bad scholarship id');
      seen.add(it.id);
      const e = it.essay && typeof it.essay === 'object' ? { prompt: str(it.essay.prompt) || '',
        words: Number.isFinite(+it.essay.words) && it.essay.words !== null ? Math.round(+it.essay.words) : null,
        theme: one(it.essay.theme, Object.keys(THEMES), 'other') } : null;
      return { id: it.id, name: str(it.name, 200) || it.id, scope: one(it.scope, ['local', 'regional', 'state', 'national'], 'national'),
        amount: str(it.amount, 80) || 'Varies', deadline: date(it.deadline), opens: date(it.opens),
        last_year_deadline: date(it.last_year_deadline) || undefined, opens_hint: str(it.opens_hint, 200),
        deadline_status: one(it.deadline_status, ['verified-current', 'expected', 'not-published', 'closed'], 'not-published'),
        deadline_source: url(it.deadline_source), deadline_checked: date(it.deadline_checked) || undefined, link: url(it.link),
        requirements: Array.isArray(it.requirements) ? it.requirements.slice(0, 30).map(r => str(r)).filter(Boolean) : [],
        essay: e, eligibility_note: str(it.eligibility_note, 600), fit: one(it.fit, ['strong', 'likely', 'check'], 'check') };
    });
    return { v: 1, made: date(data.made), s };
  }

  /** Rebuild progress from a backup file with checked types (a crafted file must not inject markup). */
  function cleanState(st) {
    const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    const num = v => Number.isFinite(+v) && v !== null && v !== '' ? Math.max(0, Math.min(100000, Math.round(+v))) : undefined;
    const one = (v, opts) => opts.includes(v) ? v : undefined;
    const out = { items: {}, pilot: {}, settings: {} };
    for (const [id, e] of Object.entries((st && st.items) || {})) {
      if (!/^[a-z0-9-]{1,64}$/.test(id) || !e || typeof e !== 'object') continue;
      out.items[id] = { status: one(e.status, STATUSES) || 'todo', startedAt: date(e.startedAt), draftedAt: date(e.draftedAt),
        submittedAt: date(e.submittedAt), skippedAt: date(e.skippedAt), skipReason: one(e.skipReason, SKIP_REASONS),
        prompted: one(e.prompted, PROMPTED_BY), essayMin: num(e.essayMin), guessMin: num(e.guessMin), reused: typeof e.reused === 'boolean' ? e.reused : undefined,
        intend: typeof e.intend === 'boolean' ? e.intend : undefined, eligible: typeof e.eligible === 'boolean' ? e.eligible : undefined, essayTheme: one(e.essayTheme, ['none'].concat(Object.keys(THEMES))),
        history: (Array.isArray(e.history) ? e.history : []).filter(h => h && one(h.s, STATUSES) && date(h.at)).map(h => ({ s: h.s, at: h.at })) };
    }
    const p = (st && st.pilot) || {};
    out.pilot = { day0: date(p.day0), baseline: p.baseline === 'unknown' ? 'unknown' : num(p.baseline),
      weeks: (Array.isArray(p.weeks) ? p.weeks : []).filter(w => w && date(w.date)).map(w => ({ week: num(w.week) || 1, date: w.date,
        nudgeOnTime: w.nudgeOnTime === true, friction: one(w.friction, FRICTIONS), parentMin: num(w.parentMin) || 0, note: typeof w.note === 'string' ? w.note.slice(0, 500) : '' })) };
    if (p.freeze && Array.isArray(p.freeze.ids)) out.pilot.freeze = { date: date(p.freeze.date), ids: p.freeze.ids.filter(i => typeof i === 'string' && /^[a-z0-9-]{1,64}$/.test(i)) };
    const s = (st && st.settings) || {};
    out.settings = { planDay: num(s.planDay) % 7 || 1, checkinDay: num(s.checkinDay) % 7 || 5, time: /^\d{2}:\d{2}$/.test(s.time) ? s.time : '19:00' };
    out.setupDone = !!(st && st.setupDone); out.calendarAt = date(st && st.calendarAt); out.listMade = date(st && st.listMade);
    return out;
  }

  const api = { cleanState, STATUSES, STATUS_LABEL, SKIP_REASONS, PROMPTED_BY, FRICTIONS, THEMES, WINDOW_DAYS, FREEZE_DAY, HARD_STOP,
    iso, addDays, daysBetween, today, sortItems, deadlineLabel, sourceLabel, mark, statusOf, intends, nextUp, nextStep,
    essayGroups, requiredSubmissions, minDeadlines, countable, eligibleForScoring, setEligible, maybeFreeze, metrics, verdict, restartWindow, checkin,
    buildICS, buildSlotICS, exportCSV, summaryText, decodeHash, openSealed, cleanList, b64urlFromBytes, bytesFromB64url, nextWeekday };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SS = api;
})(this);
