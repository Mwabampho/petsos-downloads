// Milo for Pets OS for Stephone: the O Store package "milo" (registers store:milo).
// The window is Milo's welcome screen; web pages open in the phone's Milo browser (Android) or a new
// browser tab (iPhone). Uses only what Pets OS 1.0.6 already offers: Apps, h, icon, Store, Phone, Shell, Dialog.
Apps.register({
  id: 'store:milo', name: 'Milo', cat: 'Internet', keywords: 'browser web internet search',
  open(w) {
    const KEY = 'store:milo.recent';
    const SEARCH = 'https://search.brave.com/search?q=';
    const SHORTCUTS = [
      ['Should Be', 'https://shouldbe.media/', '#5b8cff', 'S'],
      ['Wikipedia', 'https://en.m.wikipedia.org/', '#5d6680', 'W'],
      ['BBC News', 'https://www.bbc.co.uk/news', '#c8102e', 'B'],
      ['YouTube', 'https://m.youtube.com/', '#ff3b30', '▶'],
      ['Maps', 'https://www.google.com/maps', '#34a853', 'M'],
      ['Brave Search', 'https://search.brave.com/', '#fb542b', 'B'],
      ['Weather', 'https://www.metoffice.gov.uk/', '#2fb8d8', '☁'],
      ['Pets OS', 'https://shouldbe.media/pets-os', '#8c7bff', 'P']
    ];
    const recent = () => { const r = Store.app(KEY, []); return Array.isArray(r) ? r : []; };
    // Addresses go straight to the site; anything else is searched with Brave.
    const toUrl = text => {
      const t = String(text || '').trim();
      if (!t) return null;
      if (/^https?:\/\//i.test(t)) return t;
      if (t.indexOf(' ') < 0 && /\.[a-z]{2,}(\/|$)/i.test(t)) return 'https://' + t;
      return SEARCH + encodeURIComponent(t);
    };
    const visit = (url, label) => {
      if (!url) return;
      const list = recent().filter(x => x.url !== url);
      list.unshift({ url, label: label || url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), at: Date.now() });
      Store.setApp(KEY, list.slice(0, 8));
      Phone.openUrl(url);
      setTimeout(() => w.refresh(), 300);
    };

    w.root(body => {
      w.actions(recent().length ? [{ label: 'Clear', fn: async () => {
        if (await Dialog.confirm('Clear recent sites?', 'The list of sites you opened from Milo is removed.', 'Clear')) { Store.setApp(KEY, []); w.refresh(); }
      } }] : []);
      const logo = h('div', { style: { width: '84px', height: '84px', borderRadius: '21px', margin: '6px auto 0', background: 'url(' + (w.app.img || '') + ') center/cover', boxShadow: '0 10px 30px rgba(0,0,0,.3)' } });
      body.append(logo,
        h('div', { style: { textAlign: 'center', fontSize: '28px', fontWeight: 600, marginTop: '12px' }, text: 'Welcome to Milo' }),
        h('div', { style: { textAlign: 'center', color: 'var(--text2)', margin: '4px 12px 18px', lineHeight: 1.45 }, text: 'The Pets OS browser. Search the web or go straight to a site.' }));

      const field = h('input', { type: 'search', placeholder: 'Search or type a web address', 'aria-label': 'Search or type a web address', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'go',
        style: { flex: 1, minWidth: 0, height: '48px', borderRadius: '24px', border: '0', background: 'var(--card)', color: 'var(--text)', padding: '0 18px', font: 'inherit', outline: 'none' } });
      const goBtn = h('button', { class: 'btn', text: 'Go', style: { height: '48px', borderRadius: '24px', flex: 'none' } });
      const go = () => { const u = toUrl(field.value); if (!u) { field.focus(); return; } field.blur(); visit(u); field.value = ''; };
      goBtn.onclick = go;
      field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      body.append(h('div', { style: { display: 'flex', gap: '8px', marginBottom: '6px' } }, field, goBtn));

      body.append(h('div', { class: 'label', text: 'Shortcuts' }));
      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', marginBottom: '8px' } });
      SHORTCUTS.forEach(([name, url, colour, letter]) => {
        const b = h('button', { 'aria-label': name, style: { background: 'var(--card)', borderRadius: '16px', padding: '12px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text)' } },
          h('div', { style: { width: '40px', height: '40px', borderRadius: '12px', background: colour, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: '18px' }, text: letter }),
          h('span', { text: name }));
        b.onclick = () => visit(url, name);
        grid.append(b);
      });
      body.append(grid);

      const list = recent();
      if (list.length) {
        body.append(h('div', { class: 'label', text: 'Recent' }));
        const card = h('div', { class: 'card' });
        list.forEach(r => {
          const row = h('button', { class: 'row', style: { width: '100%', textAlign: 'left', color: 'var(--text)' } },
            h('div', { class: 'grow', style: { overflow: 'hidden' } },
              h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: r.label }),
              h('div', { class: 'sub', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: r.url })),
            h('span', { class: 'chev', html: icon('chevron-right') }));
          row.onclick = () => visit(r.url, r.label);
          card.append(row);
        });
        body.append(card);
      }
      body.append(h('p', { style: { color: 'var(--text3)', fontSize: '13px', lineHeight: 1.5, margin: '10px 6px', textAlign: 'center' },
        text: isWeb ? 'Sites open in a new browser tab.' : 'Sites open in Milo’s browser. Use × at its top left to come back here.' }));
    });
  }
});
