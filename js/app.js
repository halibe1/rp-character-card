/*
 * app.js — интерфейс: хранилище персонажей, форма, режимы, рендер, тултипы, калькуляторы.
 * Математика — в engine.js (RPEngine).
 * Персонажи хранятся в браузере (IndexedDB, запасной вариант — localStorage).
 * При первом запуске загружаются стартовые персонажи из data/characters.js.
 */
(function () {
  'use strict';

  var DATA = window.RP_DATA || {};
  var RULES = DATA.rules;
  var SEED = DATA.characters || [];
  var E = window.RPEngine;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ================= форматирование ================= */

  function fmt(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    d = d === undefined ? 1 : d;
    var p = Math.pow(10, d), x = Math.round(v * p) / p, neg = x < 0;
    x = Math.abs(x);
    var parts = x.toFixed(d).split('.');
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    var dec = parts[1] && /[1-9]/.test(parts[1]) ? ',' + parts[1].replace(/0+$/, '') : '';
    return (neg ? '−' : '') + int + dec;
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function tipAttr(title, formula, extra) {
    var h = '';
    if (title) h += '<div class="tt-title">' + esc(title) + '</div>';
    if (extra) h += '<div>' + extra + '</div>';
    if (formula) h += '<div class="tt-f">' + esc(formula) + '</div>';
    return ' data-tip="' + esc(h) + '"';
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* названия параметров для подписей бонусов; заполняется в start() */
  var STAT_LABEL = { all: 'Все физические' };
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /**
   * Цепочка расчёта для тултипа:
   * база → внутр. бафы → внутр. дебафы → внешн. бафы → внешн. дебафы → результат.
   */
  function chainHtml(cn, unit, dec, compact) {
    dec = dec === undefined ? 1 : dec;
    var u = unit ? ' ' + esc(unit) : '';
    var h = '<div class="chain' + (compact ? ' compact' : '') + '"><div class="cr base"><span>База</span><b>' + fmt(cn.base, dec) + u + '</b></div>';
    cn.steps.forEach(function (s) {
      var names = s.groups.map(function (g) {
        var src = RULES.buffSources[g.source || ''];
        return (g.source ? esc(src.label) + ' ×' + fmt(g.factor, 2) + ': ' : '') + g.items.map(function (b) { return esc(b.label || STAT_LABEL[b.stat] || '') + ' ' + (b.powerFactor ? fmt(b.baseMagnitude, 1) + '% × ' + fmt(b.powerFactor, 2) + ' (' + (b.source === 'style' ? 'сила БИ' : 'сила атрибута') + ') = ' : '') + fmt(b.magnitude, 1) + '%'; }).join(', ');
      }).join('; ');
      h += '<div class="cr' + (s.factor === 1 ? ' nil' : '') + (s.layer === 'external' ? ' ext' : '') + '"><span>→ ' + esc(cap(s.label)) + '</span><b>' + s.op + ' ' + fmt(s.factor, 3) + '</b>' +
        '<i>' + (s.factor === 1 ? '—' : fmt(s.after, dec) + u) + '</i>' + (names ? '<em>' + names + '</em>' : '') + '</div>';
    });
    return h + '<div class="cr res"><span>= Результат</span><b>' + fmt(cn.value, dec) + u + '</b></div></div>';
  }
  /** Короткие метки ненулевых звеньев цепочки: «внутр. баф ×1.4». */
  function chainTags(cn) {
    var out = [];
    cn.steps.forEach(function (s) {
      s.groups.forEach(function (g) {
        if (g.factor === 1) return;
        var src = RULES.buffSources[g.source || ''], lim = s.layer === 'external' || (src && src.affectsLimit);
        out.push('<span class="tag' + (lim ? ' lim' : '') + '">' + esc(g.source ? src.label : (g.items[0].label || src.label)) + (s.kind === 'debuff' ? ' дебафф' : '') + ' ' + s.op + fmt(g.factor, 2) + '</span>');
      });
    });
    return out.join('');
  }

  /* ================= иконки ================= */

  var ICON = {
    punch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 10V7a2 2 0 0 1 4 0v3M10 9V6a2 2 0 0 1 4 0v4M14 9.5V7a2 2 0 0 1 4 0v6c0 4-2.5 7-6.5 7S5 17.5 5 14v-3a1.5 1.5 0 0 1 3 0"/><path d="M9 14h4"/></svg>',
    lift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 12h20M5 8v8M8 6v12M16 6v12M19 8v8"/></svg>',
    speed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    reaction: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3.2"/></svg>',
    stamina: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.3-9.6C1.5 7.8 4 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.7 1.1-1.6 2.7-2.7 4.7-2.7 3.3 0 5.8 3.3 4.6 6.9C19.5 16.4 12 21 12 21z"/><path d="M6 12h3l1.5-2.5 2 5L14 12h4"/></svg>',
    hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M5 11V8a2 2 0 0 1 4 0v2M9 9V7a2 2 0 0 1 4 0v3M13 9a2 2 0 0 1 4 0v4c0 4-2.5 7-6 7s-6-3-6-6.5v-1.5"/></svg>',
    kick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8 3v8l-3 8h4l3-6 8 2v-4l-7-3V3z"/></svg>',
    pierce: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 21 14 10M14 10l7-7-2 6-5 1z"/><path d="M6 15l3 3"/></svg>',
    slashPalm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 18 18 4"/><path d="M7 20 20 7" opacity=".55"/><path d="M3 13 13 3" opacity=".3"/></svg>',
    slashBlade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M20 3 8 15l2 2L21 6z"/><path d="M8 15l-4 4 1.5 1.5 4-4"/><path d="M3 9q6-1 9-6" opacity=".5"/></svg>'
  };

  /* ================= хранилище ================= */

  var LocalStore = (function () {
    var LS = 'rp-card-characters';
    var mem = null, mode = 'idb', dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        // некоторые браузеры на file:// «подвисают» на indexedDB.open — не ждём дольше 2 с
        setTimeout(function () { rej(new Error('IndexedDB timeout')); }, 2000);
        try {
          var rq = indexedDB.open('rp-card', 1);
          rq.onupgradeneeded = function () { rq.result.createObjectStore('characters', { keyPath: 'id' }); };
          rq.onsuccess = function () { res(rq.result); };
          rq.onerror = function () { rej(rq.error); };
        } catch (e) { rej(e); }
      });
      return dbp;
    }
    function tx(kind, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          setTimeout(function () { rej(new Error('IndexedDB timeout')); }, 2500);
          var t = db.transaction('characters', kind), rq = fn(t.objectStore('characters'));
          t.oncomplete = function () { res(rq ? rq.result : undefined); };
          t.onerror = function () { rej(t.error); };
          t.onabort = function () { rej(t.error); };
        });
      });
    }
    function lsRead() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return mem || []; } }
    function lsWrite(list) {
      mem = list;
      try { localStorage.setItem(LS, JSON.stringify(list)); }
      catch (e) { throw new Error('в браузере закончилось место (арты занимают много). Сделай экспорт и удали лишних персонажей'); }
    }
    function fallback(e) { console.warn('IndexedDB недоступен, используем localStorage', e); mode = 'ls'; }
    return {
      all: function () {
        if (mode === 'ls') return Promise.resolve(lsRead());
        return tx('readonly', function (s) { return s.getAll(); }).catch(function (e) { fallback(e); return lsRead(); });
      },
      put: function (ch) {
        if (mode === 'ls') {
          var l = lsRead().filter(function (c) { return c.id !== ch.id; }); l.push(ch);
          try { lsWrite(l); } catch (e) { return Promise.reject(e); }
          return Promise.resolve();
        }
        return tx('readwrite', function (s) { return s.put(ch); }).catch(function (e) { fallback(e); return LocalStore.put(ch); });
      },
      remove: function (id) {
        if (mode === 'ls') { try { lsWrite(lsRead().filter(function (c) { return c.id !== id; })); } catch (e) { /* удаление только уменьшает объём */ } return Promise.resolve(); }
        return tx('readwrite', function (s) { return s.delete(id); }).catch(function (e) { fallback(e); return LocalStore.remove(id); });
      }
    };
  })();

  /* Общий сервер (Supabase) включается через data/config.js; без него — хранилище в браузере. */
  var Remote = window.RPRemote && window.RPRemote.enabled ? window.RPRemote : null;
  var Store = Remote ? { all: Remote.all, put: Remote.put, remove: Remote.remove } : LocalStore;

  /** Может ли текущий посетитель менять этого персонажа. */
  function canEdit(c) {
    if (!Remote) return true;
    var u = Remote.user();
    if (!u || !c) return false;
    return Remote.isAdmin() || c.ownerId === u.id;
  }
  /** Показ демо-персонажей, когда на сервере пусто или он недоступен (на сервер не пишется). */
  function demoList() { return SEED.map(function (c, i) { return Object.assign(normalize(clone(c)), { createdAt: i }); }); }

  /* ================= модель персонажа ================= */

  function blankCharacter() {
    return {
      id: '', name: '',
      attribute: { name: '', description: '', entryCost: null, upkeepCost: null, upkeepIntervalMin: null },
      art: null,
      stats: { punch: 1000, lift: 200, speed: 10, reaction: 250, stamina: 100 },
      weightKg: 70, awakenings: 0, ap: 0, sp: 0,
      styles: [], traits: [], buffs: [], abilities: []
    };
  }
  /** Приводит персонажа к полному формату (старые/импортированные данные). */
  function normalize(c) {
    var b = blankCharacter();
    c = Object.assign(b, c || {});
    c.attribute = Object.assign(blankCharacter().attribute, c.attribute || {});
    c.stats = Object.assign(blankCharacter().stats, c.stats || {});
    ['styles', 'traits', 'buffs'].forEach(function (k) { if (!Array.isArray(c[k])) c[k] = []; });
    c.traits = c.traits.slice(0, RULES.maxTraits);
    c.buffs = c.buffs.map(upgradeBuff);
    c.abilities = (Array.isArray(c.abilities) ? c.abilities : []).filter(function (a) { return a && typeof a === 'object'; }).slice(0, RULES.abilities.max).map(normAbility);
    // арт — только картинка из браузера или https-ссылка (данные других игроков не доверенные)
    if (typeof c.art !== 'string' || !/^(data:image\/|https:\/\/)/.test(c.art)) c.art = null;
    return c;
  }
  /**
   * Старый бафф -> новый формат. Нет layer — внутренний; нет type — по знаку процента
   * (дальше процент хранится положительным); нет scope — «все аспекты»; нет enabled — включён.
   */
  function upgradeBuff(b) {
    var p = parseFloat(b.percent);
    var type = b.type === 'debuff' || b.type === 'buff' ? b.type : (p < 0 ? 'debuff' : 'buff');
    return Object.assign({}, b, { type: type, percent: isFinite(p) ? Math.abs(p) : b.percent, layer: b.layer === 'external' ? 'external' : 'internal', scope: b.scope || 'all', enabled: b.enabled !== false });
  }
  /** Способность атрибута в полном формате (данные могут быть чужими: приводим типы). */
  function normAbility(a) {
    return { id: String(a.id || makeBuffId()), name: String(a.name || ''), description: String(a.description || ''), upkeepNote: String(a.upkeepNote || ''),
      parentId: String(a.parentId || ''), fixedCost: a.fixedCost === true, alloc: normAlloc(a.alloc), pros: normList(a.pros), cons: normList(a.cons), ap: a.ap === undefined || a.ap === '' ? 0 : a.ap,
      entryCost: a.entryCost === undefined ? null : a.entryCost, upkeepCost: a.upkeepCost === undefined ? null : a.upkeepCost,
      images: (Array.isArray(a.images) ? a.images : []).filter(function (u) { return typeof u === 'string' && /^(data:image\/|https:\/\/)/.test(u); }).slice(0, RULES.abilities.maxImages || 6) };
  }  var ALLOC_KEYS = ['punch', 'speed', 'durability', 'radius', 'other'];
  var ALLOC_LABEL = { punch: 'Сила удара', speed: 'Скорость', durability: 'Прочность', radius: 'Радиус / дальность', other: 'Прочие числа' };
  function normList(v) { return (Array.isArray(v) ? v : []).map(function (x) { return String(x == null ? '' : x); }); }
  function normAlloc(al) {
    var o = {}; ALLOC_KEYS.forEach(function (k) { var v = al ? parseFloat(al[k]) : 0; o[k] = isFinite(v) && v > 0 ? v : 0; }); return o;
  }
  function makeBuffId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function makeId(name) {
    var base = String(name || 'char').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') || 'char';
    return base + '-' + Math.random().toString(36).slice(2, 7);
  }

  /* ================= состояние ================= */

  var chars = [];
  var ch = null;
  var view = { mode: 'base', wounds: [], testBuff: 0, testSource: 'external' };
  var R = null;
  var figure = null;
  var prevVals = {};

  function viewKey() { return 'rp-view:' + ch.id; }
  function saveView() { try { localStorage.setItem(viewKey(), JSON.stringify({ mode: view.mode, wounds: view.wounds })); } catch (e) { /* ок */ } }
  function loadView() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(viewKey()) || 'null'); } catch (e) { s = null; }
    view.mode = (s && RULES.modes[s.mode]) ? s.mode : 'base';
    view.wounds = (s && s.wounds) || [];
    view.testBuff = 0;
  }
  function compute(mode) {
    return E.compute(ch, RULES, { mode: mode || view.mode, wounds: view.wounds, testBuff: view.testBuff ? { percent: view.testBuff, source: view.testSource } : null });
  }

  /* ================= анимация чисел ================= */

  function tweenNumber(el, key, to, d) {
    var from = prevVals[key];
    prevVals[key] = to;
    if (from === undefined || reduceMotion || from === to || !isFinite(from) || !isFinite(to)) { el.textContent = fmt(to, d); return; }
    var t0 = performance.now(), dur = 750, id = (el._tw || 0) + 1; el._tw = id;
    (function step(now) {
      if (el._tw !== id) return;
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e, d);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ================= верх ================= */

  function primaryStyle() { return (ch.styles || []).filter(function (s) { return s && s.name; })[0] || null; }

  function renderHeader() {
    $('#charName').textContent = ch.name || 'Без имени';
    $('#emblem').innerHTML = ch.art ? '<img src="' + esc(ch.art) + '" alt="">' : '<span>' + esc((ch.name || '?')[0].toUpperCase()) + '</span>';
    var b = '';
    if (ch.attribute && ch.attribute.name) {
      b += '<span class="badge" id="attrBadge"' + tipAttr('Атрибут · ' + ch.attribute.name, null, ch.attribute.description ? esc(ch.attribute.description) : 'Описание не указано') + '><span class="ico">◈</span><span>Атрибут · <b>' + esc(ch.attribute.name) + '</b><span class="pw" id="attrPw"></span></span></span>';
    }
    if (ch.ownerName) b += '<span class="badge"><span class="ico">☺</span><span>Игрок · <b>' + esc(ch.ownerName) + '</b></span></span>';
    var ps = primaryStyle();
    if (ps) b += '<span class="badge" id="artBadge"><span class="ico">⟋</span><span><b>' + esc(ps.name) + '</b> · <span id="maLevelBadge"></span><span class="pw" id="artPw"></span></span></span>';
    $('#topBadges').innerHTML = b;
    $('#stagePlate').innerHTML = ch.attribute && ch.attribute.name ? '<span class="dot"></span>Атрибут · ' + esc(ch.attribute.name) + '<span class="dot"></span>' : '<span class="dot"></span>' + esc(ch.name) + '<span class="dot"></span>';
    document.title = (ch.name || 'Персонаж') + ' · Карточка персонажа';
    $('#charSelect').innerHTML = chars.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === ch.id ? ' selected' : '') + '>' + esc(c.name || 'Без имени') + '</option>'; }).join('');
  }

  function renderTopProgress() {
    var mp = R.derived.progress.martial, ap = R.derived.progress.ap;
    var lb = $('#maLevelBadge'); if (lb) lb.textContent = mp.level.label;
    $('#topProgress').innerHTML =
      '<div class="pbar-row"' + tipAttr('SP · боевые стили', mp.next ? mp.sp + ' / ' + mp.next.sp + ' SP до уровня «' + mp.next.label + '»' : 'Максимальный уровень', 'Уровень: <b>' + esc(mp.level.label) + '</b>') + '>' +
      '<span class="k">SP</span><span class="pbar' + (mp.progress === 0 ? ' empty' : '') + '"><i style="width:' + (mp.progress * 100) + '%"></i></span><span class="v">' + fmt(mp.sp, 0) + (mp.next ? ' / ' + mp.next.sp : '') + '</span></div>' +
      '<div class="pbar-row"' + tipAttr('AP · атрибут', 'до следующего улучшения: ' + ap.toNextUpgrade + ' AP; до олицетворения: ' + Math.max(0, ap.personification - ap.ap) + ' AP', 'Каждые 100 AP — улучшение способности или один приём.') + '>' +
      '<span class="k">AP</span><span class="pbar' + (ap.ap === 0 ? ' empty' : '') + '"><i style="width:' + (ap.personificationProgress * 100) + '%"></i></span><span class="v">' + fmt(ap.ap, 0) + ' / ' + ap.personification + '</span></div>';
  }

  /* ================= левая панель ================= */

  var STAT_ORDER = ['punch', 'lift', 'speed', 'reaction', 'stamina'];

  function buildStats() {
    $('#statList').innerHTML = STAT_ORDER.map(function (k) {
      var s = RULES.stats[k];
      return '<div class="stat" id="st-' + k + '">' +
        '<div class="stat-top"><span class="stat-label"><span class="stat-ico">' + ICON[k] + '</span>' + esc(s.label) + '</span><span class="stat-delta" data-delta></span></div>' +
        '<div class="stat-top"><span class="stat-val" data-valwrap><span data-val>0</span><small>' + esc(s.unit) + '</small></span></div>' +
        '<div class="stat-bar"><span class="ghost" data-ghost></span><span class="fill" data-fill></span></div>' +
        '<div class="stat-note" data-note></div></div>';
    }).join('');
  }
  function barFrac(k, v) {
    var s = RULES.stats[k];
    if (s.betterLower) return Math.max(0.02, Math.min(1, (s.barWorst - v) / (s.barWorst - s.barBest)));
    return Math.max(0.02, Math.min(1, v / s.barMax));
  }

  function renderStats() {
    STAT_ORDER.forEach(function (k) {
      var st = R.stats[k], row = $('#st-' + k), def = RULES.stats[k];
      tweenNumber($('[data-val]', row), 'st-' + k, st.value, 1);
      $('[data-fill]', row).style.width = (barFrac(k, st.value) * 100) + '%';
      $('[data-ghost]', row).style.width = (barFrac(k, st.base) * 100) + '%';
      var delta = st.value - st.base, better = def.betterLower ? delta < 0 : delta > 0;
      var dEl = $('[data-delta]', row);
      if (Math.abs(delta) > 1e-6) {
        dEl.textContent = (delta > 0 ? '+' : '−') + fmt(Math.abs(delta), 1) + ' ' + def.unit;
        dEl.className = 'stat-delta show' + (better ? '' : ' neg');
      } else dEl.className = 'stat-delta';
      row.classList.toggle('wounded', st.woundDivisor !== 1);

      var notes = [chainTags(st.chain)];
      if (st.woundDivisor !== 1) notes.push('<span class="tag hot">ранения ÷' + fmt(st.woundDivisor, 2) + '</span>');
      if (st.lightWounds) notes.push('<span class="tag hot">лёгкие ×' + st.lightWounds + '</span>');
      if (k === 'stamina' && R.derived.stamina) notes.push('<span class="tag">атрибут: вход −' + fmt(R.derived.stamina.entry, 2) + '%' + (R.derived.stamina.hasUpkeep ? ' · −' + fmt(R.derived.stamina.upkeep, 2) + '% / ' + R.derived.stamina.interval + ' мин' : '') + '</span>');
      $('[data-note]', row).innerHTML = notes.join('');

      var extra = 'Режим «' + esc(R.modeLabel) + '»' + chainHtml(st.chain, def.unit) +
        (st.woundDivisor !== 1 ? '<div>Ранения: ' + (def.betterLower ? '×' : '÷') + fmt(st.woundDivisor, 3) + ' → <b>' + fmt(st.value) + ' ' + def.unit + '</b></div>' : '') +
        (def.betterLower ? '<div style="color:var(--text-3)">Меньше = лучше: бафы делят миллисекунды, дебаффы умножают.</div>' : '') +
        (k === 'speed' ? '<div>' + fmt(st.value) + ' км/ч = <b>' + fmt(E.kmhToMs(st.value), 2) + ' м/с</b></div>' : '');
      $('[data-valwrap]', row).setAttribute('data-tip', '<div class="tt-title">' + esc(def.label) + '</div><div>' + extra + '</div><div class="tt-f">' + esc(st.formula) + '</div>');
    });
    $('#modeHint').textContent = { base: 'без бафов', passive: 'постоянные бафы', active: 'всё, что включается в бою' }[view.mode];
  }

  function renderModeSwitch() {
    var i = ['base', 'passive', 'active'].indexOf(view.mode);
    $$('#modeSwitch button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.mode === view.mode ? 'true' : 'false'); });
    $('#modeSwitch .mode-glider').style.transform = 'translateX(' + (i * 100) + '%)';
  }

  function degreeById(id) { return RULES.wounds.degrees.filter(function (d) { return d.id === id; })[0]; }
  function buildWoundControls() {
    $('#woundDegree').innerHTML = RULES.wounds.degrees.map(function (d) { return '<option value="' + d.id + '">' + esc(d.label) + '</option>'; }).join('');
    $('#woundStat').innerHTML = E.PHYS.map(function (s) { return '<option value="' + s + '">' + esc(RULES.stats[s].label) + '</option>'; }).join('');
  }
  function renderWounds() {
    var list = $('#woundList');
    if (!view.wounds.length) { list.innerHTML = '<div class="empty-note">Ранений нет. Отметь ранение — статы пересчитаются.</div>'; return; }
    list.innerHTML = view.wounds.map(function (w, i) {
      var d = degreeById(w.degree);
      var eff = d.all ? '÷' + d.divisor + ' на все' : d.divisor === 1 ? 'без дебаффа' : '÷' + d.divisor + (d.accumulationCap > d.divisor ? ' (накопл. до ÷' + d.accumulationCap + ')' : '');
      return '<label class="wound' + (w.enabled === false ? ' off' : '') + '"' + tipAttr(d.label, null, esc(d.desc)) + '>' +
        '<input type="checkbox" data-wi="' + i + '"' + (w.enabled === false ? '' : ' checked') + '>' +
        '<span><span class="deg">' + esc(d.label) + '</span> · ' + (d.all ? 'все характеристики' : esc(RULES.stats[w.stat].label)) + ' <span style="color:var(--text-3)">' + eff + '</span></span>' +
        '<button class="x" data-wx="' + i + '" aria-label="Убрать">✕</button></label>';
    }).join('');
  }

  /* ================= правая панель ================= */

  function renderLimit() {
    var L = R.derived.limit, max = L.thresholds[2].at + 1, w = L.worst;
    var z = L.thresholds.map(function (t) { return (t.at / max * 100) + '%'; });
    $('#limitCard').innerHTML =
      '<div class="limit-top"><span class="limit-title">Нагрузка на предел</span>' +
      '<span class="limit-zone" data-level="' + w.zone.level + '"' + tipAttr(w.zone.label, L.formula, esc(w.zone.effect) + '<br>Сильнее всего нагружено: <b>' + esc(RULES.stats[w.stat].label) + '</b> ×' + fmt(w.ratio, 2)) + '>' + esc(w.zone.label) + ' · ×' + fmt(w.ratio, 2) + '</span></div>' +
      '<div class="gauge" style="--z1:' + z[0] + ';--z2:' + z[1] + ';--z3:' + z[2] + '"><div class="gauge-track"></div><div class="gauge-needle" style="left:' + Math.min(100, w.ratio / max * 100) + '%"></div></div>' +
      '<div class="gauge-ticks"><span style="left:' + (1 / max * 100) + '%">×1</span>' + L.thresholds.map(function (t) { return '<span style="left:' + (t.at / max * 100) + '%">×' + t.at + (t.level === 3 ? ' ☠' : '') + '</span>'; }).join('') + '</div>' +
      '<div class="limit-stats">' + E.PHYS.map(function (s) {
        var p = L.perStat[s];
        return '<div' + tipAttr(RULES.stats[s].label, 'текущее ' + fmt(p.current, 1) + ' / естеств. максимум ' + fmt(p.natural, 1) + ' = ×' + fmt(p.ratio, 2), esc(p.zone.label) + (p.harmless ? '<br>Реакция не вредит телу при превышении.' : '')) + '>' + esc(RULES.stats[s].short) + '<b>×' + fmt(p.ratio, 2) + '</b></div>';
      }).join('') + '</div>' +
      (L.reactionWarning ? '<div class="limit-warn">⚠ ' + esc(L.reactionWarning) + '</div>' : '') +
      '<div class="test-buff"><label for="testBuff">Тест: внешний бафф на все физ. статы</label><output>+' + view.testBuff + '%</output>' +
      '<div class="row2"><input type="range" id="testBuff" min="0" max="500" step="10" value="' + view.testBuff + '" aria-label="Тестовый бафф, %">' +
      '<select id="testSource" aria-label="Источник"><option value="external"' + (view.testSource === 'external' ? ' selected' : '') + '>внешний</option><option value="artifact"' + (view.testSource === 'artifact' ? ' selected' : '') + '>артефакт</option></select></div></div>';
  }
  function updateLimitInPlace() {
    var L = R.derived.limit, w = L.worst, max = L.thresholds[2].at + 1;
    var zone = $('#limitCard .limit-zone');
    zone.dataset.level = w.zone.level;
    zone.textContent = w.zone.label + ' · ×' + fmt(w.ratio, 2);
    $('#limitCard .gauge-needle').style.left = Math.min(100, w.ratio / max * 100) + '%';
    $('#limitCard .test-buff output').textContent = '+' + view.testBuff + '%';
    $$('#limitCard .limit-stats b').forEach(function (b, i) { b.textContent = '×' + fmt(L.perStat[E.PHYS[i]].ratio, 2); });
  }

  function dcell(label, value, unit, sub, title, formula, extra, cls) {
    return '<div class="dcell' + (cls ? ' ' + cls : '') + '"' + tipAttr(title || label, formula, extra) + '><div class="dl">' + esc(label) + '</div><div class="dv">' + value + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div>' + (sub ? '<div class="ds">' + sub + '</div>' : '') + '</div>';
  }

  /** Подробности по аспектам (радиус / мощность / скорость) для силы атрибута и боевого искусства. */
  function powerAspects(m) {
    return ['radius', 'power', 'speed'].map(function (sc) { return RULES.scopes[sc].label.toLowerCase() + ' ' + fmt(m.scopes[sc].value, 0) + '%'; }).join(' · ');
  }
  function powerTipHtml(m) {
    var def = RULES.modifiers[m.key];
    return '<div>' + esc(def.desc) + '</div>' + Object.keys(RULES.scopes).map(function (sc) {
      return '<div class="tt-sub">' + esc(RULES.scopes[sc].label) + (sc === 'all' ? ' <small>(только бонусы «все аспекты»)</small>' : '') + '</div>' + chainHtml(m.scopes[sc], '%', 1, sc !== 'all');
    }).join('');
  }
  function powerCell(m, title) {
    return dcell(m.label, fmt(m.value, 1), '%', powerAspects(m), title, m.scopes.all.formula + ' %', powerTipHtml(m));
  }
  function durMultCell(d) {
    var c = d.durability.chain;
    return dcell('Множитель прочности', '×' + fmt(c.factor, 2), '', 'база ' + fmt(c.base, 0) + ' → ' + fmt(c.value, 0) + ' кг', 'Множитель прочности', c.formula + ' кг', RULES.modifiers.durability.desc + chainHtml(c, 'кг', 0));
  }

  function renderDerived() {
    var d = R.derived, mt = d.meleeTiming, sm = d.stamina;
    var cells = [
      dcell('Прочность', fmt(d.durability.value, 0), 'кг', 'сила удара × 3', 'Прочность', d.durability.formula, 'Минимум без индивидуального дебаффа: ' + RULES.durability.minimum + ' кг (до множителя прочности).' + chainHtml(d.durability.chain, 'кг', 0)),
      dcell('Взрывная сила', fmt(d.explosive.value, 0), 'кг', 'за ' + fmt(d.explosive.timeMs) + ' мс', 'Взрывная сила', d.explosive.formula + '; ' + d.explosive.timeFormula, 'Подъём × 2. Достигается за ½ реакции, но не дольше 100 мс.'),
      dcell('Скорость', fmt(d.speed.kmh), 'км/ч', fmt(d.speed.ms, 2) + ' м/с', 'Скорость', d.speed.formula, 'Разгон: ' + esc(d.accel.formula)),
      dcell('Скорость атаки', fmt(d.attackSpeed.kmh), 'км/ч', fmt(d.attackSpeed.ms, 2) + ' м/с', 'Скорость атаки', d.attackSpeed.formula, 'Скорость × 1.5'),
      dcell('Давление (ладонь)', fmt(d.pressure.value, 2), 'кг/см²', 'потолок ' + fmt(d.pressure.cap) + ' кг/см²', 'Давление', d.pressure.formula, 'Подъём ÷ площадь (ладонь ' + RULES.lift.palmAreaCm2 + ' см²). Максимум ×4 от подъёма.'),
      dcell('Подъём ногами', fmt(d.liftLegs.value, 0), 'кг', 'без конечности: ' + fmt(d.liftOneLimb.value, 0) + ' кг', 'Подъём', d.liftLegs.formula + '; ' + d.liftOneLimb.formula),
      dcell('Разгон', fmt(d.accel.effectiveStart), 'км/ч', d.accel.instantMax ? 'сразу максимум · ' + d.accel.distanceM + ' м' : 'старт · ' + d.accel.distanceM + ' м до макс.', 'Стартовая скорость разгона', d.accel.formula),
      dcell('Своя атака вблизи', fmt(mt.attackTimeMs, 0), 'мс', 'свободно ' + fmt(mt.freeMs, 0) + ' мс', 'Время атаки на 2 м', mt.formula, 'Ближний бой (≤ 2 м) считается на 2 м. Каст способности = реакция (' + fmt(R.stats.reaction.value) + ' мс).'),
      sm ? (sm.hasUpkeep
        ? dcell('Атрибут: запас', sm.minutesToCritical + '–' + sm.minutesTo0, 'мин', 'до 10% / до 0%', 'Сколько продержит способность', sm.formulaC + ' · ' + sm.formula0, 'Вход ' + esc(sm.formulaEntry) + ', поддержание −' + fmt(sm.upkeep, 2) + '% каждые ' + sm.interval + ' мин. На 10% персонаж теряет сознание.', 'wide')
        : '') : '',
      dcell('Бег по воде', d.water.available ? 'доступен' : 'недоступен', '', d.water.available ? '' : 'не хватает ' + fmt(d.water.deficitMs, 2) + ' м/с (' + fmt(d.water.deficitKmh, 0) + ' км/ч)', 'Бег по воде', d.water.formula, 'От 40 м/с; при массе > 100 кг — 50 м/с и +50 м/с за каждые следующие 100 кг.', 'wide' + (d.water.available ? '' : ' locked'))
    ];
    $('#derivedGrid').innerHTML = cells.join('');
  }

  function renderStrikes() {
    var list = R.derived.strikes.slice().sort(function (a, b) { return (b.primary ? 1 : 0) - (a.primary ? 1 : 0); });
    $('#strikeList').innerHTML = list.map(function (s) {
      return '<div class="strike' + (s.primary ? ' primary' : '') + '"' + tipAttr(s.label + (s.primary ? ' · основной' : ''), s.formula, s.style ? 'Стиль: ' + esc(s.style) : '') + '>' +
        ICON[s.key] + '<span class="sn">' + esc(s.label) + (s.primary && s.style ? '<span class="main-tag">' + esc(s.style.split(':')[0].slice(0, 14)) + '</span>' : '') + '<small>×' + s.multiplier + '</small></span>' +
        '<span class="sv">' + fmt(s.value, 0) + ' <small style="font-size:11px;color:var(--text-3)">кг</small></span></div>';
    }).join('');
  }

  /* ================= низ ================= */

  function renderBottom() {
    var mp = R.derived.progress.martial;
    var styles = (ch.styles || []).filter(function (s) { return s.name; });
    $('#styleChips').innerHTML = styles.length ? styles.map(function (s, i) {
      var st = s.strikeType && RULES.strike.types[s.strikeType];
      var ap = R.derived.mods.artPower;
      return '<span class="chip' + (i === 0 ? ' art' : '') + '"' + tipAttr(s.name, null, 'Уровень: ' + esc(mp.level.label) + ' (' + fmt(mp.sp, 0) + ' SP)' + (st ? '<br>Основной удар: ' + esc(st.label.toLowerCase()) + ' ×' + st.multiplier : '') +
        '<br>' + esc(ap.label) + ': <b>' + fmt(ap.value, 1) + '%</b> (' + powerAspects(ap) + ')' + powerTipHtml(ap)) + '>' +
        (st ? '<span class="chip-ico">' + ICON[s.strikeType] + '</span>' : '') + '<b>' + esc(s.name) + '</b><span class="ct">' + esc(mp.level.label) + '</span></span>';
    }).join('') : '<span class="empty-note">Стилей нет — добавь в форме персонажа.</span>';
    var traits = (ch.traits || []).filter(function (t) { return t.name; });
    $('#traitChips').innerHTML = traits.length ? traits.map(function (t) {
      return '<span class="chip"' + tipAttr(t.name, null, t.description ? esc(t.description) : '<span style="color:var(--text-3)">Описание не указано</span>') + '>' + esc(t.name) + '</span>';
    }).join('') : '<span class="empty-note">Трейтов нет.</span>';
    $('#traitCount').textContent = traits.length + ' / ' + RULES.maxTraits;
  }

  /** Сила атрибута / боевого искусства на бейджах в шапке (с тултипом по аспектам). */
  function renderPowers() {
    var m = R.derived.mods, a = $('#attrBadge'), s = $('#artBadge');
    if (a) {
      var at = ch.attribute || {};
      a.setAttribute('data-tip', '<div class="tt-title">Атрибут · ' + esc(at.name) + '</div><div>' + (at.description ? esc(at.description) : 'Описание не указано') + '</div>' +
        '<div><b>' + esc(m.attrPower.label) + ': ' + fmt(m.attrPower.value, 1) + '%</b> (' + powerAspects(m.attrPower) + ')</div>' + powerTipHtml(m.attrPower));
    }
  }

  function cardData() {
    var ps = primaryStyle();
    return { name: ch.name, attribute: ch.attribute && ch.attribute.name, style: ps ? ps.name : '', level: ps ? R.derived.progress.martial.level.label : '', art: ch.art };
  }

  /* ================= рендер ================= */

  function renderAll() {
    R = compute();
    renderModeSwitch();
    renderStats();
    renderWounds();
    renderLimit();
    renderDerived();
    renderStrikes();
    renderTopProgress();
    renderBottom();
    renderPowers();
    if (figure) figure.setState({ mode: view.mode, limitLevel: R.derived.limit.worst.zone.level });
    if (!$('#modal').hidden) renderModal();
    saveView();
  }

  /* ================= вход и права ================= */

  function renderAuth() {
    var a = $('#btnAuth'), w = $('#who');
    if (!Remote) { a.hidden = true; w.hidden = true; return; }
    var u = Remote.user();
    a.hidden = false; a.textContent = u ? 'Выйти' : 'Войти через Discord';
    w.hidden = !u;
    if (u) w.innerHTML = (Remote.avatar() ? '<img src="' + esc(Remote.avatar()) + '" alt="">' : '') + '<span>' + esc(Remote.name()) + (Remote.isAdmin() ? ' · админ' : '') + '</span>';
  }
  function applyPerms() {
    var can = canEdit(ch);
    $('#btnEdit').hidden = !can;
    $('#btnNew').title = Remote && !Remote.user() ? 'Нужно войти через Discord' : '';
  }
  function needLogin() { toast('Сначала войди через Discord'); }
  function selectCharacter(id) {
    ch = chars.filter(function (c) { return c.id === id; })[0] || chars[0];
    prevVals = {};
    loadView();
    try { history.replaceState(null, '', location.pathname + location.search + '#' + ch.id); } catch (e) { /* file:// */ }
    renderHeader();
    applyPerms();
    buildStats();
    renderAll();
    if (figure) figure.setCard(cardData());
  }

  /* ================= модалка: калькуляторы, прогресс, правила ================= */

  var TABS = [{ id: 'abilities', label: 'Способности' }, { id: 'calc', label: 'Калькуляторы' }, { id: 'progress', label: 'Прогресс' }, { id: 'rules', label: 'Правила' }];
  var currentTab = 'calc';
  var calcState = { whatIf: [], target: 3000, strike: null, zone: 'normal', enemyKmh: 60, dist: 2, startSt: 100, passengers: 0, area: 100, volume: 1, curSt: 30, speedRatio: 1 };

  function openModal(tab) {
    currentTab = tab || currentTab;
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
    renderModal();
    var btn = $('#modalTabs button[aria-selected=true]'); if (btn) btn.focus();
  }
  function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; hideTip(); }

  function renderModal() {
    $('#modalTabs').innerHTML = TABS.map(function (t) { return '<button role="tab" data-mtab="' + t.id + '" aria-selected="' + (t.id === currentTab) + '">' + esc(t.label) + '</button>'; }).join('');
    $('#modalTitle').textContent = TABS.filter(function (t) { return t.id === currentTab; })[0].label;
    var body = $('#modalBody'), keep = body.scrollTop;
    body.innerHTML = { abilities: tabAbilities, calc: tabCalc, progress: tabProgress, rules: tabRules }[currentTab]();
    body.scrollTop = keep;
    if (currentTab === 'calc') updateCalcs();
  }

  var abOpen = {}, accOpen = {};
  function tabAbilities() {
    var list = R.derived.abilities, pw = R.derived.mods.attrPower;
    function pctTxt(v) { return fmt(v, v % 1 ? 1 : 0) + '%'; }
    var UPG_KEYS = [['radius', 'Радиус / дальность'], ['other', 'Прочие числа'], ['punch', 'Сила удара'], ['speed', 'Скорость'], ['durability', 'Прочность']];
    function mulTxt(f, pctVal) { return '×' + fmt(f, 2) + (pctVal === undefined ? '' : '<small>(' + pctTxt(pctVal) + ')</small>'); }
    /** Сколько AP вложено в каждый показатель способности и как изменился множитель (было → стало). */
    function allocBlock(a, mark) {
      if ((!a.ap && !a.allocTotal) || !a.targets.length) return '';
      var U = RULES.abilities.upgrade, rows = UPG_KEYS.filter(function (kv) { return a.targets.indexOf(kv[0]) !== -1; }).map(function (kv) {
        var key = kv[0], ap = a.alloc[key] || 0, l = a.lines.filter(function (x) { return x.key === key; })[0], eff = '';
        if (key === 'radius' || key === 'other') eff = mulTxt(1) + ' → ' + mulTxt(1 + ap / U.stepAp * U.distancePercentPerStep / 100) + ' (+' + fmt(ap / U.stepAp * U.distancePercentPerStep, 1) + '% от начального)';
        else if (l && l.child) eff = mulTxt(l.k0) + ' → ' + mulTxt(l.k) + (l.bonusPp ? ' (+' + fmt(l.bonusPp, 1) + '%)' : '');
        else if (l) eff = mulTxt(l.factor, l.percent) + ' → ' + mulTxt(l.factorNow, l.percentNow) + (l.bonusPp ? ' (+' + fmt(l.bonusPp, 1) + '%)' : '');
        else if (ap) eff = '+' + fmt(ap / U.stepAp * U.physPercentPerStep, 1) + '% (в описании нет метки)';
        return '<div class="upg-row' + (key === mark ? ' me' : '') + '"><span>' + kv[1] + '</span><b>' + fmt(ap, 0) + ' AP</b><span class="upg-eff">' + eff + '</span></div>';
      }).join('');
      return '<div class="upg"><div class="upg-h">Вложено в способность: ' + fmt(a.allocTotal, 0) + ' из ' + fmt(a.ap, 0) + ' AP' + (a.allocFree > 0 ? ' · свободно ' + fmt(a.allocFree, 0) : '') + (a.allocFree < 0 ? ' · <em>вложено больше, чем AP способности</em>' : '') + '</div>' + rows + '</div>';
    }
    function numHtml(l, a) {
      var val = fmt(l.value, l.key === 'speed' ? 1 : 0) + ' ' + esc(l.unit);
      var body, extra;
      if (l.child) {
        body = '×' + fmt(l.k, 2) + (l.bonusPp > 0 ? ' <span class="ab-was">(было ×' + fmt(l.k0, 2) + ')</span>' : '');
        extra = 'Берётся от «' + esc(l.parentName) + '» (' + fmt(l.base, 1) + ' ' + esc(l.unit) + ') × ' + fmt(l.k, 2) + '. Сила атрибута уже учтена в родителе.';
      } else {
        var up = Math.abs(l.power - 1) > 1e-9;
        var upg = l.bonusPp > 0;
        body = mulTxt(l.factorNow, l.percentNow) + (upg ? ' <span class="ab-was">(было ×' + fmt(l.factor, 2) + ')</span>' : '') + (up ? ' <span class="ab-pw">→ ×' + fmt(l.effFactor, 2) + '<small>(' + pctTxt(l.effPercent) + ')</small></span>' : '');
        extra = 'Стат персонажа (режим «' + esc(R.modeLabel) + '»): <b>' + fmt(l.base, 1) + ' ' + esc(l.unit) + '</b>. Способность изначально: ×' + fmt(l.factor, 2) + ' (' + pctTxt(l.percent) + ')' +
          (upg ? ', с прокачкой (' + fmt(l.allocAp, 0) + ' AP): <b>×' + fmt(l.factorNow, 2) + ' (' + pctTxt(l.percentNow) + ')</b>, без прокачки было бы ' + fmt(l.valueNoUpgrade, 0) + ' ' + esc(l.unit) : '') + '.' +
          (up ? '<br>Сила атрибута ×' + fmt(l.power, 2) + ' усиливает процент: ' + pctTxt(l.percentNow) + ' → ' + pctTxt(l.effPercent) + ' (×' + fmt(l.effFactor, 2) + ').' : '');
      }
      extra = 'Множитель: <b>' + body + '</b>' + (l.ms !== undefined ? '<br>' + fmt(l.ms, 1) + ' м/с' : '') + '<br>' + extra + allocBlock(a, l.key);
      var mul = l.child ? l.k : l.effFactor;
      return '<span class="ab-num"' + tipAttr(l.label, l.formula, extra) + '>' + val + (l.bonusPp > 0 ? '<span class="ab-up" title="прокачано">▲</span>' : '') + '<span class="ab-mul">×' + fmt(mul, 2) + '</span></span>';
    }
    function prosConsHtml(a) {
      function list(items, cls, sign) {
        return items.map(function (sg) { return '<div class="ab-pc ' + cls + '"><span class="ab-pc-i" aria-hidden="true">' + sign + '</span><div>' + segHtml(sg, a) + '</div></div>'; }).join('');
      }
      if (!(a.pros || []).length && !(a.cons || []).length) return '';
      return '<div class="ab-pcs">' + list(a.pros || [], 'pro', '+') + list(a.cons || [], 'con', '−') + '</div>';
    }
    function segHtml(segments, a) {
      return segments.map(function (s) {
        if (s.line) return numHtml(s.line, a);
        if (s.fixed !== undefined) return '<span class="ab-fix"' + tipAttr('Не меняется', null, 'Это число помечено исключением: сила атрибута его не увеличивает.') + '>' + esc(s.fixed) + '</span>';
        if (s.scaled) {
          var c = s.scaled, shown = fmt(c.value, Math.abs(c.value - Math.round(c.value)) < 1e-9 ? 0 : 2);
          if (Math.abs(c.F - 1) < 1e-9 && Math.abs(c.D - 1) < 1e-9) return esc(fmt(c.num, c.num % 1 ? 2 : 0) + c.suffix);
          return '<span class="ab-sc"' + tipAttr(c.scopeLabel + ' · сила атрибута ×' + fmt(c.F, 2) + (c.D !== 1 ? ' · прокачка ×' + fmt(c.D, 2) : ''), c.formula, ('Было ' + esc(fmt(c.num, c.num % 1 ? 2 : 0) + c.suffix) + '. ') + (c.forced ? 'Число помечено «масштабировать».' : 'Число с единицей растёт от силы атрибута автоматически. Чтобы оставить его как есть, оберни в {= …} в форме.') + allocBlock(a, c.scope === 'radius' ? 'radius' : 'other')) + '>' + esc(shown + c.suffix) + '</span>';
        }
        return esc(s.text);
      }).join('');
    }
    function upgradeHtml(a) {
      if ((!a.ap && !a.allocTotal) || !a.targets.length) return '';
      var parts = UPG_KEYS.filter(function (kv) { return a.alloc[kv[0]] > 0; }).map(function (kv) {
        var key = kv[0], l = a.lines.filter(function (x) { return x.key === key; })[0], U = RULES.abilities.upgrade, eff;
        if (key === 'radius' || key === 'other') eff = '×' + fmt(1 + a.alloc[key] / U.stepAp * U.distancePercentPerStep / 100, 2);
        else if (l && l.child) eff = '×' + fmt(l.k0, 2) + ' → ×' + fmt(l.k, 2);
        else if (l) eff = '×' + fmt(l.factor, 2) + ' → ×' + fmt(l.factorNow, 2);
        else eff = '+' + fmt(a.alloc[key] / U.stepAp * U.physPercentPerStep, 1) + '%';
        return '<span class="upg-chip">' + kv[1] + ' <b>' + fmt(a.alloc[key], 0) + ' AP</b> <small>' + eff + '</small></span>';
      });
      return '<div class="upg-line" ' + tipAttr('Прокачка', null, allocBlock(a, '')).slice(1) + '>' + (parts.length ? parts.join('') : '<span class="hint">AP ещё не распределены</span>') +
        ' <small>' + (a.allocFree !== 0 ? (a.allocFree > 0 ? 'свободно ' + fmt(a.allocFree, 0) + ' AP' : 'перебор ' + fmt(-a.allocFree, 0) + ' AP') : 'всё распределено') + '</small></div>';
    }
    function galleryHtml(a) {
      if (!a.images || !a.images.length) return '';
      return '<div class="ab-gallery">' + a.images.map(function (u) { return '<img class="ab-img" src="' + esc(u) + '" alt="' + esc(a.name) + '" loading="lazy">'; }).join('') + '</div>';
    }
    function costChips(a) {
      if (a.entry === null && a.upkeep === null) return '';
      function chip(label, v, eff, note) {
        var shown = a.fixedCost ? v : eff, red = !a.fixedCost && Math.abs(eff - v) > 1e-9;
        var tip = tipAttr('Траты стамины · ' + label.toLowerCase(), null, 'Изначально ' + fmt(v, 2) + '%. ' + (a.fixedCost ? 'Траты фиксированные: от AP не зависят.' : red ? 'С учётом общего AP персонажа: ' + fmt(eff, 2) + '%.' : 'AP пока не снижают эту трату.') + (note ? '<br>' + esc(note) : ''));
        return '<span class="abx-chip cost' + (a.fixedCost ? ' fixed' : '') + '"' + tip + '><small>' + label + '</small><b>' + fmt(shown, 2) + '%</b>' + (red ? '<small>было ' + fmt(v, 2) + '%</small>' : '') + '</span>';
      }
      return (a.entry !== null ? chip('Призыв', a.entry, a.entryEff, '') : '') + (a.upkeep !== null ? chip('Поддержание', a.upkeep, a.upkeepEff, a.upkeepNote) : '');
    }
    function sumChips(a) {
      return a.lines.slice(0, 3).map(function (l) { return '<span class="abx-chip"><small>' + esc(l.label) + '</small><b>' + fmt(l.value, l.key === 'speed' ? 1 : 0) + ' ' + esc(l.unit) + '</b></span>'; }).join('');
    }
    function kids(a) { return list.filter(function (x) { return x.parentId === a.id; }); }
    function section(title, html) { return '<section class="abx-sec"><div class="abx-sec-h">' + title + '</div>' + html + '</section>'; }
    var roots = list.filter(function (a) { return !a.parentId; });
    function isOpen(key, depth, idx) {
      if (abOpen[key] !== undefined) return abOpen[key];
      return depth > 0 || roots.length <= 2 || idx === 0;
    }
    function block(a, depth, idx) {
      var key = ch.id + ':' + a.id, open = isOpen(key, depth, idx), body = '';
      body += section('Описание', '<p class="abx-text">' + segHtml(a.segments, a) + '</p>');
      var pc = prosConsHtml(a); if (pc) body += section('Плюсы и минусы', pc);
      var gal = galleryHtml(a); if (gal) body += section('Изображения', gal);
      var up = upgradeHtml(a); if (up) body += section('Прокачка', up);
      body += kids(a).map(function (k) { return block(k, depth + 1, 0); }).join('');
      return '<article class="abx' + (depth ? ' is-sub' : '') + (open ? '' : ' is-closed') + '">' +
        '<header class="abx-head" role="button" tabindex="0" aria-expanded="' + open + '" data-ab-toggle="' + esc(key) + '">' +
        '<span class="abx-chev" aria-hidden="true"></span>' +
        '<div class="abx-title"><span class="abx-kind">' + (depth ? 'Подспособность' : 'Способность') + '</span><h3>' + esc(a.name || 'Без названия') + '</h3></div>' +
        '<div class="abx-meta">' + (a.ap ? '<span class="abx-chip ap"><b>' + fmt(a.ap, 0) + '</b><small>AP</small></span>' : '') + costChips(a) + '</div>' +
        '<div class="abx-sum">' + sumChips(a) + '</div></header>' +
        '<div class="abx-body">' + body + '</div></article>';
    }
    var modeBtns = ['base', 'passive', 'active'].map(function (m) { return '<button type="button" data-abmode="' + m + '" aria-pressed="' + (view.mode === m) + '">' + esc(RULES.modes[m].label) + '</button>'; }).join('');
    var bar = '<div class="ab-bar"><div class="ab-modes" role="group" aria-label="Режим статов">' + modeBtns + '</div>' +
      '<div class="tools"><button type="button" class="mini-btn" data-ab-all="1">Развернуть все</button><button type="button" class="mini-btn" data-ab-all="0">Свернуть все</button></div></div>';
    var lead = '<p class="ab-lead">Числа считаются от текущих статов в режиме <b>«' + esc(R.modeLabel) + '»</b>' + (view.wounds.length ? ' с ранениями' : '') + '. Сила атрибута: <b>' + fmt(pw.value, 1) + '%</b>. Наведи на число или коснись его, чтобы увидеть формулу.</p>' +
      '<details class="ab-help"><summary>Как считаются числа</summary><p>Число в описании, помеченное статом, считается как стат персонажа × множитель способности, который усиливает сила атрибута. Расстояния и другие числа с единицами (м, км, кг, км/ч) тоже растут от силы атрибута; число с замочком 🔒 не меняется. ▲ рядом с числом значит, что в него вложены AP. Мелкое «×» после числа — итоговый множитель.</p></details>';
    var btn = '<p style="margin-top:14px"><button class="mini-btn accent" data-open-editor' + (canEdit(ch) ? '' : ' disabled') + '>✎ Добавить / изменить способности</button></p>';
    if (!roots.length) return bar + lead + '<div class="empty-note">Способностей пока нет.</div>' + btn;
    return bar + lead + '<div class="ab-list">' + roots.map(function (a, i) { return block(a, 0, i); }).join('') + '</div>' + btn;
  }  function tabCalc() {
    var strikes = R.derived.strikes;
    if (!calcState.strike || !strikes.some(function (s) { return s.key === calcState.strike; })) calcState.strike = (strikes.filter(function (s) { return s.primary; })[0] || strikes[0]).key;
    var zones = RULES.durability.zones, sm = R.derived.stamina, at = ch.attribute || {};
    return '<p>Значения берутся из режима <b>«' + esc(R.modeLabel) + '»</b>' + (view.wounds.length ? ' с учётом ранений' : '') + '. Смени режим на главном экране — калькуляторы пересчитаются.</p>' +
      '<div class="calc-grid">' +
      '<div class="calc" style="grid-column:1/-1"><h3>Ранения по цели</h3><div class="sub">Какая степень ранения получится при ударе по цели с прочностью P</div>' +
      '<div class="field-row"><label class="field">Прочность цели, кг<input type="number" id="cTarget" min="1" step="100" value="' + calcState.target + '"></label>' +
      '<label class="field">Удар<select id="cStrike">' + strikes.map(function (s) { return '<option value="' + s.key + '"' + (s.key === calcState.strike ? ' selected' : '') + '>' + esc(s.label) + ' · ' + fmt(s.value, 0) + ' кг</option>'; }).join('') + '</select></label></div>' +
      '<div class="field-row"><label class="field">Зона<select id="cZone">' + Object.keys(zones).map(function (z) { return '<option value="' + z + '"' + (z === calcState.zone ? ' selected' : '') + '>' + esc(zones[z].label) + '</option>'; }).join('') + '</select></label>' +
      '<div class="field">Быстрый выбор<div style="display:flex;gap:6px">' + RULES.durability.presetTargets.map(function (p) { return '<button class="mini-btn" data-preset="' + p + '">' + fmt(p, 0) + '</button>'; }).join('') + '</div></div></div>' +
      '<div class="table-wrap" id="cWoundsOut"></div>' +
      '<h3 style="margin-top:18px">Сводка: лучшая степень по целям</h3><div class="table-wrap" id="cMatrix"></div></div>' +
      '<div class="calc" style="grid-column:1/-1"><h3>Что если</h3><div class="sub">Временные бонусы: ничего не сохраняется, персонаж не меняется. Сравнение идёт в режиме «' + esc(RULES.modes[wiMode()].label) + '»' + (view.wounds.length ? ' с ранениями' : '') + '.</div>' +
      '<div class="wi-form">' +
      '<label class="field">Параметр<select id="wStat">' + opts(STAT_OPTS, 'punch') + '</select></label>' +
      '<label class="field">%<input type="number" id="wPct" min="0" step="10" placeholder="100"></label>' +
      '<label class="field">Вид<select id="wType">' + opts(TYPE_OPTS, 'buff') + '</select></label>' +
      '<label class="field">Слой<select id="wLayer">' + opts(LAYER_OPTS, 'internal') + '</select></label>' +
      '<label class="field">Режим<select id="wMode">' + opts([['passive', 'Пассивный'], ['active', 'Активный']], 'passive') + '</select></label>' +
      '<label class="field">Источник<select id="wSource">' + opts(SRC_OPTS, '') + '</select></label>' +
      '<label class="field">Аспект<select id="wScope">' + opts(SCOPE_OPTS, 'all') + '</select></label>' +
      '<div class="field"><span>&nbsp;</span><button type="button" class="mini-btn accent" data-wi-add>+ добавить</button></div></div>' +
      '<div id="wiList"></div><div class="table-wrap" id="wiOut"></div></div>' +
      '<div class="calc"><h3>Успеет ли среагировать</h3><div class="sub">Свободное время = время атаки − реакция</div>' +
      '<div class="field-row"><label class="field">Скорость атаки врага, км/ч<input type="number" id="cEnemy" min="0" step="5" value="' + calcState.enemyKmh + '"></label>' +
      '<label class="field">Дистанция, м<input type="number" id="cDist" min="0" step="0.5" value="' + calcState.dist + '"></label></div><div id="cReactOut"></div></div>' +
      (sm ? '<div class="calc"><h3>Атрибут: запас времени</h3><div class="sub">Вход ' + fmt(at.entryCost || 0) + '%' + (sm.hasUpkeep ? ', поддержание ' + fmt(at.upkeepCost) + '% / ' + fmt(at.upkeepIntervalMin) + ' мин' : '') + ', AP ' + fmt(ch.ap, 0) + '</div>' +
        '<div class="field-row"><label class="field">Стамина на старте, %<input type="number" id="cStart" min="0" step="5" value="' + Math.min(calcState.startSt, R.stats.stamina.value) + '"></label>' +
        '<label class="field">Взять с собой людей<input type="number" id="cPass" min="0" max="10" step="1" value="' + calcState.passengers + '"></label></div><div id="cAttrOut"></div></div>' : '') +
      '<div class="calc"><h3>Восстановление стамины</h3><div class="sub">Сон 12.5%/ч, отдых 6.25%/ч, полное за 8 ч сна</div>' +
      '<label class="field">Текущая стамина, %<input type="number" id="cCur" min="0" step="5" value="' + calcState.curSt + '"></label><div id="cRecOut"></div></div>' +
      '<div class="calc"><h3>Давление</h3><div class="sub">Подъём ÷ площадь, не больше ×4 от подъёма</div>' +
      '<label class="field">Площадь контакта, см²<input type="number" id="cArea" min="0.01" step="1" value="' + calcState.area + '"></label><div id="cPressOut"></div></div>' +
      '<div class="calc"><h3>Серия ударов</h3><div class="sub">Каждая атака снижает прочность зоны на 20% от силы удара</div>' +
      '<label class="field">Во сколько раз персонаж быстрее цели<input type="number" id="cRatio" min="0" step="0.5" value="' + calcState.speedRatio + '"></label><div id="cErosionOut"></div></div>' +
      '<div class="calc"><h3>Структуры атрибута</h3><div class="sub">Каст = реакция, +⅓ реакции за каждый 1 м³</div>' +
      '<label class="field">Объём, м³<input type="number" id="cVol" min="0" step="0.5" value="' + calcState.volume + '"></label><div id="cStructOut"></div></div>' +
      '</div>';
  }

  /** В «Базовых» бонусов нет вообще, поэтому сравнение там бессмысленно — берём «Активные». */
  function wiMode() { return view.mode === 'base' ? 'active' : view.mode; }
  function renderWhatIf() {
    var list = calcState.whatIf;
    $('#wiList').innerHTML = list.length ? '<div class="chips" style="margin:10px 0">' + list.map(function (b, i) {
      return '<span class="chip"><b>' + esc(STAT_LABEL[b.stat]) + '</b> ' + (b.type === 'debuff' ? '÷' : '+') + fmt(b.percent, 1) + '% <span class="ct">' + (b.layer === 'external' ? 'внешн.' : 'внутр.') + ' · ' + (b.mode === 'active' ? 'актив' : 'пассив') + (b.source ? ' · ' + esc((RULES.buffSources[b.source] || {}).label || b.source) : '') + '</span>' +
        '<button class="x" data-wi-del="' + i + '" aria-label="Убрать" style="background:none;border:0;color:var(--text-3);cursor:pointer">✕</button></span>';
    }).join('') + '<button class="mini-btn" data-wi-clear>сбросить всё</button></div>' : '<div class="empty-note" style="margin:10px 0">Добавь бонус — рядом появится сравнение.</div>';
    if (!list.length) { $('#wiOut').innerHTML = ''; return; }
    var alt = clone(ch); alt.buffs = (alt.buffs || []).concat(list.map(function (b) { return Object.assign({ enabled: true }, b); }));
    var A = compute(wiMode()), B = E.compute(alt, RULES, { mode: wiMode(), wounds: view.wounds, testBuff: view.testBuff ? { percent: view.testBuff, source: view.testSource } : null });
    function main(X) { return (X.derived.strikes.filter(function (s) { return s.primary; })[0] || X.derived.strikes[0]).value; }
    var rows = STAT_ORDER.map(function (k) { var d = RULES.stats[k]; return [d.label, A.stats[k].value, B.stats[k].value, d.unit, d.betterLower, 1]; });
    rows.push(['Прочность', A.derived.durability.value, B.derived.durability.value, 'кг', false, 0]);
    rows.push(['Основной удар', main(A), main(B), 'кг', false, 0]);
    rows.push(['Сила атрибута', A.derived.mods.attrPower.value, B.derived.mods.attrPower.value, '%', false, 1]);
    rows.push(['Сила боевого искусства', A.derived.mods.artPower.value, B.derived.mods.artPower.value, '%', false, 1]);
    rows.push(['Нагрузка на предел', A.derived.limit.worst.ratio, B.derived.limit.worst.ratio, '×', null, 2]);
    $('#wiOut').innerHTML = '<table class="t"><thead><tr><th>Показатель</th><th>Сейчас</th><th>С бонусами</th><th>Разница</th></tr></thead><tbody>' + rows.map(function (r) {
      var diff = r[2] - r[1], same = Math.abs(diff) < 1e-6, good = r[4] === null ? diff < 0 : (r[4] ? diff < 0 : diff > 0);
      return '<tr><td>' + esc(r[0]) + '</td><td class="num">' + fmt(r[1], r[5]) + ' ' + esc(r[3]) + '</td><td class="num">' + fmt(r[2], r[5]) + ' ' + esc(r[3]) + '</td><td>' +
        (same ? '<span class="formula">—</span>' : '<span class="' + (good ? 'yes' : 'no') + '">' + (diff > 0 ? '+' : '−') + fmt(Math.abs(diff), r[5]) + (r[1] ? ' (' + (diff > 0 ? '+' : '−') + fmt(Math.abs(diff / r[1] * 100), 0) + '%)' : '') + '</span>') + '</td></tr>';
    }).join('') + '</tbody></table>' + (B.derived.limit.worst.zone.level > A.derived.limit.worst.zone.level ? '<div class="limit-warn" style="margin-top:8px">⚠ С этими бонусами тело выходит в зону «' + esc(B.derived.limit.worst.zone.label) + '»: ' + esc(B.derived.limit.worst.zone.effect) + '.</div>' : '');
  }

  function updateCalcs() {
    renderWhatIf();    var cs = calcState;
    var strike = R.derived.strikes.filter(function (s) { return s.key === cs.strike; })[0] || R.derived.strikes[0];
    var w = E.woundsAgainst(strike.value, cs.target, cs.zone, RULES);
    $('#cWoundsOut').innerHTML = '<table class="t"><thead><tr><th>Степень</th><th>Нужная сила</th><th>Как считается</th><th>' + esc(strike.label) + ' ' + fmt(strike.value, 0) + ' кг</th></tr></thead><tbody>' +
      w.rows.map(function (r) { return '<tr class="' + (w.best && w.best.id === r.id ? 'hit' : '') + '"><td>' + esc(r.label) + '</td><td class="num">' + fmt(r.required, 1) + ' кг</td><td class="formula">' + esc(r.formula) + '</td><td>' + (r.reached ? '<span class="yes">✓ наносит</span>' : '<span class="no">—</span>') + '</td></tr>'; }).join('') + '</tbody></table>';
    var targets = RULES.durability.presetTargets;
    $('#cMatrix').innerHTML = '<table class="t"><thead><tr><th>Удар</th>' + targets.map(function (t) { return '<th>P = ' + fmt(t, 0) + ' кг</th>'; }).join('') + '</tr></thead><tbody>' +
      R.derived.strikes.map(function (s) {
        return '<tr class="' + (s.primary ? 'hit' : '') + '"><td>' + esc(s.label) + ' <span class="formula">' + fmt(s.value, 0) + ' кг</span></td>' + targets.map(function (t) {
          var b = E.woundsAgainst(s.value, t, cs.zone, RULES).best;
          return '<td class="num">' + (b ? esc(b.label) : '<span class="no">нет</span>') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    var rc = E.reactionCheck(cs.enemyKmh, R.stats.reaction.value, RULES, cs.dist);
    $('#cReactOut').innerHTML = '<div class="result' + (rc.aware ? '' : ' bad') + '"><span class="big">' + (isFinite(rc.freeMs) ? fmt(rc.freeMs, 1) + ' мс' : '∞') + '</span><br>' +
      (rc.aware ? (rc.canCast ? 'Осознаёт атаку и успевает применить способность (каст = реакция ' + fmt(rc.reactionMs) + ' мс).' : 'Осознаёт атаку, но на способность времени не хватит.') : 'Атака быстрее реакции: персонаж её не осознаёт.') +
      '<div class="formula">' + esc(rc.formula) + '</div></div>';
    if ($('#cAttrOut')) {
      var me = E.attributeEndurance(ch, RULES, { max: R.stats.stamina.value, start: Math.min(cs.startSt, R.stats.stamina.value), ap: +ch.ap || 0, passengers: cs.passengers });
      if (!me.canEnter) $('#cAttrOut').innerHTML = '<div class="result bad"><span class="big">Не хватает стамины</span><br>' + esc(me.formulaEntry) + '</div>';
      else if (!me.hasUpkeep) $('#cAttrOut').innerHTML = '<div class="result"><span class="big">−' + fmt(me.entry, 2) + '%</span> за применение, останется ' + fmt(me.afterEntry, 1) + '%<div class="formula">' + esc(me.formulaEntry) + '</div></div>';
      else {
        var total = Math.max(me.minutesTo0, 1);
        $('#cAttrOut').innerHTML = '<div class="result"><span class="big">' + me.minutesToCritical + ' мин</span> до потери сознания (10%)<br><span class="big" style="font-size:18px">' + me.minutesTo0 + ' мин</span> до 0%' +
          '<div class="timeline-bar"><div class="seg-b" style="left:0;width:' + (me.minutesToCritical / total * 100) + '%"></div><div class="seg-a" style="left:' + (me.minutesToCritical / total * 100) + '%;width:' + ((me.minutesTo0 - me.minutesToCritical) / total * 100) + '%"></div>' +
          '<span style="left:0">вход −' + fmt(me.entry, 2) + '%</span><span style="right:0">' + me.minutesTo0 + ' мин</span></div>' +
          '<div class="formula">' + esc(me.formulaEntry) + '<br>' + esc(me.formulaC) + '<br>' + esc(me.formula0) + '</div></div>';
      }
    }
    var rec = E.staminaRecovery(cs.curSt, R.stats.stamina.value, RULES);
    $('#cRecOut').innerHTML = '<div class="result' + (cs.curSt <= RULES.stamina.critical ? ' bad' : '') + '"><span class="big">' + fmt(rec.sleepHours, 2) + ' ч</span> сна · <b>' + fmt(rec.restHours, 2) + ' ч</b> отдыха' +
      (cs.curSt <= RULES.stamina.critical ? '<br>Критический уровень: персонаж без сознания.' : '') + '<div class="formula">' + esc(rec.formula) + '</div></div>';
    var pr = E.pressure(R.stats.lift.value, Math.max(0.01, cs.area), RULES);
    $('#cPressOut').innerHTML = '<div class="result"><span class="big">' + fmt(pr.value, 2) + ' кг/см²</span>' + (pr.capped ? '<br>Упёрлись в потолок ×' + RULES.lift.pressureMaxMultiplier : '') + '<div class="formula">' + esc(pr.formula) + '</div></div>';
    var er = E.erosion(strike.value, cs.target, cs.speedRatio, RULES);
    $('#cErosionOut').innerHTML = '<div class="result"><span class="big">' + (er.hitsToHeavy === 0 ? 'сразу' : er.capped ? '200+' : er.hitsToHeavy + ' уд.') + '</span> до тяжёлого ранения по цели ' + fmt(cs.target, 0) + ' кг (' + esc(strike.label.toLowerCase()) + ')' +
      '<br>Снижение за удар: ' + er.percent + '%' + (er.percent !== RULES.durability.erosion.percentOfForce ? ' (скоростное снижение)' : '') + '<div class="formula">' + esc(er.formula) + '</div></div>';
    var sc = E.structureCast(R.stats.reaction.value, Math.max(0, cs.volume), RULES);
    $('#cStructOut').innerHTML = '<div class="result"><span class="big">' + fmt(sc.value, 1) + ' мс</span><div class="formula">' + esc(sc.formula) + '</div></div>';
  }

  function tabProgress() {
    var mp = R.derived.progress.martial, ap = R.derived.progress.ap;
    var lv = RULES.martialArts.levels, maxSp = lv[lv.length - 1].sp;
    var ps = primaryStyle();
    return '<div class="prog-big">' +
      '<div class="calc"><h3>Боевые стили' + (ps ? ' · ' + esc(ps.name) : '') + '</h3><div class="sub">SP меняются в форме персонажа</div>' +
      '<div class="result"><span class="big">' + esc(mp.level.label) + '</span> · ' + fmt(mp.sp, 0) + ' SP' + (mp.next ? '<br>до «' + esc(mp.next.label) + '»: ' + fmt(mp.toNext, 0) + ' SP' : '') + '</div>' +
      '<div class="pbar lg' + (mp.progress === 0 ? ' empty' : '') + '"><i style="width:' + (mp.progress * 100) + '%"></i></div>' +
      '<div class="pbar lg' + (mp.sp === 0 ? ' empty' : '') + '" style="margin-top:14px"><i style="width:' + Math.min(100, mp.sp / maxSp * 100) + '%"></i>' + lv.slice(1, -1).map(function (l) { return '<span class="mark" style="left:' + (l.sp / maxSp * 100) + '%"></span>'; }).join('') + '</div>' +
      '<div class="ladder">' + lv.map(function (l) { return '<span class="' + (l.id === mp.level.id ? 'on' : '') + '">' + esc(l.label) + '<br>' + l.sp + '</span>'; }).join('') + '</div>' +
      '<h3>Как получить SP</h3><table class="t"><tbody>' + RULES.martialArts.spSources.map(function (s) { return '<tr><td>' + esc(s.label) + '</td><td class="num">' + (s.upTo ? 'до ' : '') + s.sp + ' SP</td><td>' + esc(s.cooldown) + '</td></tr>'; }).join('') +
      RULES.martialArts.spModifiers.map(function (s) { return '<tr><td>' + esc(s.label) + '</td><td class="num">' + esc(s.value) + '</td><td></td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="calc"><h3>AP' + (ch.attribute && ch.attribute.name ? ' · атрибут «' + esc(ch.attribute.name) + '»' : '') + '</h3><div class="sub">AP меняются в форме персонажа</div>' +
      '<div class="result"><span class="big">' + fmt(ap.ap, 0) + ' AP</span> · доступно улучшений: ' + ap.upgrades + '<br>до следующего: ' + ap.toNextUpgrade + ' AP · траты атрибута ×' + fmt(ap.staminaFactor, 2) + '</div>' +
      '<div class="sub" style="margin:10px 0 0">Шаг 100 AP</div><div class="pbar lg' + (ap.stepProgress === 0 ? ' empty' : '') + '"><i style="width:' + (ap.stepProgress * 100) + '%"></i></div>' +
      '<div class="sub" style="margin:10px 0 0">Олицетворение атрибута · ' + ap.personification + ' AP (специальная арка)</div><div class="pbar lg' + (ap.ap === 0 ? ' empty' : '') + '"><i style="width:' + (ap.personificationProgress * 100) + '%"></i>' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) { return '<span class="mark" style="left:' + i * 10 + '%"></span>'; }).join('') + '</div>' +
      '<h3>Как получить AP</h3><table class="t"><tbody>' + RULES.ap.sources.map(function (s) { return '<tr><td>' + esc(s.label) + '</td><td class="num">' + (s.upTo ? 'до ' : '') + s.ap + ' AP</td><td>' + esc(s.cooldown || '') + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<p style="margin-top:10px;font-size:12px">Каждые 100 AP — улучшить способность <b>или</b> создать один приём (не оба сразу). Каждые 100 AP также снижают траты атрибута на 5% от общей траты.</p></div>' +
      '</div><p style="margin-top:14px"><button class="mini-btn accent" data-open-editor>✎ Изменить AP / SP в форме</button></p>';
  }

  function tabRules() {
    var r = RULES;
    function sec(title, items) { return '<div class="rule-sec"><h3>' + esc(title) + '</h3><ul>' + items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul></div>'; }
    return '<div class="formula-hero">База <b>×</b> внутр. баф <b>÷</b> внутр. дебафф <b>×</b> внешн. баф <b>÷</b> внешн. дебафф</div>' +
      '<div class="cols"><div>' +
      sec('Бафы, дебаффы и слои', [
        '<b>Внутренний</b> слой — от самого персонажа (атрибут, трейты, боевое искусство, его артефакты). <b>Внешний</b> — от других (саппорты, чужие способности, дебаффы врагов, аномалии).',
        'Бонусы одного источника (атрибут, трейты, стиль, артефакт, внешний) складываются как доли: +40% и +60% = <code>×2</code>. Разные источники перемножаются, бонус без источника — отдельный множитель. Баф и дебафф каждого слоя считаются так отдельно.',
        'Дебафф <b>делит</b>: ×1.5 значит «÷ 1.5», а не «−50%». Пример: база 100%, баф ×2, дебафф ×1.5 → <code>100 × 2 ÷ 1.5 = 133.3%</code>.',
        'Слои считаются независимо друг от друга: <code>×2</code> внутренний и <code>×1.5</code> внешний дают <code>×3</code>, а не ×2.5.',
        'Нет слоя в данных — считается внутренним. Пассивные бафы действуют в «Пассивных» и «Активных», активные — только в «Активных».',
        'Реакция: меньше = лучше, баф делит мс, дебафф умножает: <code>230 ÷ 1.4 ≈ 164.3 мс</code>.'
      ]) +
      sec('Сила атрибута, боевого искусства и прочность', [
        '<b>Сила атрибута</b> усиливает величину бафов и дебаффов, которые даёт атрибут (источник «Атрибут»): бафф +100% при силе атрибута <code>+200%</code> (×3) становится <code>+300%</code>; при <code>+40%</code> — <code>+140%</code>; при дебаффе силы ×1.5 — <code>100% ÷ 1.5 = 66.7%</code>. Действует аспект «мощность» (и «все аспекты»).',
        '<b>Сила боевого искусства</b> — то же для бонусов с источником «Стиль». База обоих показателей — 100%.',
        '<b>Множитель прочности</b> применяется к значению «сила удара × 3 (минимум 1500 кг)». Дебафф может опустить прочность ниже 1500 кг.'
      ]) +
      sec('Способности атрибута', [
        'Описание способности — текст; число стата вставляется меткой <code>{speed 910%}</code> и показывается как <code>×10.1 (910%) → значение</code>. Значение = стат персонажа × (1 + 9.1), от <b>текущих</b> статов (режим на главном экране).',
        'Сила атрибута увеличивает именно процент способности: 100% при силе <code>+200%</code> (×3) = 300% (×4). Если бафф атрибута тоже ×2, а способность ×2, то по базе <code>×4</code>; с силой атрибута оба становятся ×4, итого <code>×16</code>.',
        'Скорость способности берёт аспект силы атрибута «скорость», удар и прочность — «мощность».',
        'Другие числа в описании (радиус, дальность, <code>1 метр</code>, <code>20 кг</code>, <code>50 км/ч</code>) тоже растут от силы атрибута по своему аспекту; число, обёрнутое в <code>{= 15 м}</code>, не меняется. К способности можно приложить до 6 картинок.',
        'Подспособность (например, Reflection Light у Зеркала) считается от стата родителя: <code>{punch 0.5}</code> — половина.',
        'Траты стамины: не фиксированные снижаются каждые 100 AP на 5% от изначальных, но не ниже 10% от них (50% → 5%, 5% → 0.5%); фиксированные от AP не зависят.'
      ]) +
      sec('Физический предел', r.limit.levels.map(function (l) { return '<b>' + esc(l.label) + '</b>: превышение <code>×' + l.multiplier + '</code>, ' + esc(l.effect.toLowerCase()); }).concat([
        'Превысить предел можно только артефактами и внешними бонусами (саппорты). Внутренние бонусы атрибута, трейтов и стиля на предел не влияют.',
        'Каждое физическое пробуждение: <code>+1x</code> к пределам.',
        esc(r.limit.reactionWarning)
      ])) +
      sec('Прочность', [
        'Прочность = сила удара × ' + r.durability.punchMultiplier + ', минимум <code>' + r.durability.minimum + ' кг</code>.',
        r.durability.wounds.map(function (w) { return esc(w.label) + ' — <code>' + (w.factor < 1 ? '1/' + Math.round(1 / w.factor) : '×' + w.factor) + ' P</code>'; }).join(', '),
        'Слабые зоны: делитель <code>×1.1</code> + 0.1 за степень; внутренние органы <code>×1.2</code>, внешние <code>×3</code>.',
        'Удар снижает прочность зоны на 20% от силы, восстановление через 3 поста. Скоростное снижение: −5% за каждый ×1 разницы, минимум 5%.'
      ]) +
      sec('Сила удара', Object.keys(r.strike.types).map(function (k) { var t = r.strike.types[k]; return esc(t.label) + ': <code>×' + t.multiplier + '</code> — ' + esc(t.note); }).concat(['Сила удара уже включает скорость.'])) +
      '</div><div>' +
      sec('Подъём', ['Обеими руками; нет конечности — <code>÷2</code>; ногами <code>×1.5</code>.', 'Взрывная сила = <code>×2</code> подъёма за ½ реакции, не дольше 100 мс.', 'Давление = подъём ÷ площадь (ладонь 100 см²), максимум ×4 от подъёма.']) +
      sec('Скорость', ['Старт разгона = подъём ÷ 10 км/ч (не выше максимума), на максимум минимум 10 м.', 'Скорость атаки = скорость × 1.5.', 'Бег по воде: от 40 м/с; при массе > 100 кг — 50 м/с, +50 м/с за каждые 100 кг.']) +
      sec('Стамина', ['Объём 100% (до 150% на старте и 300% максимум через атрибут/аномалию).', 'Сон 12.5%/ч, отдых 6.25%/ч, 8 ч сна — полное восстановление.', 'Критический уровень 10%: потеря сознания.', 'Каждые 100 AP — траты атрибута −5% от общей траты.']) +
      sec('Реакция', ['Атака быстрее реакции не осознаётся.', 'Свободное время = время атаки − реакция; ближний бой (≤ 2 м) считается на 2 м.', 'Каст способности = реакция; структуры +⅓ реакции за каждый 1 м³.']) +
      sec('Степени ранений', r.wounds.degrees.map(function (d) { return '<b>' + esc(d.label) + '</b>: ' + esc(d.desc.toLowerCase()) + ' — ' + (d.divisor === 1 ? 'без дебаффа' : (d.all ? '<code>÷' + d.divisor + '</code> на все' : '<code>÷' + d.divisor + '</code>' + (d.accumulationCap > d.divisor ? ', в накоплении до <code>÷' + d.accumulationCap + '</code>' : ''))); })) +
      '</div></div>';
  }

  /* ================= форма персонажа ================= */

  var draft = null, editingNew = false;
  var STAT_OPTS = [['punch', 'Сила удара'], ['lift', 'Подъём'], ['speed', 'Скорость'], ['reaction', 'Реакция'], ['stamina', 'Стамина'], ['all', 'Все физические'], ['attrPower', 'Сила атрибута'], ['artPower', 'Сила боевого искусства'], ['durability', 'Прочность (множитель)']];
  var SRC_OPTS = [['', '— не важно'], ['attribute', 'Атрибут'], ['trait', 'Трейт'], ['style', 'Стиль'], ['artifact', 'Артефакт'], ['external', 'Внешний']];
  var TYPE_OPTS = [['buff', 'Баф (×)'], ['debuff', 'Дебафф (÷)']];
  var LAYER_OPTS = [['internal', 'Внутренний'], ['external', 'Внешний']];
  var SCOPE_OPTS = [['all', 'Все аспекты'], ['radius', 'Радиус'], ['power', 'Мощность'], ['speed', 'Скорость']];

  function opts(list, val) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (String(val || '') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function inp(path, val, type, attrs) {
    return '<input data-f="' + path + '" type="' + (type || 'text') + '" value="' + esc(val === null || val === undefined ? '' : val) + '"' + (attrs || '') + '>';
  }
  function fld(label, control, hint) { return '<label class="field">' + esc(label) + control + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</label>'; }

  function openEditor(isNew) {
    editingNew = !!isNew;
    draft = isNew ? blankCharacter() : clone(ch);
    $('#editorTitle').textContent = isNew ? 'Новый персонаж' : 'Персонаж · ' + (ch.name || '');
    $('#btnDelete').hidden = isNew;
    var noDel = Remote ? !ch.ownerId : chars.length <= 1;
    $('#btnDelete').disabled = noDel;
    $('#btnDelete').title = noDel ? (Remote ? 'Этого персонажа нет на сервере' : 'Нельзя удалить последнего персонажа') : '';
    $('#btnExport').hidden = isNew;
    renderEditor();
    $('#editor').hidden = false;
    document.body.style.overflow = 'hidden';
    var first = $('#editorBody input'); if (first) first.focus();
  }
  function closeEditor() { $('#editor').hidden = true; draft = null; document.body.style.overflow = ''; hideTip(); }

  function pcEditor(a, base, i) {
  function col(kind, title, ph) {
    var items = a[kind] || [];
    return '<div class="ab-pc-col"><div class="hint">' + title + '</div>' + items.map(function (s, k) {
      return '<div class="row pc-row"><textarea data-f="' + base + kind + '.' + k + '" rows="2" placeholder="' + ph + '" aria-label="' + title + '">' + esc(s) + '</textarea><button type="button" class="x" data-del-pc="' + i + '.' + kind + '.' + k + '" aria-label="Удалить">✕</button></div>';
    }).join('') + '<button type="button" class="mini-btn add" data-add-pc="' + i + '.' + kind + '">+ ' + (kind === 'pros' ? 'плюс' : 'минус') + '</button></div>';
  }
  return '<div class="ab-pc-edit">' + col('pros', 'Плюсы', 'Что способность даёт. Числа — метками, как в описании') + col('cons', 'Минусы', 'Ограничения и цена') + '</div>';
}
function allocHint(a) {
  var U = RULES.abilities.upgrade, ap = parseFloat(a.ap) || 0, al = normAlloc(a.alloc), tg = E.abilityTargets(a, RULES), tot = 0, parts = [];
  tg.forEach(function (k) { tot += al[k]; });
  tg.forEach(function (k) {
    if (!al[k]) return;
    if (k === 'radius' || k === 'other') parts.push(ALLOC_LABEL[k].toLowerCase() + ' ×' + fmt(1 + al[k] / U.stepAp * U.distancePercentPerStep / 100, 3) + ' от начального');
    else parts.push(ALLOC_LABEL[k].toLowerCase() + ' +' + fmt(al[k] / U.stepAp * U.physPercentPerStep, 2) + '%');
  });
  return 'Вложено ' + fmt(tot, 0) + ' из ' + fmt(ap, 0) + ' AP' + (tot < ap ? ' · свободно ' + fmt(ap - tot, 0) : '') + (tot > ap ? ' · <b class="bad">больше, чем AP способности</b>' : '') + (parts.length ? ' — ' + parts.join(', ') : '');
}
function allocEditor(a, base, i) {
  var U = RULES.abilities.upgrade, tg = E.abilityTargets(a, RULES);
  if (!tg.length) return '<div class="ab-alloc"><div class="hint">Вкладывать AP пока некуда: в описании нет чисел, которые зависят от статов или меняются от силы атрибута. Добавь метку <code>{speed 910%}</code> или число с единицей (<code>10 м</code>, <code>20 кг</code>); числа с замочком <code>{= …}</code> не прокачиваются.</div></div>';
  var hasPhys = tg.some(function (k) { return k !== 'radius' && k !== 'other'; });
  return '<div class="ab-alloc"><div class="hint">AP можно вложить только в то, что есть в описании: показатели из меток и числа, которые меняются от силы атрибута. Каждые ' + U.stepAp + ' AP = +' + U.physPercentPerStep + '% к показателю (баф 100% → ' + fmt(100 + U.physPercentPerStep, 0) + '%) или +' + U.distancePercentPerStep + '% к начальному числу. Можно делить: ' + fmt(U.stepAp / 4, 0) + ' AP на 4 показателя = +' + fmt(U.physPercentPerStep / 4, 1) + '% каждому.</div>' +
    '<div class="row4">' + tg.map(function (k) { return fld(ALLOC_LABEL[k] + ', AP', inp(base + 'alloc.' + k, a.alloc[k] || '', 'number', ' min="0" step="25"')); }).join('') + '</div>' +
    (hasPhys ? '<div class="row"><button type="button" class="mini-btn" data-spread="' + i + '" title="Раскидать свободные AP поровну на показатели из описания">⚖ свободные AP поровну на показатели</button></div>' : '') +
    '<div class="ab-alloc-hint">' + allocHint(a) + '</div></div>';
}
  function renderEditor() {
    var d = draft, body = $('#editorBody'), keep = body.scrollTop;
    var strikeOpts = [['', '— не указан']].concat(Object.keys(RULES.strike.types).map(function (k) { return [k, RULES.strike.types[k].label + ' ×' + RULES.strike.types[k].multiplier]; }));
    function buffRows(mode) {
      var rows = d.buffs.map(function (b, i) { return { b: b, i: i }; }).filter(function (x) { return x.b.mode === mode; });
      return (rows.length ? rows.map(function (x) {
        return '<div class="row buff-row">' +
          '<select data-f="buffs.' + x.i + '.stat" aria-label="Параметр">' + opts(STAT_OPTS, x.b.stat) + '</select>' +
          '<div class="pct">' + inp('buffs.' + x.i + '.percent', x.b.percent, 'number', ' min="0" step="1" placeholder="40" aria-label="Процент"') + '<span>%</span></div>' +
          '<select data-f="buffs.' + x.i + '.type" aria-label="Баф или дебафф">' + opts(TYPE_OPTS, x.b.type) + '</select>' +
          '<select data-f="buffs.' + x.i + '.layer" aria-label="Слой">' + opts(LAYER_OPTS, x.b.layer) + '</select>' +
          '<button type="button" class="x" data-del="buffs.' + x.i + '" aria-label="Удалить">✕</button>' +
          '<select data-f="buffs.' + x.i + '.source" aria-label="Источник">' + opts(SRC_OPTS, x.b.source) + '</select>' +
          '<select data-f="buffs.' + x.i + '.scope" aria-label="Аспект (для силы атрибута / боевого искусства)" title="Аспект: только для силы атрибута и боевого искусства">' + opts(SCOPE_OPTS, x.b.scope) + '</select>' +
          inp('buffs.' + x.i + '.label', x.b.label, 'text', ' placeholder="подпись (необязательно)" aria-label="Подпись"') +
          '<input type="checkbox" class="buff-on" data-f="buffs.' + x.i + '.enabled"' + (x.b.enabled === false ? '' : ' checked') + ' title="Бонус включён" aria-label="Включён"></div>';
      }).join('') : '<div class="empty-note">Нет бафов.</div>') +
        '<button type="button" class="mini-btn add" data-add-buff="' + mode + '">+ баф</button>';
    }
    function abilityRows() {
      var A = d.abilities, nA = A.length, ids = {};
      A.forEach(function (a) { ids[a.id] = true; });
      function one(i, depth) {
        var a = A[i], base = 'abilities.' + i + '.';
        function acc(name, title, inner, defOpen) {
          var k = a.id + ':' + name, open = accOpen[k] === undefined ? defOpen : accOpen[k];
          return '<details class="ed-acc" data-acc="' + esc(k) + '"' + (open ? ' open' : '') + '><summary>' + title + '</summary><div class="ed-acc-body">' + inner + '</div></details>';
        }
        var nPc = (a.pros || []).length + (a.cons || []).length, nImg = (a.images || []).length;
        var costSum = [a.entryCost !== null && a.entryCost !== '' ? 'призыв ' + a.entryCost + '%' : '', a.upkeepCost !== null && a.upkeepCost !== '' ? 'поддержание ' + a.upkeepCost + '%' : ''].filter(Boolean).join(', ');
        var out = '<div class="ab-edit' + (depth ? ' sub' : '') + '">' +
          '<div class="ab-edit-h">' + (depth ? '<span class="ab-tag">подспособность</span>' : '') + '<div class="row">' + inp(base + 'name', a.name, 'text', ' placeholder="' + (depth ? 'Название подспособности' : 'Название способности') + '" aria-label="Название"') + '<button type="button" class="x" data-del="abilities.' + i + '" aria-label="Удалить">✕</button></div></div>' +
          acc('desc', 'Описание',
            '<textarea data-f="' + base + 'description" rows="' + (depth ? 4 : 6) + '" placeholder="Описание. Число вставляй меткой, например: Скорость зеркала — {speed 910%} от скорости персонажа" aria-label="Описание">' + esc(a.description) + '</textarea>' +
            '<div class="row ab-marks"><span class="hint">выдели число в тексте:</span><button type="button" class="mini-btn" data-wrap="=" data-target="' + base + 'description" title="Число не будет расти от силы атрибута">🔒 не меняется</button>' +
            '<button type="button" class="mini-btn" data-wrap="~" data-target="' + base + 'description" title="Число без единицы тоже будет расти от силы атрибута">⚖ масштабировать</button></div>', true) +
          acc('pc', 'Плюсы и минусы <small>' + (nPc ? nPc + ' шт.' : 'нет') + '</small>', pcEditor(a, base, i), false) +
          acc('cost', 'Траты стамины <small>' + (costSum || 'не указаны') + (a.fixedCost ? ' · фиксированные' : '') + '</small>',
            '<div class="row3">' + fld('Призыв, % стамины', inp(base + 'entryCost', a.entryCost, 'number', ' min="0" step="any"')) + fld('Поддержание, %', inp(base + 'upkeepCost', a.upkeepCost, 'number', ' min="0" step="any"')) + fld('Период поддержания', inp(base + 'upkeepNote', a.upkeepNote, 'text', ' placeholder="за пост"')) + '</div>' +
            '<label class="chk"><input type="checkbox" data-f="' + base + 'fixedCost"' + (a.fixedCost ? ' checked' : '') + '> Фиксированные траты <span class="hint">(не снижаются от AP)</span></label>', false) +
          acc('up', 'Прокачка и AP <small>' + (parseFloat(a.ap) ? fmt(parseFloat(a.ap), 0) + ' AP' : 'нет') + '</small>',
            fld('AP, вложенные в способность', inp(base + 'ap', a.ap, 'number', ' min="0" step="10"')) + allocEditor(a, base, i), false) +
          acc('img', 'Картинки <small>' + (nImg ? nImg + ' шт.' : 'нет') + '</small>',
            '<div class="ab-imgs">' + (a.images || []).map(function (u, k) { return '<span class="ab-thumb"><img src="' + esc(u) + '" alt=""><button type="button" class="x" data-del-img="' + i + '.' + k + '" aria-label="Убрать картинку">✕</button></span>'; }).join('') +
            ((a.images || []).length < (RULES.abilities.maxImages || 6) ? '<button type="button" class="mini-btn add" data-add-img="' + i + '">+ картинка</button>' : '') + '</div>', false);        if (depth < 2) out += '<button type="button" class="mini-btn add" data-add-sub="' + esc(a.id) + '"' + (nA >= RULES.abilities.max ? ' disabled' : '') + '>+ подспособность</button>';
        A.forEach(function (c, j) { if (c.parentId === a.id && j !== i) out += one(j, depth + 1); });
        return out + '</div>';
      }
      var html = '';
      A.forEach(function (a, i) { if (!a.parentId || !ids[a.parentId] || a.parentId === a.id) html += one(i, 0); });
      return '<input type="file" id="abImgFile" accept="image/*" hidden>' + (nA ? html : '<div class="empty-note">Нет способностей.</div>') +
        '<button type="button" class="mini-btn add" data-add-ability' + (nA >= RULES.abilities.max ? ' disabled' : '') + '>' + (nA >= RULES.abilities.max ? 'максимум ' + RULES.abilities.max : '+ способность') + '</button>';
    }
    var nTraits = d.traits.length;
    body.innerHTML =
      '<div class="ed-grid">' +
      // арт
      '<section class="ed-sec ed-art"><h3>Арт для карточки</h3>' +
      '<div class="art-drop" id="artDrop">' + (d.art ? '<img src="' + esc(d.art) + '" alt="Арт">' : '<div class="art-empty">Перетащи картинку сюда<br>или нажми, чтобы выбрать<br><small>лучше вертикальную, 2:3</small></div>') + '</div>' +
      '<input type="file" id="artFile" accept="image/*" hidden>' +
      '<div class="row"><button type="button" class="mini-btn" id="artPick">Выбрать файл</button>' + (d.art ? '<button type="button" class="mini-btn" id="artRemove">Убрать</button>' : '') + '</div></section>' +
      // основное
      '<section class="ed-sec"><h3>Основное</h3>' +
      fld('Имя *', inp('name', d.name, 'text', ' required placeholder="Кенос"')) +
      fld('Атрибут', inp('attribute.name', d.attribute.name, 'text', ' placeholder="Зеркало"')) +
      fld('Описание атрибута', '<textarea data-f="attribute.description" rows="3" placeholder="необязательно">' + esc(d.attribute.description) + '</textarea>') +
      '<div class="row3">' +
      fld('AP', inp('ap', d.ap, 'number', ' min="0" step="10"')) +
      fld('SP', inp('sp', d.sp, 'number', ' min="0" step="5"')) +
      fld('Вес, кг', inp('weightKg', d.weightKg, 'number', ' min="0" step="1"'), 'для бега по воде') +
      '</div></section>' +
      // базовые
      '<section class="ed-sec"><h3>Базовые характеристики</h3><div class="sub">С учётом одарённости, без бафов</div>' +
      '<div class="row2c">' +
      fld('Сила удара, кг', inp('stats.punch', d.stats.punch, 'number', ' min="0" step="10"')) +
      fld('Сила на подъём, кг', inp('stats.lift', d.stats.lift, 'number', ' min="0" step="5"')) +
      fld('Скорость, км/ч', inp('stats.speed', d.stats.speed, 'number', ' min="0" step="1"')) +
      fld('Реакция, мс', inp('stats.reaction', d.stats.reaction, 'number', ' min="1" step="1"')) +
      fld('Стамина, %', inp('stats.stamina', d.stats.stamina, 'number', ' min="0" step="5"')) +
      fld('Физ. пробуждения', inp('awakenings', d.awakenings, 'number', ' min="0" step="1"'), '+1x к пределам за каждое') +
      '</div>' +
      '<details class="ed-more"' + (d.attribute.entryCost || d.attribute.upkeepCost ? ' open' : '') + '><summary>Траты стамины атрибута (необязательно)</summary><div class="row3">' +
      fld('Вход, %', inp('attribute.entryCost', d.attribute.entryCost, 'number', ' min="0" step="1"')) +
      fld('Поддержание, %', inp('attribute.upkeepCost', d.attribute.upkeepCost, 'number', ' min="0" step="1"')) +
      fld('каждые N мин', inp('attribute.upkeepIntervalMin', d.attribute.upkeepIntervalMin, 'number', ' min="0" step="1"')) +
      '</div></details></section>' +
      // стили
      '<section class="ed-sec"><h3>Стили боя</h3><div class="sub">Первый стиль с типом удара задаёт основной удар</div>' +
      (d.styles.length ? d.styles.map(function (s, i) {
        return '<div class="row style-row">' + inp('styles.' + i + '.name', s.name, 'text', ' placeholder="LINE: Колющее направление" aria-label="Название стиля"') +
          '<select data-f="styles.' + i + '.strikeType" aria-label="Тип удара">' + opts(strikeOpts, s.strikeType) + '</select>' +
          '<button type="button" class="x" data-del="styles.' + i + '" aria-label="Удалить">✕</button></div>';
      }).join('') : '<div class="empty-note">Нет стилей.</div>') +
      '<button type="button" class="mini-btn add" data-add="styles">+ стиль</button></section>' +
      // трейты
      '<section class="ed-sec"><h3>Трейты <span class="count">' + nTraits + ' / ' + RULES.maxTraits + '</span></h3>' +
      (nTraits ? d.traits.map(function (t, i) {
        return '<div class="row trait-row">' + inp('traits.' + i + '.name', t.name, 'text', ' placeholder="Название" aria-label="Название трейта"') +
          inp('traits.' + i + '.description', t.description, 'text', ' placeholder="описание (необязательно)" aria-label="Описание трейта"') +
          '<button type="button" class="x" data-del="traits.' + i + '" aria-label="Удалить">✕</button></div>';
      }).join('') : '<div class="empty-note">Нет трейтов.</div>') +
      '<button type="button" class="mini-btn add" data-add="traits"' + (nTraits >= RULES.maxTraits ? ' disabled' : '') + '>' + (nTraits >= RULES.maxTraits ? 'максимум ' + RULES.maxTraits : '+ трейт') + '</button></section>' +
      '<section class="ed-sec ed-wide"><h3>Способности атрибута</h3><div class="sub">Описание пиши текстом, а число стата вставляй меткой: <code>{speed 910%}</code>, <code>{durability 280%}</code>, <code>{punch 910%}</code> (можно <code>x10.1</code>, по-русски <code>{скорость 910%}</code>). На экране метка превратится в <b>×10,1 (910%) → готовое значение</b>, посчитанное от текущих статов; сила атрибута усиливает процент. В подспособности метка — множитель от стата родителя: <code>{punch 0.5}</code> = половина. Остальные числа с единицами (<code>1 метр</code>, <code>15 м</code>, <code>20 кг</code>, <code>50 км/ч</code>) растут от силы атрибута сами; выдели число и нажми «🔒 не меняется» (оно обернётся в <code>{= 15 м}</code>), если оно не должно расти. «⚖ масштабировать» (<code>{~ 15 лучей}</code>) включает рост для числа без единицы. Не фиксированные траты снижаются каждые 100 AP (общих AP персонажа) на 5% от изначальных: изначально ≥10% — не ниже 5%, ≤5% — не ниже 0.5%.</div>' + abilityRows() + '</section>' +
      // бафы
      '<section class="ed-sec ed-wide"><h3>Пассивные бафы</h3><div class="sub">Действуют постоянно. Слой: <b>внутренний</b> — от самого персонажа, <b>внешний</b> — от других (саппорты, враги, аномалии). Дебафф делит. Источник нужен только для предела (артефакт и внешний слой могут его превысить). Аспект — для силы атрибута и боевого искусства. Галочка справа — бонус включён.</div>' + buffRows('passive') + '</section>' +
      '<section class="ed-sec ed-wide"><h3>Активные бафы</h3><div class="sub">Включаются в бою. Те же поля; процент всегда положительный, направление задаёт «баф / дебафф».</div>' + buffRows('active') + '</section>' +
      '</div>';
    body.scrollTop = keep;
  }

  function setPath(obj, path, value) {
    var parts = path.split('.'), o = obj;
    for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
  }

  var ART_MIN_HEIGHT = 1500;
  /** Арт хранится как исходный файл (data URL) — без уменьшения и пережатия, чтобы скриншоты были чёткими. */
  function readImage(file) {
    return new Promise(function (res, rej) {
      if (!file || !/^image\//.test(file.type)) return rej(new Error('Это не картинка'));
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () {
          if (im.naturalHeight < ART_MIN_HEIGHT) {
            console.warn('Арт ' + file.name + ': ' + im.naturalWidth + '×' + im.naturalHeight + ' px — меньше ' + ART_MIN_HEIGHT + ' px по высоте, на скриншоте будет мыльным.');
            toast('Арт ' + im.naturalWidth + '×' + im.naturalHeight + ' — для чёткого скриншота нужно от ' + ART_MIN_HEIGHT + ' px по высоте');
          }
          res(fr.result);
        };
        im.onerror = function () { rej(new Error('Не удалось прочитать картинку')); };
        im.src = fr.result;
      };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(file);
    });
  }
  var abImgTarget = null;
  /** Картинка способности: уменьшаем до 1400 px по большей стороне, чтобы не раздувать хранилище. */
  function readAbilityImage(file) {
    return new Promise(function (res, rej) {
      if (!file || !/^image\//.test(file.type)) return rej(new Error('Это не картинка'));
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () {
          var k = Math.min(1, 1400 / Math.max(im.naturalWidth, im.naturalHeight));
          if (k === 1 && file.size < 1.5 * 1024 * 1024) return res(fr.result);
          var cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
          cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
          res(cv.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9));
        };
        im.onerror = function () { rej(new Error('Не удалось прочитать картинку')); };
        im.src = fr.result;
      };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(file);
    });
  }
  function takeArt(file) {
    readImage(file).then(function (url) { draft.art = url; renderEditor(); }).catch(function (e) { toast(e.message); });
  }

  function cleanAlloc(a) {
    var al = normAlloc(a.alloc), tg = E.abilityTargets(a, RULES);
    ALLOC_KEYS.forEach(function (k) { if (tg.indexOf(k) === -1) al[k] = 0; });
    return al;
  }
  function cleanDraft(d) {
    function n(v) { v = parseFloat(v); return isFinite(v) ? v : null; }
    var c = clone(d);
    c.name = String(c.name || '').trim();
    c.attribute.name = String(c.attribute.name || '').trim();
    c.attribute.entryCost = n(c.attribute.entryCost);
    c.attribute.upkeepCost = n(c.attribute.upkeepCost);
    c.attribute.upkeepIntervalMin = n(c.attribute.upkeepIntervalMin);
    Object.keys(c.stats).forEach(function (k) { c.stats[k] = n(c.stats[k]) || 0; });
    if (c.stats.reaction < RULES.reaction.absoluteMs) c.stats.reaction = RULES.reaction.absoluteMs;
    ['ap', 'sp', 'weightKg', 'awakenings'].forEach(function (k) { c[k] = Math.max(0, n(c[k]) || 0); });
    c.styles = c.styles.filter(function (s) { return String(s.name || '').trim(); }).map(function (s) { return { name: s.name.trim(), strikeType: s.strikeType || '' }; });
    c.traits = c.traits.filter(function (t) { return String(t.name || '').trim(); }).slice(0, RULES.maxTraits).map(function (t) { return { name: t.name.trim(), description: String(t.description || '').trim() }; });
    var ids = {};
    c.abilities = (c.abilities || []).filter(function (a) { return String(a.name || '').trim(); }).slice(0, RULES.abilities.max).map(function (a) {
      ids[String(a.id || '')] = true;
      return { id: String(a.id || makeBuffId()), name: String(a.name).trim(), description: String(a.description || '').trim(), upkeepNote: String(a.upkeepNote || '').trim(), parentId: String(a.parentId || ''),
        fixedCost: a.fixedCost === true, alloc: cleanAlloc(a), pros: normList(a.pros).map(function (s) { return s.trim(); }).filter(Boolean), cons: normList(a.cons).map(function (s) { return s.trim(); }).filter(Boolean), ap: Math.max(0, n(a.ap) || 0), entryCost: n(a.entryCost), upkeepCost: n(a.upkeepCost),
        images: (Array.isArray(a.images) ? a.images : []).filter(function (u) { return typeof u === 'string' && /^(data:image\/|https:\/\/)/.test(u); }).slice(0, RULES.abilities.maxImages || 6) };
    });    c.abilities.forEach(function (a) { if (!ids[a.parentId] || a.parentId === a.id) a.parentId = ''; });
    c.buffs = c.buffs.filter(function (b) { return n(b.percent); }).map(function (b) {
      var u = upgradeBuff(Object.assign({}, b, { percent: n(b.percent) }));
      var scoped = RULES.modifiers[u.stat] && RULES.modifiers[u.stat].scoped;
      return { id: u.id || makeBuffId(), mode: u.mode, stat: u.stat, percent: u.percent, type: u.type, layer: u.layer, scope: scoped ? u.scope : 'all', source: u.source || '', label: String(u.label || '').trim(), enabled: u.enabled };
    });
    return c;
  }

  function saveEditor(e) {
    if (e) e.preventDefault();
    var c = cleanDraft(draft);
    if (!c.name) { toast('Укажи имя персонажа'); var f = $('#editorBody [data-f="name"]'); if (f) f.focus(); return; }
    if (editingNew || !c.id) c.id = makeId(c.name);
    c.updatedAt = Date.now();
    if (!c.createdAt) c.createdAt = Date.now();
    Store.put(c).then(function () {
      var i = chars.map(function (x) { return x.id; }).indexOf(c.id);
      if (i === -1) chars.push(c); else chars[i] = c;
      closeEditor();
      selectCharacter(c.id);
      toast('Сохранено');
    }).catch(function (err) { toast('Не удалось сохранить: ' + err.message); });
  }

  function exportCharacter() {
    var c = cleanDraft(draft);
    var blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (c.name || 'character') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importCharacters(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var list;
      try { list = JSON.parse(fr.result); } catch (e) { toast('Файл не похож на JSON'); return; }
      if (!Array.isArray(list)) list = [list];
      list = list.filter(function (c) { return c && typeof c === 'object' && c.stats; }).map(normalize).map(function (c) { delete c.ownerId; delete c.ownerName; return c; });
      if (!list.length) { toast('В файле нет персонажей'); return; }
      Promise.all(list.map(function (c) {
        var exists = chars.some(function (x) { return x.id === c.id; });
        if (!c.id || (exists && !confirm('Персонаж «' + c.name + '» уже есть. Заменить?'))) c.id = makeId(c.name);
        return Store.put(c).then(function () {
          var i = chars.map(function (x) { return x.id; }).indexOf(c.id);
          if (i === -1) chars.push(c); else chars[i] = c;
        });
      })).then(function () {
        closeEditor();
        selectCharacter(list[list.length - 1].id);
        toast('Импортировано: ' + list.length);
      });
    };
    fr.readAsText(file);
  }

  function deleteCharacter() {
    if (Remote ? !ch.ownerId : chars.length <= 1) return;
    if (!confirm('Удалить персонажа «' + ch.name + '»? Это нельзя отменить (если нет экспорта).')) return;
    var id = ch.id;
    Store.remove(id).then(function () {
      chars = chars.filter(function (c) { return c.id !== id; });
      try { localStorage.removeItem('rp-view:' + id); } catch (e) { /* ок */ }
      if (!chars.length) chars = demoList();
      closeEditor();
      selectCharacter(chars[0].id);
      toast('Удалено');
    }).catch(function (err) { toast('Не удалось удалить: ' + err.message); });
  }

  function bindEditor() {
    var body = $('#editorBody');
    body.addEventListener('input', function (e) {
      var p = e.target.getAttribute('data-f');
      if (!p) return;
      setPath(draft, p, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      var am = /^abilities\.(\d+)\.(ap|alloc\.)/.exec(p);
      if (am && draft.abilities[+am[1]]) { var hint = e.target.closest('.ab-edit').querySelector('.ab-alloc-hint'); if (hint) hint.innerHTML = allocHint(draft.abilities[+am[1]]); }
      if (p === 'name') $('#editorTitle').textContent = (editingNew ? 'Новый персонаж · ' : 'Персонаж · ') + e.target.value;
    });
    body.addEventListener('toggle', function (e) {
      var dt = e.target; if (dt && dt.matches && dt.matches('details[data-acc]')) accOpen[dt.getAttribute('data-acc')] = dt.open;
    }, true);
    body.addEventListener('change', function (e) {
      if (/^abilities\.\d+\.(description|pros\.\d+|cons\.\d+)$/.test(e.target.getAttribute('data-f') || '')) { renderEditor(); return; }
      if (e.target.id === 'abImgFile' && e.target.files[0] && abImgTarget !== null) {
        var ti = abImgTarget, f = e.target.files[0]; e.target.value = '';
        readAbilityImage(f).then(function (url) { var A = draft.abilities[ti]; if (A) { A.images = (A.images || []).concat(url).slice(0, RULES.abilities.maxImages || 6); renderEditor(); } }).catch(function (er) { toast(er.message); });
        return;
      }
      if (e.target.id === 'artFile' && e.target.files[0]) takeArt(e.target.files[0]);
    });
    body.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('#artPick') || t.closest('#artDrop')) { $('#artFile').click(); return; }
      if (t.closest('#artRemove')) { draft.art = null; renderEditor(); return; }
      var apc = t.closest('[data-add-pc]');
      if (apc) { var ap2 = apc.getAttribute('data-add-pc').split('.'); var PA = draft.abilities[+ap2[0]]; PA[ap2[1]] = normList(PA[ap2[1]]).concat(''); renderEditor(); var tas = $$('#editorBody .ab-edit')[+ap2[0]]; return; }
      var dpc = t.closest('[data-del-pc]');
      if (dpc) { var dp2 = dpc.getAttribute('data-del-pc').split('.'); draft.abilities[+dp2[0]][dp2[1]].splice(+dp2[2], 1); renderEditor(); return; }
      var spr = t.closest('[data-spread]');
      if (spr) {
        var SA = draft.abilities[+spr.getAttribute('data-spread')]; if (!SA) return;
        SA.alloc = normAlloc(SA.alloc);
        var used = 0; E.abilityTargets(SA, RULES).forEach(function (k) { used += SA.alloc[k]; });
        var free = (parseFloat(SA.ap) || 0) - used;
        if (free <= 0) { toast('Свободных AP нет'); return; }
        var ph = E.abilityTargets(SA, RULES).filter(function (k) { return k !== 'radius' && k !== 'other'; });
        if (!ph.length) { toast('В описании нет показателей-меток'); return; }
        ph.forEach(function (k) { SA.alloc[k] = Math.round((SA.alloc[k] + free / ph.length) * 100) / 100; });
        renderEditor(); return;
      }
      var wr = t.closest('[data-wrap]');
      if (wr) {
        var ta = wr.parentNode.parentNode.querySelector('textarea'); if (!ta) return;
        var s0 = ta.selectionStart, s1 = ta.selectionEnd;
        if (s0 === s1) { toast('Сначала выдели в тексте число (с единицей)'); return; }
        var sel = ta.value.slice(s0, s1).trim(), mk = wr.getAttribute('data-wrap');
        ta.value = ta.value.slice(0, s0) + '{' + mk + ' ' + sel + '}' + ta.value.slice(s1);
        setPath(draft, wr.getAttribute('data-target'), ta.value); renderEditor(); return;
      }
      var aim = t.closest('[data-add-img]');
      if (aim) { abImgTarget = +aim.getAttribute('data-add-img'); $('#abImgFile').click(); return; }
      var dim = t.closest('[data-del-img]');
      if (dim) { var di = dim.getAttribute('data-del-img').split('.'); draft.abilities[+di[0]].images.splice(+di[1], 1); renderEditor(); return; }
      var asub = t.closest('[data-add-sub]');
      if (asub) { if (draft.abilities.length >= RULES.abilities.max) return; draft.abilities.push(normAbility({ id: makeBuffId(), parentId: asub.getAttribute('data-add-sub') })); renderEditor(); var sn = $$('#editorBody .ab-edit'); var f1 = sn[sn.length - 1] && sn[sn.length - 1].querySelector('input'); if (f1) f1.focus(); return; }
      if (t.closest('[data-add-ability]')) { if (draft.abilities.length >= RULES.abilities.max) return; draft.abilities.push(normAbility({ id: makeBuffId() })); renderEditor(); var ns = $$('#editorBody .ab-edit'); if (ns.length) { var f0 = ns[ns.length - 1].querySelector('input'); if (f0) f0.focus(); } return; }
      var add = t.closest('[data-add]');
      if (add) {
        var k = add.getAttribute('data-add');
        if (k === 'traits' && draft.traits.length >= RULES.maxTraits) return;
        draft[k].push(k === 'styles' ? { name: '', strikeType: '' } : { name: '', description: '' });
        renderEditor();
        var rows = $$('#editorBody .' + (k === 'styles' ? 'style' : 'trait') + '-row input');
        if (rows.length) rows[rows.length - (k === 'styles' ? 1 : 2)].focus();
        return;
      }
      var ab = t.closest('[data-add-buff]');
      if (ab) { draft.buffs.push({ id: makeBuffId(), mode: ab.getAttribute('data-add-buff'), stat: 'punch', percent: '', type: 'buff', layer: 'internal', scope: 'all', source: '', label: '', enabled: true }); renderEditor(); return; }
      var del = t.closest('[data-del]');
      if (del) {
        var pp = del.getAttribute('data-del').split('.'), gone = draft[pp[0]].splice(+pp[1], 1)[0];
        if (pp[0] === 'abilities' && gone) { // подспособности уходят вместе с родителем
          var ids = [gone.id], more = true;
          while (more) { more = false; draft.abilities = draft.abilities.filter(function (a) { if (ids.indexOf(a.parentId) !== -1) { ids.push(a.id); more = true; return false; } return true; }); }
        }
        renderEditor();
      }
    });
    body.addEventListener('dragover', function (e) { if (e.target.closest('#artDrop')) { e.preventDefault(); e.target.closest('#artDrop').classList.add('over'); } });
    body.addEventListener('dragleave', function (e) { var d = e.target.closest('#artDrop'); if (d) d.classList.remove('over'); });
    body.addEventListener('drop', function (e) {
      if (!e.target.closest('#artDrop')) return;
      e.preventDefault();
      if (e.dataTransfer.files[0]) takeArt(e.dataTransfer.files[0]);
    });
    $('#editorForm').addEventListener('submit', saveEditor);
    $('#editor').addEventListener('click', function (e) { if (e.target.closest('[data-eclose]')) closeEditor(); });
    $('#btnExport').addEventListener('click', exportCharacter);
    $('#importFile').addEventListener('change', function () { if (this.files[0]) importCharacters(this.files[0]); this.value = ''; });
    $('#btnDelete').addEventListener('click', deleteCharacter);
  }

  /* ================= тултип ================= */

  var tipEl = null, tipTarget = null;
  function showTip(el, x, y) {
    var html = el.getAttribute('data-tip');
    if (!html) return;
    tipTarget = el; tipEl.innerHTML = html; tipEl.hidden = false; placeTip(x, y);
  }
  function placeTip(x, y) {
    var r = tipEl.getBoundingClientRect(), nx = x + 16, ny = y + 18;
    if (nx + r.width > window.innerWidth - 8) nx = x - r.width - 12;
    if (ny + r.height > window.innerHeight - 8) ny = y - r.height - 12;
    tipEl.style.left = Math.max(8, nx) + 'px'; tipEl.style.top = Math.max(8, ny) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; tipTarget = null; }
  function initTips() {
    tipEl = $('#tooltip');
    document.addEventListener('pointerover', function (e) {
      if (e.pointerType === 'touch') return;
      var el = e.target.closest && e.target.closest('[data-tip]');
      if (el && el !== tipTarget) showTip(el, e.clientX, e.clientY);
      else if (!el) hideTip();
    });
    document.addEventListener('pointermove', function (e) { if (tipTarget && !tipEl.hidden && e.pointerType !== 'touch') placeTip(e.clientX, e.clientY); });
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-tip]');
      if (el && matchMedia('(hover: none)').matches) {
        if (tipTarget === el) hideTip(); else { var r = el.getBoundingClientRect(); showTip(el, r.left, r.bottom); }
      } else if (!el) hideTip();
    });
    window.addEventListener('scroll', hideTip, { passive: true });
  }

  /* ================= скриншот ================= */

  /** Клон экрана для экспорта: числа сразу в финальном значении, без середины анимации. */
  function prepareClone(rootEl) {
    STAT_ORDER.forEach(function (k) {
      var v = $('#st-' + k + ' [data-val]', rootEl);
      if (v && R) v.textContent = fmt(R.stats[k].value, 1);
    });
  }
  function shotContext() {
    var wounds = view.wounds.filter(function (w) { return w.enabled !== false; }).map(function (w) {
      var d = degreeById(w.degree);
      return d.label.toLowerCase() + (d.all ? '' : ' (' + RULES.stats[w.stat].short + ')');
    });
    return { name: ch.name || ch.id, mode: view.mode, modeLabel: R.modeLabel, wounds: wounds, testBuff: view.testBuff, figure: figure, prepare: prepareClone };
  }
  function bindShot() {
    var btn = $('#btnShot'), menu = $('#shotMenu');
    function setOpen(v) { menu.hidden = !v; btn.setAttribute('aria-expanded', v ? 'true' : 'false'); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(menu.hidden); if (!menu.hidden) menu.querySelector('button').focus(); });
    document.addEventListener('click', function (e) { if (!e.target.closest('#shot')) setOpen(false); });
    menu.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setOpen(false); btn.focus(); } });
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-shot]'); if (!b || !window.RPShot) return;
      setOpen(false);
      btn.disabled = true; btn.textContent = '📷 Готовлю…';
      toast('Готовлю скриншот в высоком разрешении…');
      window.RPShot.capture(b.dataset.shot, shotContext()).then(function (r) {
        toast('Сохранено: ' + r.name + ' · ' + r.width + '×' + r.height);
      }).catch(function (err) {
        console.error(err);
        toast('Скриншот не получился: ' + err.message);
      }).then(function () { btn.disabled = false; btn.textContent = '📷 Скриншот персонажа'; });
    });
  }

  /* ================= события главного экрана ================= */

  function bind() {
    $('#modalBody').addEventListener('keydown', function (e) {
      var tg = e.target.closest && e.target.closest('[data-ab-toggle]');
      if (tg && e.target === tg && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tg.click(); }
    });
    $('#modalBody').addEventListener('click', function (e) {
      var im = e.target.closest('img.ab-img'); if (im) { im.classList.toggle('zoom'); return; }
      var allb = e.target.closest('[data-ab-all]');
      if (allb) { var on = allb.getAttribute('data-ab-all') === '1'; R.derived.abilities.forEach(function (x) { abOpen[ch.id + ':' + x.id] = on; }); renderModal(); return; }
      var tg = e.target.closest('[data-ab-toggle]');
      if (tg && !e.target.closest('[data-tip]')) { abOpen[tg.getAttribute('data-ab-toggle')] = tg.getAttribute('aria-expanded') !== 'true'; renderModal(); return; }   // переключатель режима внутри вкладки «Способности»
      var b = e.target.closest('button[data-abmode]'); if (!b) return;
      view.mode = b.getAttribute('data-abmode'); renderAll();
    });
    $('#modeSwitch').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mode]'); if (!b) return;
      view.mode = b.dataset.mode; renderAll();
    });
    $('#modeSwitch').addEventListener('keydown', function (e) {
      var modes = ['base', 'passive', 'active'], i = modes.indexOf(view.mode);
      if (e.key === 'ArrowRight') i = Math.min(2, i + 1); else if (e.key === 'ArrowLeft') i = Math.max(0, i - 1); else return;
      view.mode = modes[i]; renderAll(); $('#modeSwitch button[data-mode=' + view.mode + ']').focus();
    });
    $('#woundAdd').addEventListener('click', function () { view.wounds.push({ degree: $('#woundDegree').value, stat: $('#woundStat').value, enabled: true }); renderAll(); });
    $('#woundDegree').addEventListener('change', function () { $('#woundStat').disabled = !!degreeById(this.value).all; });
    $('#woundsClear').addEventListener('click', function () { view.wounds = []; renderAll(); });
    $('#woundList').addEventListener('change', function (e) {
      var i = e.target.getAttribute('data-wi'); if (i === null) return;
      view.wounds[+i].enabled = e.target.checked; renderAll();
    });
    $('#woundList').addEventListener('click', function (e) {
      var x = e.target.closest('[data-wx]'); if (!x) return;
      e.preventDefault(); view.wounds.splice(+x.getAttribute('data-wx'), 1); renderAll();
    });
    $('#limitCard').addEventListener('input', function (e) {
      if (e.target.id !== 'testBuff') return;
      view.testBuff = +e.target.value;
      if (view.testBuff > 0 && view.mode !== 'active') view.mode = 'active';
      R = compute(); renderModeSwitch(); renderStats(); renderDerived(); renderStrikes(); updateLimitInPlace();
      if (figure) figure.setState({ mode: view.mode, limitLevel: R.derived.limit.worst.zone.level });
    });
    $('#limitCard').addEventListener('change', function (e) {
      if (e.target.id === 'testSource') { view.testSource = e.target.value; renderAll(); }
      if (e.target.id === 'testBuff') renderAll();
    });
    $('#dock').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) openModal(b.dataset.tab); });
    $('#modal').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeModal();
      if (e.target.closest('[data-wi-add]')) {
        var pct = parseFloat($('#wPct').value);
        if (!isFinite(pct) || pct <= 0) { toast('Укажи процент больше нуля'); $('#wPct').focus(); return; }
        var st = $('#wStat').value, sc = RULES.modifiers[st] && RULES.modifiers[st].scoped;
        calcState.whatIf.push({ stat: st, percent: pct, type: $('#wType').value, layer: $('#wLayer').value, mode: $('#wMode').value, source: $('#wSource').value, scope: sc ? $('#wScope').value : 'all' });
        $('#wPct').value = ''; renderWhatIf(); return;
      }
      var wd = e.target.closest('[data-wi-del]'); if (wd) { calcState.whatIf.splice(+wd.getAttribute('data-wi-del'), 1); renderWhatIf(); return; }
      if (e.target.closest('[data-wi-clear]')) { calcState.whatIf = []; renderWhatIf(); return; }      if (e.target.closest('[data-open-editor]')) { closeModal(); openEditor(false); return; }
      var t = e.target.closest('[data-mtab]'); if (t) { currentTab = t.dataset.mtab; $('#modalBody').scrollTop = 0; renderModal(); }
      var p = e.target.closest('[data-preset]'); if (p) { calcState.target = +p.dataset.preset; $('#cTarget').value = calcState.target; updateCalcs(); }
    });
    $('#modal').addEventListener('input', function (e) {
      var id = e.target.id, v = parseFloat(e.target.value);
      var map = { cTarget: 'target', cEnemy: 'enemyKmh', cDist: 'dist', cStart: 'startSt', cPass: 'passengers', cArea: 'area', cVol: 'volume', cCur: 'curSt', cRatio: 'speedRatio' };
      if (map[id]) { if (isFinite(v)) { calcState[map[id]] = v; updateCalcs(); } return; }
      if (id === 'cStrike' || id === 'cZone') { calcState[id === 'cStrike' ? 'strike' : 'zone'] = e.target.value; updateCalcs(); }
    });
    $('#modalTabs').addEventListener('keydown', function (e) {
      var i = TABS.map(function (t) { return t.id; }).indexOf(currentTab);
      if (e.key === 'ArrowRight') i = (i + 1) % TABS.length; else if (e.key === 'ArrowLeft') i = (i + TABS.length - 1) % TABS.length; else return;
      currentTab = TABS[i].id; renderModal(); $('#modalTabs button[aria-selected=true]').focus();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#editor').hidden) closeEditor(); else if (!$('#modal').hidden) closeModal();
    });
    bindShot();
    $('#charSelect').addEventListener('change', function () { selectCharacter(this.value); });
    $('#btnEdit').addEventListener('click', function () { if (ch && canEdit(ch)) openEditor(false); });
    $('#btnNew').addEventListener('click', function () {
      if (!ch) return;
      if (Remote && !Remote.user()) { needLogin(); return; }
      openEditor(true);
    });
    $('#btnAuth').addEventListener('click', function () {
      if (!Remote) return;
      if (Remote.user()) Remote.signOut().then(function () { location.reload(); });
      else Remote.signIn().catch(function (err) { toast('Не удалось войти: ' + err.message); });
    });
  }

  /* ================= старт ================= */

  function start() {
    if (!RULES || !E) {
      document.body.innerHTML = '<p style="padding:40px;color:#e9d5ff;font-family:sans-serif">Не удалось загрузить data/rules.js или движок.</p>';
      return;
    }
    Object.keys(RULES.stats).forEach(function (k) { STAT_LABEL[k] = RULES.stats[k].label; });
    Object.keys(RULES.modifiers).forEach(function (k) { STAT_LABEL[k] = RULES.modifiers[k].label; });
    initTips();
    buildWoundControls();
    bind();
    bindEditor();
    figure = window.RPFigure ? window.RPFigure.init({ canvas: $('#figureCanvas'), fallback: $('#figureFallback'), stage: $('#stage') }) : null;

    var ready = Remote ? Remote.init().catch(function (e) { console.warn('Supabase: не удалось восстановить вход', e); }) : Promise.resolve();
    ready.then(function () {
      renderAuth();
      var rh = Remote ? Remote.returnHash() : '';
      if (rh && !location.hash) { try { history.replaceState(null, '', location.pathname + location.search + rh); } catch (e) { /* file:// */ } }
      return Store.all().catch(function (err) {
        if (!Remote) throw err;
        toast('Сервер недоступен: ' + err.message + '. Показаны примеры.');
        return [];
      });
    }).then(function (list) {
      if (Remote) return list.length ? list.map(normalize) : demoList();
      if (!list.length) {
        // первый запуск (или хранилище очищено): стартовые персонажи из data/characters.js
        list = SEED.map(function (c, i) { return Object.assign(normalize(clone(c)), { createdAt: i }); });
        if (!list.length) list = [Object.assign(blankCharacter(), { id: makeId('hero'), name: 'Новый герой' })];
        return Promise.all(list.map(Store.put)).then(function () { return list; });
      }
      return list.map(normalize);
    }).then(function (list) {
      chars = list.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      var fromHash = decodeURIComponent(location.hash.replace('#', ''));
      selectCharacter(chars.some(function (c) { return c.id === fromHash; }) ? fromHash : chars[0].id);
      var q = new URLSearchParams(location.search);
      if (RULES.modes[q.get('mode')]) { view.mode = q.get('mode'); renderAll(); }
      if (TABS.some(function (t) { return t.id === q.get('tab'); })) openModal(q.get('tab'));
      if (q.get('edit') === '1' && canEdit(ch)) openEditor(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
