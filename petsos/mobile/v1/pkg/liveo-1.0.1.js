// Liveo for Pets OS for Stephone: the O Store package "liveo" (registers store:liveo).
// Live and upcoming sport (football, boxing, other sports) from authorised data providers, with honest
// "where to watch" information. Liveo never shows a stream unless a provider that holds the rights supplies it.
//
// Providers plug in through PROVIDERS below; each one turns its own API into Liveo events:
//   { id, provider, sport, group: 'football'|'boxing'|'other', competition, competitionId, title, home, away,
//     homeBadge, awayBadge, badge, start (ms, UTC), allDay, status: 'live'|'upcoming'|'finished'|'off'|'unknown',
//     statusText, score: { home, away } | null, venue, country, watch: [ {name, url, country, logo} ],
//     streams: [ {name, kind: 'link'|'embed'|'video', url} ] }
// Connected now: TheSportsDB (official API; free public key "123", or the owner's own key in Liveo Settings).
// Ready for later: a "Liveo feed" (an https server the owner runs that holds licensed data or stream rights;
// format in store/liveo/FEED.md). No keys or secrets are written in this file: keys typed in Settings stay on the phone.
// Uses only what Pets OS 1.0.7 offers: Apps, h, icon, esc, Store, Phone, Shell, Dialog, Fmt, S, isWeb.
Apps.register({
  id: 'store:liveo', name: 'Liveo', cat: 'Sport', keywords: 'sport sports live football soccer boxing scores fixtures tv',
  open(w) {
    const P = 'store:liveo.';
    const DAY = 86400000, MIN = 60000;
    const now = () => Date.now();

    // ------------------------------------------------------------ settings (kept on the phone)
    const COMPETITIONS = [
      { id: '4328', name: 'Premier League', group: 'football', on: true },
      { id: '4480', name: 'UEFA Champions League', group: 'football', on: true },
      { id: '4445', name: 'Boxing', group: 'boxing', on: true },
      { id: '4329', name: 'EFL Championship', group: 'football' },
      { id: '4482', name: 'FA Cup', group: 'football' },
      { id: '4481', name: 'UEFA Europa League', group: 'football' },
      { id: '4330', name: 'Scottish Premiership', group: 'football' },
      { id: '4335', name: 'La Liga', group: 'football' },
      { id: '4332', name: 'Serie A', group: 'football' },
      { id: '4331', name: 'Bundesliga', group: 'football' },
      { id: '4334', name: 'Ligue 1', group: 'football' },
      { id: '4443', name: 'UFC', group: 'other' }
    ];
    const OTHER_SPORTS = [
      { id: 'Rugby', name: 'Rugby', on: true }, { id: 'Basketball', name: 'Basketball', on: true },
      { id: 'Motorsport', name: 'Motorsport', on: true }, { id: 'Cricket', name: 'Cricket', on: true },
      { id: 'Tennis', name: 'Tennis' }, { id: 'Ice Hockey', name: 'Ice hockey' },
      { id: 'American Football', name: 'American football' }, { id: 'Darts', name: 'Darts' }
    ];
    const REGIONS = { uk: 'United Kingdom', ie: 'Ireland', us: 'United States', other: 'Other countries' };
    const cfgDefault = () => ({
      comps: COMPETITIONS.filter(c => c.on).map(c => c.id),
      sports: OTHER_SPORTS.filter(s => s.on).map(s => s.id),
      tsdbOn: true, tsdbKey: '', feeds: [], region: 'uk'
    });
    const cfg = Object.assign(cfgDefault(), Store.app(P + 'settings', {}) || {});
    const saveCfg = () => Store.setApp(P + 'settings', cfg);

    // ------------------------------------------------------------ network: one request at a time, paced
    // TheSportsDB's free key blocks bursts (Cloudflare 1015), so Liveo spaces requests and backs off.
    class NetError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }
    const Net = {
      chain: Promise.resolve(), last: {}, blocked: {},
      get(host, url, gap, headers) {
        const job = this.chain.then(async () => {
          if (this.closed) throw new NetError('stopped', 'stopped');
          if ((this.blocked[host] || 0) > now()) throw new NetError('busy', 'busy');
          const wait = (this.last[host] || 0) + gap - now();
          if (wait > 0) await new Promise(r => setTimeout(r, wait));
          this.last[host] = now();
          let r;
          try { r = await fetch(url, { cache: 'no-store', headers: headers || {} }); }
          catch (e) {
            if (navigator.onLine === false) throw new NetError('offline', 'offline');
            this.blocked[host] = now() + 60000; // a rate-limit page has no CORS header, so it looks like this
            throw new NetError('unreachable', 'unreachable');
          }
          const text = await r.text();
          if (r.status === 429 || /error code: 1015/.test(text)) { this.blocked[host] = now() + 120000; throw new NetError('busy', 'busy'); }
          if (r.status === 401 || r.status === 403) throw new NetError('key', 'HTTP ' + r.status);
          if (!r.ok) throw new NetError('server', 'HTTP ' + r.status);
          if (!text.trim()) return null;
          try { return JSON.parse(text); } catch (e) { throw new NetError('format', 'not JSON'); }
        });
        this.chain = job.catch(() => {});
        return job;
      }
    };

    // ------------------------------------------------------------ helpers
    const utcDay = t => new Date(t).toISOString().slice(0, 10);
    const str = (v, n) => (v == null ? '' : String(v)).trim().slice(0, n || 200);
    const httpsUrl = u => { try { const x = new URL(String(u)); return x.protocol === 'https:' ? x.href : ''; } catch (e) { return ''; } };
    const sportGroup = (sport, league) => {
      const s = String(sport || '').toLowerCase(), l = String(league || '').toLowerCase();
      if (s === 'soccer' || s === 'football') return 'football';
      if (s === 'boxing' || /\bboxing\b/.test(l)) return 'boxing';
      return 'other';
    };
    const sportName = (sport, group) => group === 'football' ? 'Football' : group === 'boxing' ? 'Boxing' : (str(sport) || 'Sport');
    const LIVE = /^(1H|2H|HT|ET|BT|P|PEN_LIVE|LIVE|IN ?PLAY|INT|Q[1-4]|OT|[1-9](ST|ND|RD|TH)? ?(HALF|PERIOD|QUARTER|SET|INNINGS?))$/i;
    const DONE = /^(FT|AET|PEN|AP|AOT|AWD|WO|MATCH FINISHED|FINISHED|ENDED|AFTER (EXTRA TIME|PENALTIES)|FINAL)$/i;
    const OFF = /^(PST|POSTP(ONED)?|CANC(ELLED|ELED)?|ABD|ABANDONED|SUSP(ENDED)?|DELAYED|INT(ERRUPTED)?)$/i;
    const STATUS_WORDS = { '1H': 'First half', '2H': 'Second half', HT: 'Half-time', ET: 'Extra time', BT: 'Break', P: 'Penalties', FT: 'Full time', AET: 'After extra time', PEN: 'After penalties', NS: 'Not started', PST: 'Postponed', CANC: 'Cancelled', ABD: 'Abandoned', SUSP: 'Suspended', AWD: 'Awarded', WO: 'Walkover' };
    // The status a provider reports. Liveo only says "live" when the provider says so.
    const statusOf = (code, start, allDay) => {
      const c = str(code).toUpperCase();
      if (c && LIVE.test(c)) return 'live';
      if (c && DONE.test(c)) return 'finished';
      if (c && OFF.test(c)) return 'off';
      if (!start) return 'unknown';
      if (allDay) return now() < start + DAY ? 'upcoming' : 'finished';
      return start > now() ? 'upcoming' : 'unknown';
    };
    const num = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? null : +v;

    // ------------------------------------------------------------ provider: TheSportsDB (official API)
    // https://www.thesportsdb.com/documentation : "123" is TheSportsDB's published free key (fewer results,
    // 30 requests a minute). A key bought from TheSportsDB (Patreon) is typed into Liveo Settings instead.
    const TSDB = {
      id: 'thesportsdb', name: 'TheSportsDB', site: 'https://www.thesportsdb.com/',
      enabled: () => cfg.tsdbOn !== false,
      free: () => !cfg.tsdbKey,
      base: () => 'https://www.thesportsdb.com/api/v1/json/' + encodeURIComponent(cfg.tsdbKey || '123') + '/',
      gap: () => cfg.tsdbKey ? 700 : 6000,
      get(path) { return Net.get('thesportsdb', this.base() + path, this.gap()); },
      event(x, live) {
        const ts = str(x.strTimestamp) || (x.dateEvent ? x.dateEvent + 'T' + (str(x.strTime) || '00:00:00') : '');
        const allDay = !x.strTimestamp && (!x.strTime || /^00:00(:00)?$/.test(x.strTime)) || /T00:00:00$/.test(ts) && !str(x.strHomeTeam);
        const start = ts ? Date.parse(ts.replace(' ', 'T').replace(/(\+00:00|Z)?$/, 'Z')) : 0;
        const group = sportGroup(x.strSport, x.strLeague);
        const home = str(x.strHomeTeam), away = str(x.strAwayTeam);
        const st = statusOf(x.strStatus, start, allDay);
        const hs = num(x.intHomeScore), as = num(x.intAwayScore);
        return {
          id: 'tsdb:' + str(x.idEvent, 20), ref: str(x.idEvent, 20), provider: 'thesportsdb',
          sport: sportName(x.strSport, group), group,
          competition: str(x.strLeague) || sportName(x.strSport, group), competitionId: str(x.idLeague, 12),
          title: str(x.strEvent) || (home && away ? home + ' vs ' + away : 'Event'),
          home, away, homeBadge: httpsUrl(x.strHomeTeamBadge), awayBadge: httpsUrl(x.strAwayTeamBadge), badge: httpsUrl(x.strLeagueBadge),
          start: isNaN(start) ? 0 : start, allDay: !!allDay, status: st,
          statusText: STATUS_WORDS[str(x.strStatus).toUpperCase()] || str(x.strStatus, 40),
          progress: live ? str(x.strProgress, 10) : '',
          score: (hs != null && as != null && st !== 'upcoming') ? { home: hs, away: as } : null,
          venue: str(x.strVenue), country: str(x.strCountry), poster: httpsUrl(x.strThumb || x.strPoster),
          watch: [], streams: [], updated: now()
        };
      },
      // The list of requests for one refresh; each is cached separately with its own lifetime.
      plan(kind) {
        const t = [];
        const free = this.free();
        t.push({ key: 'tsdb:live:soccer', ttl: MIN, live: true, label: 'live football',
          run: async () => ((await this.get('livescore.php?s=Soccer')) || {}).livescore || [] });
        if (kind === 'live') return t;
        const days = free ? 2 : 7;
        for (let d = 0; d < days; d++) {
          const day = utcDay(now() + d * DAY);
          cfg.comps.filter(id => (COMPETITIONS.find(c => c.id === id) || {}).group === 'football').forEach(id => t.push({ key: 'tsdb:day:' + day + ':l' + id, ttl: d === 0 ? 10 * MIN : 60 * MIN, label: (COMPETITIONS.find(c => c.id === id) || {}).name || 'competition',
            run: async () => ((await this.get('eventsday.php?d=' + day + '&l=' + encodeURIComponent(id))) || {}).events || [] }));
        }
        // Fights are rare on any one day: ask for each fight league's next events instead.
        cfg.comps.filter(id => (COMPETITIONS.find(c => c.id === id) || {}).group !== 'football').forEach(id => t.push({ key: 'tsdb:next:' + id, ttl: 60 * MIN, label: (COMPETITIONS.find(c => c.id === id) || {}).name || 'competition',
          run: async () => ((await this.get('eventsnextleague.php?id=' + encodeURIComponent(id))) || {}).events || [] }));
        const sportDays = free ? 1 : 3;
        for (let d = 0; d < sportDays; d++) {
          const day = utcDay(now() + d * DAY);
          cfg.sports.forEach(s => t.push({ key: 'tsdb:day:' + day + ':s' + s, ttl: 30 * MIN, label: s.toLowerCase(),
            run: async () => ((await this.get('eventsday.php?d=' + day + '&s=' + encodeURIComponent(s.replace(/ /g, '_')))) || {}).events || [] }));
        }
        return t;
      },
      // TV channels TheSportsDB lists for one event.
      async tv(ev) {
        const r = await this.get('lookuptv.php?id=' + encodeURIComponent(ev.tsdbRef || ev.ref));
        return ((r && (r.tvevent || r.tvevents)) || []).map(c => ({ name: str(c.strChannel, 80), country: str(c.strCountry, 60), logo: httpsUrl(c.strLogo) })).filter(c => c.name);
      }
    };

    // ------------------------------------------------------------ provider: Liveo feed (owner's server, later)
    // A feed is an https URL the owner controls that answers GET with { liveo: 1, provider, events: [...] }.
    // It is how licensed data (e.g. football-data.org through a small server that keeps the key) and streams
    // the owner has the rights to can be added without a new Liveo. Optional token is sent as a Bearer header.
    const FEED = {
      id: 'feed', name: 'Liveo feed',
      plan(kind) {
        return (cfg.feeds || []).filter(f => f.on !== false && httpsUrl(f.url)).map(f => ({
          key: 'feed:' + f.url, ttl: kind === 'live' ? MIN : 5 * MIN, live: true, feed: f, label: f.name || 'feed',
          run: async () => {
            const host = new URL(f.url).host;
            const r = await Net.get('feed:' + host, f.url, 1000, f.token ? { Authorization: 'Bearer ' + f.token } : {});
            if (!r || r.liveo !== 1 || !Array.isArray(r.events)) throw new NetError('format', 'not a Liveo feed');
            return r.events.slice(0, 2000);
          }
        }));
      },
      event(x, f) {
        const start = Date.parse(x.start);
        const group = ['football', 'boxing', 'other'].indexOf(x.group) >= 0 ? x.group : sportGroup(x.sport, x.competition);
        const st = ['live', 'upcoming', 'finished', 'off', 'unknown'].indexOf(x.status) >= 0 ? x.status : statusOf(x.status, start, false);
        const sc = x.score && num(x.score.home) != null && num(x.score.away) != null ? { home: num(x.score.home), away: num(x.score.away) } : null;
        const fname = str(f.name, 60) || new URL(f.url).host;
        return {
          id: 'feed:' + new URL(f.url).host + ':' + str(x.id, 80), provider: 'feed', providerName: fname,
          sport: sportName(x.sport, group), group, competition: str(x.competition) || sportName(x.sport, group), competitionId: str(x.competitionId, 40),
          title: str(x.title) || [str(x.home), str(x.away)].filter(Boolean).join(' vs ') || 'Event',
          home: str(x.home), away: str(x.away), homeBadge: httpsUrl(x.homeBadge), awayBadge: httpsUrl(x.awayBadge), badge: httpsUrl(x.badge),
          participants: Array.isArray(x.participants) ? x.participants.slice(0, 20).map(p => str(p, 80)).filter(Boolean) : [],
          start: isNaN(start) ? 0 : start, allDay: !!x.allDay, status: st, statusText: str(x.statusText, 40), progress: '',
          score: st === 'upcoming' ? null : sc, venue: str(x.venue), country: str(x.country), poster: '',
          watch: (Array.isArray(x.watch) ? x.watch : []).slice(0, 12).map(c => ({ name: str(c.name, 80), country: str(c.country, 60), url: httpsUrl(c.url), logo: httpsUrl(c.logo) })).filter(c => c.name),
          // Streams only come from a feed the owner configured, only over https, and only of these kinds.
          streams: (Array.isArray(x.streams) ? x.streams : []).slice(0, 6).map(s => ({ name: str(s.name, 60) || fname, kind: ['link', 'embed', 'video'].indexOf(s.kind) >= 0 ? s.kind : 'link', url: httpsUrl(s.url) })).filter(s => s.url),
          updated: now()
        };
      }
    };

    // ------------------------------------------------------------ official broadcasters (for "where to watch")
    const BROADCASTERS = [
      [/^sky ?sports|^sky ?go|^now ?(tv)?$|^sky /i, 'Sky Sports', 'https://www.skysports.com/watch'],
      [/^tnt ?sports|^bt ?sport|^discovery\+/i, 'TNT Sports', 'https://www.tntsports.co.uk/'],
      [/^bbc/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer'],
      [/^itv/i, 'ITVX', 'https://www.itv.com/'],
      [/^channel ?(4|5)/i, null, null],
      [/^dazn/i, 'DAZN', 'https://www.dazn.com/'],
      [/^amazon|^prime video/i, 'Prime Video', 'https://www.primevideo.com/'],
      [/^premier sports/i, 'Premier Sports', 'https://www.premiersports.com/'],
      [/^viaplay/i, 'Viaplay', 'https://viaplay.com/'],
      [/^rt[eé]/i, 'RTÉ Player', 'https://www.rte.ie/player/'],
      [/^virgin media/i, 'Virgin Media Play', 'https://www.virginmediatelevision.ie/'],
      [/^espn/i, 'ESPN', 'https://www.espn.com/watch/'],
      [/^peacock/i, 'Peacock', 'https://www.peacocktv.com/'],
      [/^paramount/i, 'Paramount+', 'https://www.paramountplus.com/'],
      [/^fox/i, 'FOX Sports', 'https://www.foxsports.com/live'],
      [/^ufc fight pass/i, 'UFC Fight Pass', 'https://ufcfightpass.com/'],
      [/^nfl/i, 'NFL', 'https://www.nfl.com/'],
      [/^nba league pass|^nba tv/i, 'NBA League Pass', 'https://www.nba.com/watch'],
      [/^f1 ?tv/i, 'F1 TV', 'https://f1tv.formula1.com/'],
      [/^youtube/i, 'YouTube', 'https://www.youtube.com/']
    ];
    const DIRECTORY = {
      uk: ['BBC iPlayer', 'ITVX', 'Sky Sports', 'TNT Sports', 'DAZN', 'Prime Video', 'Premier Sports', 'Viaplay'],
      ie: ['RTÉ Player', 'Virgin Media Play', 'Sky Sports', 'Premier Sports', 'DAZN', 'TNT Sports'],
      us: ['ESPN', 'Peacock', 'Paramount+', 'FOX Sports', 'DAZN', 'Prime Video'],
      other: ['DAZN', 'Prime Video', 'ESPN', 'YouTube']
    };
    const officialSite = name => { for (const [re, label, url] of BROADCASTERS) if (re.test(name)) return url ? { label, url } : null; return null; };
    const byLabel = label => { const b = BROADCASTERS.find(x => x[1] === label); return b ? { label, url: b[2] } : null; };

    // ------------------------------------------------------------ data: cache + merge
    // Cache entries: key -> { at, events: [normalised], error }. Saved so Liveo has something offline.
    let cache = Store.app(P + 'cache', {}) || {};
    let tvCache = Store.app(P + 'tv', {}) || {};
    const problems = {};     // task key -> NetError kind, for the banner
    let running = false, lastRun = 0, lastOk = Store.app(P + 'lastOk', 0) || 0;
    const saveCache = () => {
      // Drop entries older than two days so storage doesn't grow.
      for (const k in cache) if (now() - cache[k].at > 2 * DAY) delete cache[k];
      Store.setApp(P + 'cache', cache);
    };
    const providerEvents = (task, raw) => task.feed ? raw.map(x => { try { return FEED.event(x, task.feed); } catch (e) { return null; } }).filter(Boolean)
      : raw.map(x => TSDB.event(x, task.live));

    // All events, de-duplicated. Live entries (newer) win over day lists for the same event.
    function allEvents() {
      const map = new Map();
      const entries = Object.entries(cache).sort((a, b) => (a[1].live ? 1 : 0) - (b[1].live ? 1 : 0) || a[1].at - b[1].at);
      for (const [, c] of entries) for (const e of c.events || []) {
        const had = map.get(e.id);
        // a live list that has stopped listing a match doesn't make it live forever: stale live entries expire
        if (c.live && e.status === 'live' && now() - c.at > 10 * MIN) continue;
        map.set(e.id, had ? Object.assign({}, had, e, { badge: e.badge || had.badge, venue: e.venue || had.venue, country: e.country || had.country, homeBadge: e.homeBadge || had.homeBadge, awayBadge: e.awayBadge || had.awayBadge, poster: e.poster || had.poster }) : e);
      }
      // A match that a day list says "not started" but whose start passed long ago: say we don't know.
      return mergeProviders(Array.from(map.values()).filter(e => e.start || e.status === 'live'));
    }
    // The same match from TheSportsDB and a Liveo feed (e.g. football-data.org): keep the feed's version
    // (licensed, faster live data) but remember TheSportsDB's id so TV listings still work. Two entries are
    // one match when they start within 15 minutes and share a team: a team can't play two matches at once.
    const teamKey = n => String(n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter(w => w && ['fc', 'afc', 'cf', 'sc', 'ac', 'the', 'and', 'club', 'de', 'cd'].indexOf(w) < 0);
    const sameTeam = (a, b) => {
      const x = teamKey(a), y = teamKey(b);
      if (!x.length || !y.length) return false;
      if (x.join(' ') === y.join(' ')) return true;
      return x[0].slice(0, 4) === y[0].slice(0, 4) && Math.min(x[0].length, y[0].length) >= 3;
    };
    function mergeProviders(list) {
      const feed = list.filter(e => e.provider === 'feed' && e.home && e.away && e.start);
      if (!feed.length) return list;
      const alias = {}, drop = new Set();
      list.forEach(t => {
        if (t.provider !== 'thesportsdb' || !t.home || !t.away || !t.start) return;
        const f = feed.find(f => f.group === t.group && Math.abs(f.start - t.start) <= 15 * MIN && (sameTeam(f.home, t.home) || sameTeam(f.away, t.away)));
        if (!f) return;
        drop.add(t.id);
        f.tsdbRef = t.ref; f.tsdbId = t.id;
        if (!f.venue) f.venue = t.venue;
        if (t.competition !== f.competition) alias[t.competition] = f.competition;
      });
      return list.filter(e => !drop.has(e.id)).map(e => e.provider === 'thesportsdb' && alias[e.competition] ? Object.assign({}, e, { competition: alias[e.competition] }) : e);
    }

    async function refresh(kind, force) {
      if (running) return;
      running = true; lastRun = now();
      const tasks = [].concat(TSDB.enabled() ? TSDB.plan(kind) : [], FEED.plan(kind));
      paint();
      try {
        for (const t of tasks) {
          if (closed) break;
          const c = cache[t.key];
          if (!force && c && now() - c.at < t.ttl) continue;
          try {
            const raw = await t.run();
            cache[t.key] = { at: now(), live: !!t.live, events: providerEvents(t, raw || []) };
            delete problems[t.key];
            lastOk = now(); Store.setApp(P + 'lastOk', lastOk);
            saveCache();
          } catch (e) {
            if (e.kind === 'stopped') break;
            problems[t.key] = { kind: e.kind || 'server', label: t.label, feed: !!t.feed };
            if (e.kind === 'offline' || e.kind === 'busy' || e.kind === 'unreachable') {
              // the rest would fail the same way: mark them and stop
              tasks.slice(tasks.indexOf(t) + 1).forEach(x => { if (!cache[x.key] || now() - cache[x.key].at >= x.ttl) problems[x.key] = { kind: e.kind, label: x.label, feed: !!x.feed }; });
              break;
            }
          }
          paint();
        }
      } finally { running = false; paint(); }
    }

    // ------------------------------------------------------------ formatting
    const dayLabel = t => {
      const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
      const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / DAY);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff === -1) return 'Yesterday';
      return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    };
    const whenText = e => !e.start ? 'Time not announced' : dayLabel(e.start) + (e.allDay ? '' : ' · ' + Fmt.time(new Date(e.start)) + (Fmt.ampm(new Date(e.start)) ? ' ' + Fmt.ampm(new Date(e.start)) : ''));
    const statusPill = e => {
      const base = { fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '10px', letterSpacing: '.03em', whiteSpace: 'nowrap', flex: 'none' };
      if (e.status === 'live') return h('span', { class: 'liveo-live', style: Object.assign({}, base, { background: '#ff3b30', color: '#fff' }), text: 'LIVE' + (e.progress && /^\d+$/.test(e.progress) ? ' ' + e.progress + '′' : e.statusText === 'Half-time' ? ' HT' : '') });
      if (e.status === 'finished') return h('span', { style: Object.assign({}, base, { background: 'var(--button)', color: 'var(--text2)' }), text: 'FINAL' });
      if (e.status === 'off') return h('span', { style: Object.assign({}, base, { background: 'var(--button)', color: '#ff9f0a' }), text: (e.statusText || 'OFF').toUpperCase().slice(0, 12) });
      if (e.status === 'unknown') return h('span', { style: Object.assign({}, base, { background: 'var(--button)', color: 'var(--text3)' }), text: 'NO UPDATE' });
      return null;
    };
    const badgeImg = (src, size) => {
      const box = h('div', { style: { width: size + 'px', height: size + 'px', borderRadius: '8px', flex: 'none', background: 'var(--button)', overflow: 'hidden', display: 'grid', placeItems: 'center' } });
      if (src) {
        const img = h('img', { src: /thesportsdb\.com\/images\//.test(src) ? src + '/tiny' : src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', style: { width: '100%', height: '100%', objectFit: 'contain' } });
        img.onerror = () => { if (img.src.endsWith('/tiny')) img.src = src; else img.remove(); };
        box.append(img);
      }
      return box;
    };

    // ------------------------------------------------------------ main screen
    const TABS = [['live', 'Live'], ['upcoming', 'Upcoming'], ['football', 'Football'], ['boxing', 'Boxing'], ['other', 'Other']];
    let tab = Store.app(P + 'tab', 'live');
    if (!TABS.some(t => t[0] === tab)) tab = 'live';
    let query = '', when = 'all', comp = '';
    let banner, list, closed = false, timer = null;

    function filtered() {
      const q = query.trim().toLowerCase();
      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      return allEvents().filter(e => {
        if (tab === 'live' && e.status !== 'live') return false;
        if (tab === 'upcoming' && !(e.status === 'upcoming' || e.status === 'live')) return false;
        if ((tab === 'football' || tab === 'boxing' || tab === 'other') && e.group !== tab) return false;
        if (tab !== 'live' && when !== 'all' && e.start) {
          const d = Math.floor((e.start - today0) / DAY);
          if (when === 'today' && d !== 0) return false;
          if (when === 'tomorrow' && d !== 1) return false;
          if (when === 'week' && (d < 0 || d > 6)) return false;
        }
        if (comp && e.competition !== comp) return false;
        if (q && [e.title, e.home, e.away, e.competition, e.sport, e.venue, e.country].concat(e.participants || []).join(' ').toLowerCase().indexOf(q) < 0) return false;
        return true;
      }).sort((a, b) => {
        const rank = e => e.status === 'live' ? 0 : e.status === 'upcoming' ? 1 : e.status === 'unknown' ? 2 : 3;
        if (tab !== 'live' && rank(a) !== rank(b)) return rank(a) - rank(b);
        if (a.status === 'finished' && b.status === 'finished') return b.start - a.start;
        return a.start - b.start;
      });
    }
    const followed = e => cfg.comps.indexOf(e.competitionId) >= 0 || e.provider === 'feed';

    function bannerText() {
      const ks = Object.values(problems);
      const saved = lastOk ? 'Showing what was saved ' + Fmt.ago(lastOk) + '.' : 'Nothing is saved yet.';
      if (navigator.onLine === false || ks.some(p => p.kind === 'offline')) return { tone: 'warn', text: 'You’re offline. ' + saved + ' Liveo refreshes when you’re back online.' };
      const partial = lastOk && now() - lastOk < 3 * MIN && navigator.onLine !== false && ks.every(p => p.kind === 'busy' || p.kind === 'unreachable') && !ks.some(p => p.feed);
      if (partial && ks.length) return { tone: 'info', text: 'Still to load: ' + Array.from(new Set(ks.map(p => p.label))).slice(0, 4).join(', ') + '. TheSportsDB’s free key allows only a few requests at a time, so Liveo fetches the rest in a minute or two.' };
      if (ks.some(p => p.kind === 'busy')) return { tone: 'warn', text: 'TheSportsDB asked Liveo to slow down (free key limit). ' + saved + ' Liveo tries again in two minutes.' };
      if (ks.some(p => p.kind === 'unreachable' && !p.feed)) return { tone: 'warn', text: 'TheSportsDB can’t be reached right now (it may be limiting requests on the free key). ' + saved + ' Liveo tries again in a minute.' };
      if (ks.some(p => p.kind === 'key' && !p.feed)) return { tone: 'bad', text: 'TheSportsDB didn’t accept the API key in Liveo Settings. Check it, or remove it to use the free key.' };
      const feedBad = ks.find(p => p.feed);
      if (feedBad) return { tone: 'warn', text: 'The Liveo feed “' + feedBad.label + '” isn’t working (' + ({ format: 'it isn’t a Liveo feed', key: 'its token was refused', server: 'its server had a problem' }[feedBad.kind] || 'it can’t be reached') + ').' };
      if (ks.length) return { tone: 'warn', text: 'Some results couldn’t be loaded (' + ks.map(p => p.label).slice(0, 3).join(', ') + '). Pull down or tap refresh to try again.' };
      if (running) return { tone: 'info', text: 'Updating…' };
      if (!TSDB.enabled() && !(cfg.feeds || []).length) return { tone: 'bad', text: 'No sports data provider is switched on. Turn one on in Liveo Settings.' };
      return lastOk ? { tone: 'ok', text: 'Updated ' + Fmt.ago(lastOk) + ' · ' + [TSDB.enabled() ? 'TheSportsDB' + (TSDB.free() ? ' (free)' : '') : null].concat((cfg.feeds || []).filter(f => f.on !== false).map(f => f.name || 'feed')).filter(Boolean).join(', ') } : null;
    }

    function row(e) {
      const r = h('button', { class: 'row liveo-ev', 'data-ev': e.id, style: { width: '100%', textAlign: 'left', color: 'var(--text)', alignItems: 'center' } });
      const two = e.home && e.away;
      const names = h('div', { class: 'grow' });
      if (two) {
        [[e.home, e.homeBadge, e.score && e.score.home, e.score && e.score.away], [e.away, e.awayBadge, e.score && e.score.away, e.score && e.score.home]].forEach(([n, b, s, o]) => {
          names.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' } },
            badgeImg(b, 20), h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: e.score && s > o ? 600 : 400 }, text: n }),
            e.score ? h('b', { style: { fontVariantNumeric: 'tabular-nums', minWidth: '18px', textAlign: 'right' }, text: String(s) }) : null));
        });
      } else {
        names.append(h('div', { style: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }, text: e.title }));
      }
      names.append(h('div', { class: 'sub', text: (tab === 'live' ? e.sport + ' · ' : '') + (e.status === 'live' ? (e.statusText || 'In play') : whenText(e)) + (e.streams && e.streams.length ? ' · Stream available' : '') }));
      const pill = statusPill(e);
      r.append(two ? null : badgeImg(e.badge, 34), names, pill, h('span', { class: 'chev', html: icon('chevron-right') }));
      r.onclick = () => openEvent(e.id);
      return r;
    }

    let detailDraw = null;
    function paint() {
      if (closed) return;
      if (!list || !list.isConnected) { if (detailDraw) detailDraw(); return; }
      const b = bannerText();
      banner.className = 'liveo-banner';
      banner.style.display = b ? 'flex' : 'none';
      if (b) {
        const col = { ok: 'var(--text3)', info: 'var(--text2)', warn: '#ff9f0a', bad: '#ff453a' }[b.tone];
        banner.style.color = col;
        banner.innerHTML = '';
        banner.append(h('span', { html: icon(b.tone === 'ok' ? 'check' : b.tone === 'info' ? 'refresh-cw' : b.tone === 'bad' ? 'triangle-alert' : (navigator.onLine === false ? 'wifi-off' : 'info')) }), h('span', { text: b.text }));
      }
      list.innerHTML = '';
      const evs = filtered();
      const loadingFirst = running && !Object.keys(cache).length;
      if (loadingFirst) {
        list.append(h('div', { class: 'empty-state liveo-loading', html: icon('refresh-cw') + '<br>Loading sport from TheSportsDB…<br><span style="font-size:13px">The free service is slow on purpose: results appear as they arrive.</span>' }));
        return;
      }
      if (!evs.length) {
        const msg = query || comp ? 'Nothing matches your search or filters.' :
          tab === 'live' ? 'Nothing is live right now in the sport Liveo follows.' + (running ? '<br>Still checking…' : '') :
          tab === 'boxing' ? 'No boxing found for these days.' + (TSDB.free() ? '<br>The free TheSportsDB key returns only a few events per day, so some fights may be missing.' : '') :
          'No events found for these days.';
        const es = h('div', { class: 'empty-state liveo-empty', html: icon(tab === 'live' ? 'radio' : 'calendar') + '<br>' + msg });
        if (query || comp || when !== 'all') {
          const clr = h('button', { class: 'btn secondary', text: 'Clear filters', style: { marginTop: '14px' } });
          clr.onclick = () => { query = ''; comp = ''; when = 'all'; renderRoot(); };
          es.append(h('br'), clr);
        }
        list.append(es);
        return;
      }
      // Group by competition; competitions Liveo follows come first.
      const groups = new Map();
      evs.forEach(e => { const k = e.competition; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
      let order = Array.from(groups.entries());
      order.sort((a, b) => (followed(b[1][0]) ? 1 : 0) - (followed(a[1][0]) ? 1 : 0));
      const big = tab === 'live' && order.length > 8 && !expanded;
      let shown = order;
      if (big) {
        const fol = order.filter(g => followed(g[1][0]));
        shown = fol.concat(order.filter(g => !followed(g[1][0])).slice(0, Math.max(0, 6 - fol.length)));
      }
      shown.forEach(([name, items]) => {
        list.append(h('div', { class: 'label', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, badgeImg(items[0].badge, 18), h('span', { text: name + (tab === 'live' || items[0].sport === name ? '' : ' · ' + items[0].sport) })));
        const card = h('div', { class: 'card' });
        items.slice(0, 60).forEach(e => card.append(row(e)));
        list.append(card);
      });
      if (big) {
        const rest = order.length - shown.length, n = order.slice(shown.length).reduce((s, g) => s + g[1].length, 0);
        const more = h('button', { class: 'btn secondary block liveo-more', text: 'Show ' + n + ' more live in ' + rest + ' other competitions' });
        more.onclick = () => { expanded = true; paint(); };
        list.append(more);
      }
      list.append(h('p', { style: { color: 'var(--text3)', fontSize: '12px', textAlign: 'center', margin: '14px 8px 4px', lineHeight: 1.5 },
        text: 'Sports data from ' + [TSDB.enabled() ? 'TheSportsDB' : null].concat((cfg.feeds || []).filter(f => f.on !== false).map(f => f.name || 'your Liveo feed')).filter(Boolean).join(' and ') + '. Times in your phone’s time zone.' }));
    }
    let expanded = false;

    function renderRoot() {
      w.root(body => {
        w.actions([{ icon: 'refresh-cw', label: 'Refresh', fn: () => { if (!running) { for (const k in problems) delete problems[k]; Net.blocked = {}; refresh('all', true); } else Shell.toast('Liveo is already updating'); } },
          { icon: 'settings', label: 'Liveo Settings', fn: openSettings }]);
        const field = h('input', { type: 'search', class: 'liveo-search', placeholder: 'Search teams, fighters, competitions', 'aria-label': 'Search sport', value: query, autocomplete: 'off', enterkeyhint: 'search',
          style: { flex: 1, minWidth: 0, background: 'none', border: 0, outline: 0, color: 'var(--text)', height: '100%', fontSize: '16px' } });
        field.addEventListener('input', () => { query = field.value; paint(); });
        field.addEventListener('keydown', ev => { if (ev.key === 'Enter') field.blur(); });
        body.append(h('div', { class: 'search', style: { background: 'var(--button)', color: 'var(--text3)', marginBottom: '12px' }, html: icon('search') }, field));
        const seg = h('div', { class: 'seg liveo-tabs' });
        TABS.forEach(([k, l]) => {
          const b = h('button', { class: k === tab ? 'on' : '', 'data-tab': k, text: l, style: { fontSize: '13px', padding: '0 2px' } });
          b.onclick = () => { tab = k; comp = ''; expanded = false; Store.setApp(P + 'tab', tab); renderRoot(); };
          seg.append(b);
        });
        body.append(seg);
        // Filters: day and competition (not for Live, which is always "now").
        if (tab !== 'live') {
          const chips = h('div', { style: { display: 'flex', gap: '6px', overflowX: 'auto', marginBottom: '10px', paddingBottom: '2px' } });
          [['all', 'All days'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next 7 days']].forEach(([k, l]) => {
            const c = h('button', { class: 'liveo-when', 'data-when': k, text: l, style: { height: '32px', padding: '0 12px', borderRadius: '16px', fontSize: '13px', flex: 'none', background: when === k ? 'var(--accent)' : 'var(--button)', color: when === k ? '#fff' : 'var(--text)' } });
            c.onclick = () => { when = k; renderRoot(); };
            chips.append(c);
          });
          const cb = h('button', { class: 'liveo-comp', text: comp ? comp + ' ✕' : 'Competition ▾', style: { height: '32px', padding: '0 12px', borderRadius: '16px', fontSize: '13px', flex: 'none', background: comp ? 'var(--accent)' : 'var(--button)', color: comp ? '#fff' : 'var(--text)' } });
          cb.onclick = () => {
            if (comp) { comp = ''; renderRoot(); return; }
            const names = Array.from(new Set(allEvents().filter(e => tab === 'upcoming' ? (e.status === 'upcoming' || e.status === 'live') : e.group === tab).map(e => e.competition))).sort();
            if (!names.length) { Shell.toast('No competitions loaded yet'); return; }
            Dialog.menu('Competition', null, names.slice(0, 30).map(n => ({ label: n, fn: () => { comp = n; renderRoot(); } })));
          };
          chips.append(cb);
          body.append(chips);
        }
        banner = h('div', { class: 'liveo-banner', style: { display: 'none', gap: '8px', alignItems: 'flex-start', fontSize: '13px', lineHeight: 1.45, margin: '0 4px 6px' } });
        list = h('div', { class: 'liveo-list' });
        body.append(banner, list);
        paint();
      });
    }

    // ------------------------------------------------------------ event screen
    function findEvent(id) { return allEvents().find(e => e.id === id); }
    function openEvent(id) {
      const e0 = findEvent(id);
      if (!e0) { Shell.toast('That event is no longer listed'); return; }
      let tvState = tvCache[id] && now() - tvCache[id].at < 6 * 3600000 ? 'done' : 'idle';
      const loadTv = async () => {
        const e = findEvent(id) || e0;
        if (!(e.provider === 'thesportsdb' || e.tsdbRef) || !TSDB.enabled()) return;
        tvState = 'loading'; draw();
        try { tvCache[id] = { at: now(), list: await TSDB.tv(e) }; tvState = 'done'; Store.setApp(P + 'tv', pruneTv()); }
        catch (err) { tvState = err.kind || 'error'; }
        draw();
      };
      let bodyEl = null, seen = '';
      const sig = () => { const e = findEvent(id) || e0; return JSON.stringify([e.status, e.statusText, e.progress, e.score, e.start]); };
      const draw = () => { if (bodyEl && bodyEl.isConnected && w._render === detail) { const y = w.body.scrollTop; bodyEl.innerHTML = ''; detail(bodyEl); w.body.scrollTop = y; } };
      detailDraw = () => { if (sig() !== seen) draw(); };
      function detail(body) {
        bodyEl = body; seen = sig();
        const e = findEvent(id) || e0;
        w.actions([{ icon: 'refresh-cw', label: 'Refresh event', fn: () => { if (e.provider === 'thesportsdb' || e.tsdbRef) { delete tvCache[id]; loadTv(); } refresh(e.status === 'live' ? 'live' : 'all', true); } }]);
        // Header card
        const head = h('div', { class: 'card liveo-detail', style: { padding: '16px', textAlign: 'center' } });
        head.append(h('div', { style: { color: 'var(--text2)', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' } }, badgeImg(e.badge, 20), h('span', { text: e.competition })));
        if (e.home && e.away) {
          const side = (n, b) => h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' } }, badgeImg(b, 56), h('div', { style: { fontWeight: 600, fontSize: '15px', lineHeight: 1.25 }, text: n }));
          head.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '16px 0 8px' } },
            side(e.home, e.homeBadge),
            h('div', { class: 'liveo-score', style: { fontSize: e.score ? '34px' : '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: e.score ? 'var(--text)' : 'var(--text3)', flex: 'none', minWidth: '70px' }, text: e.score ? e.score.home + ' – ' + e.score.away : 'vs' }),
            side(e.away, e.awayBadge)));
        } else {
          head.append(h('div', { style: { fontSize: '22px', fontWeight: 700, margin: '12px 0 6px', lineHeight: 1.25 }, text: e.title }));
          if (e.participants && e.participants.length) head.append(h('div', { style: { color: 'var(--text2)' }, text: e.participants.join(' · ') }));
        }
        const pill = statusPill(e);
        head.append(h('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '8px', color: 'var(--text2)', fontSize: '14px' } }, pill,
          h('span', { text: e.status === 'live' ? (e.statusText || 'In play') : e.status === 'upcoming' ? whenText(e) : e.status === 'unknown' ? 'Should have started. ' + (e.provider === 'thesportsdb' ? 'TheSportsDB hasn’t reported it yet.' : 'No update from the provider.') : (e.statusText || '') })));
        body.append(head);
        // Facts
        const facts = h('div', { class: 'card' });
        const fact = (k, v) => { if (v) facts.append(h('div', { class: 'row' }, h('div', { class: 'grow', text: k }), h('div', { class: 'val', style: { textAlign: 'right', maxWidth: '62%' }, text: v }))); };
        fact('Sport', e.sport);
        fact('Competition', e.competition);
        fact('Start', e.start ? new Date(e.start).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + (e.allDay ? ' (time not given)' : ', ' + Fmt.time(new Date(e.start)) + (Fmt.ampm(new Date(e.start)) ? ' ' + Fmt.ampm(new Date(e.start)) : '')) : 'Not announced');
        fact('Status', { live: 'Live' + (e.statusText ? ' · ' + e.statusText : ''), upcoming: 'Not started', finished: 'Finished' + (e.statusText ? ' · ' + e.statusText : ''), off: e.statusText || 'Off', unknown: 'No update yet' }[e.status]);
        fact('Venue', e.venue);
        fact('Country', e.country);
        fact('Data from', e.provider === 'feed' ? e.providerName : 'TheSportsDB');
        body.append(h('div', { class: 'label', text: 'Details' }), facts);

        // Watch: authorised streams first (only from a configured provider), then TV listings, then official services.
        body.append(h('div', { class: 'label', text: 'Watch' }));
        const watch = h('div', { class: 'card liveo-watch' });
        if (e.streams && e.streams.length) {
          e.streams.forEach(s => {
            const b = h('button', { class: 'row liveo-stream', style: { width: '100%', textAlign: 'left', color: 'var(--text)' } },
              h('div', { class: 'sq', style: { background: '#ff3b30' }, html: icon(s.kind === 'link' ? 'globe' : 'play') }),
              h('div', { class: 'grow' }, h('div', { text: (s.kind === 'link' ? 'Watch on ' : 'Play on ') + s.name }), h('div', { class: 'sub', text: 'Authorised stream supplied by ' + (e.providerName || 'your provider') })),
              h('span', { class: 'chev', html: icon('chevron-right') }));
            b.onclick = () => s.kind === 'link' ? Phone.openUrl(s.url) : openPlayer(e, s);
            watch.append(b);
          });
        } else {
          watch.append(h('div', { class: 'row liveo-nostream' }, h('div', { class: 'sq', style: { background: 'var(--button)', color: 'var(--text2)' }, html: icon('info') }),
            h('div', { class: 'grow' }, h('div', { text: 'No stream in Liveo' }), h('div', { class: 'sub', style: { lineHeight: 1.4 }, text: 'Liveo only plays streams from a provider that holds the rights, and none is connected for this event. Watch it with an official broadcaster below.' }))));
        }
        body.append(watch);
        // TV listings (TheSportsDB)
        const tv = h('div', { class: 'card liveo-tv' });
        const tvList = (tvCache[id] && tvCache[id].list) || e.watch || [];
        if ((e.provider === 'thesportsdb' || e.tsdbRef) && tvState === 'idle') { setTimeout(loadTv, 0); }
        if (tvState === 'loading') tv.append(h('div', { class: 'row' }, h('div', { class: 'grow sub', text: 'Looking up TV listings…' })));
        else if (tvList.length) {
          const mine = { uk: /united kingdom|england|scotland|wales|^uk$/i, ie: /ireland/i, us: /united states|usa/i, other: /^$/ }[cfg.region];
          tvList.slice().sort((a, b) => (mine.test(b.country) ? 1 : 0) - (mine.test(a.country) ? 1 : 0)).slice(0, 12).forEach(c => {
            const site = c.url ? { label: c.name, url: c.url } : officialSite(c.name);
            const r = h('button', { class: 'row', style: { width: '100%', textAlign: 'left', color: 'var(--text)' } },
              c.logo ? badgeImg(c.logo, 30) : h('div', { class: 'sq', style: { background: 'var(--accent)' }, html: icon('monitor') }),
              h('div', { class: 'grow' }, h('div', { text: c.name }), h('div', { class: 'sub', text: (c.country ? c.country + ' · ' : '') + (site ? 'Opens ' + site.label + '’s official site' : 'Listed TV channel') })),
              site ? h('span', { class: 'chev', html: icon('chevron-right') }) : null);
            if (site) r.onclick = () => Phone.openUrl(site.url);
            tv.append(r);
          });
        } else if (e.provider === 'thesportsdb' || e.tsdbRef) {
          tv.append(h('div', { class: 'row' }, h('div', { class: 'grow sub', style: { lineHeight: 1.4 }, text: tvState === 'done' ? 'TheSportsDB has no TV listing for this event yet.' :
            tvState === 'offline' ? 'TV listings need the internet.' : tvState === 'busy' ? 'TheSportsDB is busy (free key limit). Tap refresh in a couple of minutes.' : 'TV listings couldn’t be loaded. Tap refresh to try again.' })));
        }
        if (tv.childNodes.length) body.append(h('div', { class: 'label', text: 'TV listings' }), tv);
        // Official services in the owner's region
        const dir = h('div', { class: 'card liveo-official' });
        DIRECTORY[cfg.region].map(byLabel).filter(Boolean).forEach(s => {
          const r = h('button', { class: 'row', style: { width: '100%', textAlign: 'left', color: 'var(--text)' } },
            h('div', { class: 'grow', text: s.label }), h('span', { class: 'sub', text: new URL(s.url).host.replace(/^www\./, '') }), h('span', { class: 'chev', html: icon('chevron-right') }));
          r.onclick = () => Phone.openUrl(s.url);
          dir.append(r);
        });
        body.append(h('div', { class: 'label', text: 'Official services · ' + REGIONS[cfg.region] }), dir,
          h('p', { style: { color: 'var(--text3)', fontSize: '12px', lineHeight: 1.5, margin: '0 6px 10px' }, text: 'Broadcast rights change by event and country. Liveo doesn’t know which service has this one unless a TV listing says so: check the service’s own schedule. Most need a subscription or TV licence.' }));
      }
      w.push(e0.sport, detail);
    }
    const pruneTv = () => { for (const k in tvCache) if (now() - tvCache[k].at > DAY) delete tvCache[k]; return tvCache; };

    // A player for streams a configured provider supplies (kind 'embed' = the provider's own https player page,
    // kind 'video' = an https media URL the WebView plays itself). Nothing here is used unless a feed sends it.
    function openPlayer(e, s) {
      w.push('Watch', body => {
        const box = h('div', { class: 'card liveo-player', style: { aspectRatio: '16/9', background: '#000', display: 'grid', placeItems: 'center', position: 'relative' } });
        const fail = msg => { box.innerHTML = ''; box.append(h('div', { style: { color: '#fff', padding: '16px', textAlign: 'center', lineHeight: 1.5 }, text: msg })); };
        if (s.kind === 'embed') {
          box.append(h('iframe', { src: s.url, allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', allowfullscreen: '', referrerpolicy: 'origin', style: { width: '100%', height: '100%', border: 0 } }));
        } else {
          const v = h('video', { src: s.url, controls: '', playsinline: '', autoplay: '', style: { width: '100%', height: '100%' } });
          v.onerror = () => fail('This stream can’t play here. Open it with ' + s.name + ' instead.');
          box.append(v);
        }
        body.append(box, h('div', { style: { fontWeight: 600, margin: '4px 6px' }, text: e.title }), h('div', { class: 'sub', style: { color: 'var(--text3)', margin: '2px 6px 12px', fontSize: '13px' }, text: 'Stream from ' + s.name + ' via ' + (e.providerName || 'your Liveo feed') }));
        const open = h('button', { class: 'btn secondary block', text: 'Open on ' + s.name + ' instead' });
        open.onclick = () => Phone.openUrl(s.url);
        body.append(open);
      }, { onPop: () => { const v = w.body.querySelector('video'); if (v) v.pause(); } });
    }

    // ------------------------------------------------------------ settings screen
    function openSettings() {
      w.push('Liveo Settings', function draw(body) {
        const redraw = () => { body.innerHTML = ''; draw(body); };
        const toggleRow = (label, sub, on, fn, cls) => {
          const t = h('div', { class: 'toggle' + (on ? ' on' : '') });
          const r = h('button', { class: 'row ' + (cls || ''), style: { width: '100%', textAlign: 'left', color: 'var(--text)' } }, h('div', { class: 'grow' }, h('div', { text: label }), sub ? h('div', { class: 'sub', text: sub }) : null), t);
          r.onclick = () => { fn(!on); saveCfg(); cache = {}; saveCache(); redraw(); };
          return r;
        };
        body.append(h('div', { class: 'label', text: 'Sports data' }));
        const prov = h('div', { class: 'card' });
        prov.append(toggleRow('TheSportsDB', cfg.tsdbKey ? 'Your own API key' : 'Free public key: a few events per day, slower updates', TSDB.enabled(), v => { cfg.tsdbOn = v; }, 'liveo-tsdb'));
        const keyRow = h('button', { class: 'row liveo-key', style: { width: '100%', textAlign: 'left', color: 'var(--text)' } }, h('div', { class: 'grow' }, h('div', { text: 'TheSportsDB API key' }), h('div', { class: 'sub', text: cfg.tsdbKey ? 'Saved on this phone only (•••• ' + cfg.tsdbKey.slice(-2) + ')' : 'None: using the free key. Add yours for full lists.' })), h('span', { class: 'chev', html: icon('chevron-right') }));
        keyRow.onclick = async () => {
          const v = await Dialog.prompt('TheSportsDB API key', 'Paste the key from your TheSportsDB account (thesportsdb.com). It stays on this phone. Leave empty to use the free key.', cfg.tsdbKey, { placeholder: 'Your key', max: 64 });
          if (v == null) return;
          const k = v.trim();
          if (k && !/^[A-Za-z0-9_-]{1,64}$/.test(k)) { Shell.toast('That doesn’t look like a TheSportsDB key'); return; }
          cfg.tsdbKey = k; saveCfg(); cache = {}; saveCache(); Shell.toast(k ? 'Key saved' : 'Using the free key'); redraw();
        };
        prov.append(keyRow);
        body.append(prov);

        body.append(h('div', { class: 'label', text: 'Liveo feeds (your own servers)' }));
        const feeds = h('div', { class: 'card' });
        (cfg.feeds || []).forEach((f, i) => {
          const r = h('button', { class: 'row', style: { width: '100%', textAlign: 'left', color: 'var(--text)' } }, h('div', { class: 'grow' }, h('div', { text: f.name || new URL(f.url).host }), h('div', { class: 'sub', text: new URL(f.url).host + (f.token ? ' · token saved' : '') + (f.on === false ? ' · off' : '') })), h('span', { class: 'chev', html: icon('chevron-right') }));
          r.onclick = () => Dialog.menu(f.name || 'Feed', f.url, [
            { label: f.on === false ? 'Turn on' : 'Turn off', fn: () => { f.on = f.on === false; saveCfg(); cache = {}; saveCache(); redraw(); } },
            { label: 'Remove feed', danger: true, fn: () => { cfg.feeds.splice(i, 1); saveCfg(); cache = {}; saveCache(); redraw(); } }]);
          feeds.append(r);
        });
        const add = h('button', { class: 'row liveo-addfeed', style: { width: '100%', textAlign: 'left', color: 'var(--accent)' } }, h('div', { class: 'grow', text: 'Add a Liveo feed…' }));
        add.onclick = async () => {
          const url = await Dialog.prompt('Liveo feed address', 'An https address of a server you run that serves Liveo’s feed format (for licensed data or streams you have the rights to).', 'https://', { type: 'url', placeholder: 'https://…' });
          if (url == null) return;
          if (!httpsUrl(url.trim()) || /^https:\/\/$/.test(url.trim())) { Shell.toast('The address must start with https://'); return; }
          const name = await Dialog.prompt('Name', 'What Liveo calls this feed.', new URL(url.trim()).host, { max: 40 });
          if (name == null) return;
          const token = await Dialog.prompt('Access token (optional)', 'If your server needs a token, paste it. It stays on this phone and is only sent to this feed.', '', { max: 200 });
          if (token == null) return;
          cfg.feeds = (cfg.feeds || []).concat([{ url: httpsUrl(url.trim()), name: name.trim().slice(0, 40), token: token.trim(), on: true }]);
          saveCfg(); cache = {}; saveCache(); redraw();
        };
        feeds.append(add);
        body.append(feeds);

        body.append(h('div', { class: 'label', text: 'Competitions Liveo follows' }));
        const comps = h('div', { class: 'card' });
        COMPETITIONS.forEach(c => comps.append(toggleRow(c.name, null, cfg.comps.indexOf(c.id) >= 0, v => { cfg.comps = cfg.comps.filter(x => x !== c.id).concat(v ? [c.id] : []); }, 'liveo-comp-' + c.id)));
        body.append(comps, h('p', { style: { color: 'var(--text3)', fontSize: '12px', margin: '-6px 6px 6px', lineHeight: 1.5 }, text: TSDB.free() ? 'With the free key, each competition you follow adds requests, and TheSportsDB allows only a few a minute. Fewer = faster.' : 'Liveo checks the next 7 days for each competition.' }));
        body.append(h('div', { class: 'label', text: 'Other sports (today)' }));
        const sp = h('div', { class: 'card' });
        OTHER_SPORTS.forEach(s => sp.append(toggleRow(s.name, null, cfg.sports.indexOf(s.id) >= 0, v => { cfg.sports = cfg.sports.filter(x => x !== s.id).concat(v ? [s.id] : []); })));
        body.append(sp);

        body.append(h('div', { class: 'label', text: 'Where you watch' }));
        const reg = h('div', { class: 'card' });
        Object.entries(REGIONS).forEach(([k, l]) => {
          const r = h('button', { class: 'row', style: { width: '100%', textAlign: 'left', color: 'var(--text)' } }, h('div', { class: 'grow', text: l }), k === cfg.region ? h('span', { style: { color: 'var(--accent)' }, html: icon('check') }) : null);
          r.onclick = () => { cfg.region = k; saveCfg(); redraw(); };
          reg.append(r);
        });
        body.append(reg);

        body.append(h('div', { class: 'label', text: 'About' }));
        const ab = h('div', { class: 'card' });
        [['Data: TheSportsDB', 'https://www.thesportsdb.com/'], ['Liveo feed format', 'https://shouldbe.media/liveo']].forEach(([l, u]) => {
          const r = h('button', { class: 'row', style: { width: '100%', textAlign: 'left', color: 'var(--text)' } }, h('div', { class: 'grow', text: l }), h('span', { class: 'chev', html: icon('chevron-right') }));
          r.onclick = () => Phone.openUrl(u);
          ab.append(r);
        });
        const clear = h('button', { class: 'row', style: { width: '100%', textAlign: 'left', color: '#ff453a' } }, h('div', { class: 'grow', text: 'Clear saved results' }));
        clear.onclick = async () => { if (await Dialog.confirm('Clear saved results?', 'Liveo forgets the events it saved for offline use and loads them again.', 'Clear')) { cache = {}; tvCache = {}; saveCache(); Store.setApp(P + 'tv', {}); Shell.toast('Saved results cleared'); } };
        ab.append(clear);
        body.append(ab, h('p', { style: { color: 'var(--text3)', fontSize: '12px', lineHeight: 1.5, margin: '0 6px 10px', textAlign: 'center' }, text: 'Liveo ' + (w.app.version || '') + '. Liveo doesn’t sell anything, has no accounts and never shows unauthorised streams.' }));
      }, { onPop: () => { if (!closed) setTimeout(() => refresh('all'), 0); } });
    }

    // ------------------------------------------------------------ lifecycle: refresh while Liveo is on screen
    const visible = () => !closed && w.el.isConnected && !w.el.classList.contains('hidden') && !document.hidden;
    const tick = () => {
      if (!visible()) return;
      const live = allEvents().some(e => e.status === 'live');
      // live list every minute; everything else when its cache entry is old (the plan decides)
      if (!running && now() - lastRun > (live || tab === 'live' ? MIN : 5 * MIN)) refresh('all');
      else if (!running) paint(); // keep "Updated n min ago" and statuses current
    };
    const online = () => { for (const k in problems) delete problems[k]; Net.blocked = {}; paint(); if (visible()) refresh('all'); };
    const offline = () => paint();
    const vis = () => { if (visible()) tick(); };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', vis);
    timer = setInterval(tick, 20000);
    w.onShow = () => { if (!w.stack.length) paint(); tick(); };
    w.onQuit = () => { closed = true; Net.closed = true; clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', vis); };
    // For Liveo's own tests (tools/liveo_e2e.mjs): read-only views of its state.
    w.liveo = { events: allEvents, cfg, problems, cache: () => cache, refresh, running: () => running, statusOf, tsdbEvent: x => TSDB.event(x), feedEvent: (x, f) => FEED.event(x, f) };

    renderRoot();
    refresh('all');
  }
});
