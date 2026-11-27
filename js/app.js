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
  var Util = window.RPUtil, $ = Util.$, $$ = Util.$$, fmt = Util.fmt, esc = Util.esc, tipAttr = Util.tipAttr, clone = Util.clone, toast = Util.toast, cap = Util.cap, ICON = Util.ICON;
  var Model = window.RPModel, blankCharacter = Model.blankCharacter, normalize = Model.normalize, upgradeBuff = Model.upgradeBuff, normAbility = Model.normAbility, normList = Model.normList,
    normAlloc = Model.normAlloc, ALLOC_KEYS = Model.ALLOC_KEYS, ALLOC_LABEL = Model.ALLOC_LABEL, makeBuffId = Model.makeBuffId, makeId = Model.makeId, cleanDraft = Model.cleanDraft;
  var LocalStore = window.RPLocalStore, AbView = window.RPAbilitiesView;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================= форматирование ================= */

  /* названия параметров для подписей бонусов; заполняется в start() */
  var STAT_LABEL = { all: 'Все физические' };


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

  /* ================= хранилище ================= */

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
  /** Пустой шаблон для первого запуска: вместо готового персонажа — подсказки, что куда вписывать. */
  function templateCharacter() {
    var c = blankCharacter();
    c.id = makeId('hero'); c.name = 'Новый герой'; c.createdAt = 0;
    c.attribute.name = 'Название атрибута';
    c.attribute.description = 'Опиши способность атрибута своими словами.';
    return c;
  }
  function demoList() { return SEED.map(function (c, i) { return Object.assign(normalize(clone(c)), { createdAt: i }); }); }

  /* ================= модель персонажа ================= */

  /* ================= состояние ================= */

  var chars = [];
  var firstRun = false;
  var ch = null;
  var view = { mode: 'base', wounds: [], testBuff: 0, testSource: 'external', posts: 0 };
  var R = null;
  var figure = null;
  var prevVals = {};

  function viewKey() { return 'rp-view:' + ch.id; }
  function saveView() { try { localStorage.setItem(viewKey(), JSON.stringify({ mode: view.mode, wounds: view.wounds, posts: view.posts })); } catch (e) { /* ок */ } }
  function loadView() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(viewKey()) || 'null'); } catch (e) { s = null; }
    view.mode = (s && RULES.modes[s.mode]) ? s.mode : 'base';
    view.wounds = (s && s.wounds) || [];
    view.posts = Math.max(0, Math.floor((s && s.posts) || 0));
    view.testBuff = 0;
  }
  function compute(mode) {
    return E.compute(ch, RULES, { mode: mode || view.mode, wounds: view.wounds, posts: view.posts, testBuff: view.testBuff ? { percent: view.testBuff, source: view.testSource } : null });
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

  /**
   * Диаграмма-профиль: 6 физических статов, каждый — во сколько раз выше стартового значения нового персонажа
   * (реакция — наоборот: во сколько раз быстрее). Шкала логарифмическая, кольца ×1, ×2, ×5, ×10…
   * Заливка — текущий режим, пунктир — базовые статы.
   */
  var RADAR_KEYS = [['punch', 'Удар'], ['lift', 'Подъём'], ['speed', 'Скорость'], ['reaction', 'Реакция'], ['durability', 'Прочность'], ['stamina', 'Стамина']];
  var radarRef = null;
  function radarVals(res) {
    if (!radarRef) { var b = E.compute(blankCharacter(), RULES, { mode: 'base' }); radarRef = { punch: b.stats.punch.value, lift: b.stats.lift.value, speed: b.stats.speed.value, reaction: b.stats.reaction.value, stamina: b.stats.stamina.value, durability: b.derived.durability.value }; }
    return RADAR_KEYS.map(function (kv) {
      var k = kv[0], v = k === 'durability' ? res.derived.durability.value : res.stats[k].value, ref = radarRef[k];
      var ratio = k === 'reaction' ? (v > 0 ? ref / v : 1000) : (ref ? v / ref : 1);
      return { key: k, label: kv[1], value: v, ratio: Math.max(ratio, 1e-3), unit: k === 'durability' ? 'кг' : RULES.stats[k].unit, ref: ref };
    });
  }
  function renderRadar() {
    var box = $('#radar'); if (!box) return;
    var cur = radarVals(R), base = view.mode === 'base' ? null : radarVals(compute('base'));
    var all = cur.concat(base || []), mx = Math.max.apply(null, all.map(function (x) { return x.ratio; }));
    var NICE = [2, 3, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000], hi = 2;
    NICE.some(function (v) { hi = v; return v >= mx * 1.05; });
    var lo = 0.5, L = function (r) { return Math.max(0, Math.min(1, (Math.log(r) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)))); };
    var S = 240, C = S / 2, Rr = 84, n = RADAR_KEYS.length;
    function pt(i, f) { var a = -Math.PI / 2 + i * 2 * Math.PI / n; return [C + Math.cos(a) * Rr * f, C + Math.sin(a) * Rr * f]; }
    function poly(vals) { return vals.map(function (x, i) { var p = pt(i, Math.max(0.03, L(x.ratio))); return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }
    var rings = [1].concat(NICE.filter(function (v) { return v < hi; })).concat([hi]);
    if (rings.length > 5) rings = rings.filter(function (v, i) { return i === 0 || i === rings.length - 1 || [10, 100, 1000].indexOf(v) !== -1; });
    var svg = '<svg viewBox="0 0 ' + S + ' ' + S + '" role="img" aria-label="Профиль статов">';
    rings.forEach(function (r) {
      var f = L(r); svg += '<polygon class="rg' + (r === 1 ? ' one' : '') + '" points="' + RADAR_KEYS.map(function (kv, i) { var p = pt(i, f); return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>';
      var lp = pt(0, f); svg += '<text class="rl" x="' + (lp[0] + 4).toFixed(1) + '" y="' + (lp[1] + 3).toFixed(1) + '">×' + r + '</text>';
    });
    RADAR_KEYS.forEach(function (kv, i) { var p = pt(i, 1); svg += '<line class="ax" x1="' + C + '" y1="' + C + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '"/>'; });
    if (base) svg += '<polygon class="pb" points="' + poly(base) + '"/>';
    svg += '<polygon class="pc" points="' + poly(cur) + '"/>';
    cur.forEach(function (x, i) {
      var p = pt(i, Math.max(0.03, L(x.ratio))), lp = pt(i, 1.27), anchor = Math.abs(lp[0] - C) < 6 ? 'middle' : lp[0] > C ? 'start' : 'end';
      var tip = tipAttr(x.label, null, '<b>' + fmt(x.value, x.key === 'reaction' || x.key === 'speed' ? 1 : 0) + ' ' + esc(x.unit) + '</b> — ×' + fmt(x.ratio, 2) + (x.key === 'reaction' ? ' быстрее' : '') + ' относительно старта (' + fmt(x.ref, 0) + ' ' + esc(x.unit) + ')' + (base ? '<br>База: ' + fmt(base[i].value, x.key === 'reaction' || x.key === 'speed' ? 1 : 0) + ' ' + esc(x.unit) + ' (×' + fmt(base[i].ratio, 2) + ')' : ''));
      svg += '<g class="rp"' + tip + '><circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.2"/><text class="lb" x="' + lp[0].toFixed(1) + '" y="' + (lp[1] - 2).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(x.label) + '</text><text class="lv" x="' + lp[0].toFixed(1) + '" y="' + (lp[1] + 10).toFixed(1) + '" text-anchor="' + anchor + '">×' + fmt(x.ratio, x.ratio < 10 ? 1 : 0) + '</text></g>';
    });
    box.innerHTML = svg + '</svg>' + (base ? '<div class="radar-key"><span class="k cur"></span>' + esc(R.modeLabel) + '<span class="k base"></span>Базовые</div>' : '');
  }
  /** Постепенные бафы: счётчик постов боя (виден, только если у персонажа есть такие бафы). */
  function renderPosts() {
    var box = $('#postCtl'), G = R.derived.gradual;
    if (!box) return;
    if (!G.list.length) { box.hidden = true; return; }
    box.hidden = false;
    var open = false; try { open = localStorage.getItem('rp-posts-open') === '1'; } catch (e) { /* ок */ }
    box.classList.toggle('collapsed', !open);
    var STAT_L = {}; STAT_OPTS.forEach(function (o) { STAT_L[o[0]] = o[1]; });
    box.innerHTML = '<div class="post-h"><span>Пост боя</span><div class="post-step"><button type="button" data-post="-1" aria-label="Пост назад"' + (view.posts ? '' : ' disabled') + '>−</button><b>' + view.posts + '</b><button type="button" data-post="1" aria-label="Следующий пост">+</button></div>' +
      (view.posts ? '<button type="button" class="post-reset" data-post="0" title="Новый бой: сбросить посты">сброс</button>' : '') +
      '<button type="button" class="post-fold" data-post-fold aria-expanded="' + open + '" title="' + (open ? 'Свернуть' : 'Показать бафы') + '">' + (open ? '' : G.list.length + ' ' + (G.list.length === 1 ? 'бафф' : G.list.length < 5 ? 'бафа' : 'бафов') + ' ') + '<span aria-hidden="true">▾</span></button></div>' +
      G.list.map(function (g) {
        var pct = g.max > 0 ? Math.min(1, g.now / g.max) : 0;
        return '<div class="post-row' + (g.full ? ' full' : '') + '"' + tipAttr(g.label || 'Постепенный бафф', null, (g.type === 'debuff' ? 'Дебафф ' : 'Бафф ') + esc((STAT_L[g.stat] || g.stat).toLowerCase()) + ': ' + fmt(g.per, 1) + '% за каждый пост боя' + (g.max > 0 ? ', максимум ' + fmt(g.max, 1) + '%' : '') + '.<br>Сейчас пост ' + g.posts + ': <b>' + fmt(g.now, 1) + '%</b>.' + (G.active ? '' : '<br>В режиме «Базовые» не учитывается.')) + '>' +
          '<div class="post-l"><b>' + esc(g.label || 'Постепенный') + '</b><small>' + esc(STAT_L[g.stat] || g.stat) + '</small></div>' +
          '<div class="post-v">' + (g.type === 'debuff' ? '−' : '+') + fmt(g.now, 1) + '%' + (g.max > 0 ? '<small> / ' + fmt(g.max, 1) + '%</small>' : '') + '</div>' +
          (g.max > 0 ? '<div class="post-bar"><i style="width:' + (pct * 100) + '%"></i></div>' : '') + '</div>';
      }).join('') +
      (G.active ? '' : '<div class="post-note">В режиме «Базовые» постепенные бафы не учитываются — переключись на «Пассивные» или «Активные».</div>');
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
      '<details class="test-buff"' + (testOpen || view.testBuff ? ' open' : '') + '><summary>Проверить чужой бафф на все физ. статы <output>+' + view.testBuff + '%</output></summary>' +
      '<div class="row2"><input type="range" id="testBuff" min="0" max="500" step="10" value="' + view.testBuff + '" aria-label="Тестовый бафф, %">' +
      '<select id="testSource" aria-label="Источник"><option value="external"' + (view.testSource === 'external' ? ' selected' : '') + '>внешний</option><option value="artifact"' + (view.testSource === 'artifact' ? ' selected' : '') + '>артефакт</option></select></div></details>';
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
  /** Строка про лимит системы статусов для тултипа. */
  function capNote(key) {
    var c = (RULES.statusCaps || {})[key]; if (!c) return '';
    return '<div class="tt-sub">Лимит системы статусов</div><div>Бафы ×' + fmt(c.buff, 1) + (c.extBuff ? ', внешний ещё ×' + fmt(c.extBuff, 1) : '') + ' (всего до ×' + fmt(c.buffTotal, 1) + '); дебафы ÷' + fmt(c.debuff, 1) + ', с внешним ÷' + fmt(c.debuffTotal, 1) + '.</div>';
  }
  function powerTipHtml(m) {
    var def = RULES.modifiers[m.key], hit = Object.keys(m.scopes).some(function (sc) { return m.scopes[sc].capped; });
    return '<div>' + esc(def.desc) + '</div>' + (hit ? '<div class="cap-hit">⚠ Упёрлось в лимит статусов — лишние бафы не действуют.</div>' : '') + capNote(m.key) + Object.keys(RULES.scopes).map(function (sc) {
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

  /** Компактная строка для второстепенных параметров. */
  function drow(label, value, unit, sub, title, formula, extra, cls) {
    return '<div class="drow' + (cls ? ' ' + cls : '') + '"' + tipAttr(title || label, formula, extra) + '><span class="drl">' + esc(label) + '</span><span class="drv">' + value + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</span>' + (sub ? '<span class="drs">' + sub + '</span>' : '') + '</div>';
  }
  var dmoreOpen = true, testOpen = false;

  function renderDerived() {
    var d = R.derived, mt = d.meleeTiming, sm = d.stamina;
    // главное: прочность крупно, рядом два боевых показателя
    var main = [
      dcell('Прочность', fmt(d.durability.value, 0), 'кг', d.durability.capped ? '<span class="cap-hit">⚠ лимит статусов</span>' : 'сила удара × 3', 'Прочность', d.durability.formula, (d.durability.capped ? '<div class="cap-hit">⚠ Упёрлось в лимит статусов: без лимита было бы ' + fmt(d.durability.capped.before, 0) + ' кг.</div>' : '') + 'Минимум без индивидуального дебаффа: ' + d.durability.min + ' кг (до множителя прочности).' + chainHtml(d.durability.chain, 'кг', 0) + capNote('durability'), 'hero'),
      dcell('Скорость атаки', fmt(d.attackSpeed.kmh), 'км/ч', fmt(d.attackSpeed.ms, 2) + ' м/с', 'Скорость атаки', d.attackSpeed.formula, 'Скорость × ' + d.attackSpeed.multiplier + (d.attackSpeed.multiplier !== RULES.speed.attackMultiplier ? ' (одарённость)' : ''), 'key'),
      dcell('Взрывная сила', fmt(d.explosive.value, 0), 'кг', 'за ' + fmt(d.explosive.timeMs) + ' мс', 'Взрывная сила', d.explosive.formula + '; ' + d.explosive.timeFormula, 'Подъём × 2. Достигается за ½ реакции, но не дольше 100 мс.', 'key')
    ];
    var more = [
      drow('Скорость', fmt(d.speed.kmh), 'км/ч', fmt(d.speed.ms, 2) + ' м/с', 'Скорость', d.speed.formula, 'Разгон: ' + esc(d.accel.formula)),
      drow('Давление (ладонь)', fmt(d.pressure.value, 2), 'кг/см²', 'потолок ' + fmt(d.pressure.cap) + ' кг/см²', 'Давление', d.pressure.formula, 'Подъём ÷ площадь (ладонь ' + RULES.lift.palmAreaCm2 + ' см²). Максимум ×4 от подъёма.'),
      drow('Подъём ногами', fmt(d.liftLegs.value, 0), 'кг', 'без конечности: ' + fmt(d.liftOneLimb.value, 0) + ' кг', 'Подъём', d.liftLegs.formula + '; ' + d.liftOneLimb.formula),
      drow('Разгон', fmt(d.accel.effectiveStart), 'км/ч', d.accel.instantMax ? 'сразу максимум · ' + d.accel.distanceM + ' м' : 'старт · ' + d.accel.distanceM + ' м до макс.', 'Стартовая скорость разгона', d.accel.formula),
      drow('Своя атака вблизи', fmt(mt.attackTimeMs, 0), 'мс', 'свободно ' + fmt(mt.freeMs, 0) + ' мс', 'Время атаки на 2 м', mt.formula, 'Ближний бой (≤ 2 м) считается на 2 м. Каст способности = реакция (' + fmt(R.stats.reaction.value) + ' мс).'),
      sm && sm.hasUpkeep ? drow('Атрибут: запас', sm.minutesToCritical + '–' + sm.minutesTo0, 'мин', 'до 10% / до 0%', 'Сколько продержит способность', sm.formulaC + ' · ' + sm.formula0, 'Вход ' + esc(sm.formulaEntry) + ', поддержание −' + fmt(sm.upkeep, 2) + '% каждые ' + sm.interval + ' мин. На 10% персонаж теряет сознание.') : '',
      drow('Бег по воде', d.water.available ? 'доступен' : 'недоступен', '', d.water.available ? '' : 'не хватает ' + fmt(d.water.deficitMs, 2) + ' м/с (' + fmt(d.water.deficitKmh, 0) + ' км/ч)', 'Бег по воде', d.water.formula, 'От 40 м/с; при массе > 100 кг — 50 м/с и +50 м/с за каждые следующие 100 кг.', d.water.available ? '' : 'locked')
    ];
    $('#derivedGrid').innerHTML = main.join('') +
      '<details class="dmore"' + (dmoreOpen ? ' open' : '') + '><summary>Ещё параметры <small>' + more.filter(Boolean).length + '</small></summary><div class="dlist">' + more.join('') + '</div></details>';
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
    var gf = R.derived.gift;
    $('#giftChips').innerHTML = gf.key ? '<span class="chip gift"' + tipAttr(gf.label, null, esc(gf.desc) + '<br>' + gf.pros.map(function (s) { return '+ ' + esc(s); }).join('<br>') + (gf.cons.length ? '<br>' + gf.cons.map(function (s) { return '− ' + esc(s); }).join('<br>') : '')) + '><b>' + esc(gf.short) + '</b><span class="ct">одарённость</span></span>' : '<span class="empty-note">Не выбрана — выбери в форме персонажа.</span>';
    var traits = (ch.traits || []).filter(function (t) { return t.name; });
    $('#traitChips').innerHTML = traits.length ? traits.map(function (t) {
      return '<span class="chip"' + tipAttr(t.name, null, t.description ? esc(t.description) : '<span style="color:var(--text-3)">Описание не указано</span>') + '>' + esc(t.name) + '</span>';
    }).join('') : '<span class="empty-note">Трейтов нет.</span>';
    $('#traitCount').textContent = traits.length + (RULES.maxTraits ? ' / ' + RULES.maxTraits : '');
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
    renderRadar();
    renderPosts();
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
  function tabAbilities() { return AbView.render({ R: R, ch: ch, view: view, canEdit: canEdit, abOpen: abOpen }); }
  function tabCalc() {
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
      '<h3 style="margin-top:28px">Сводка: лучшая степень по целям</h3><div class="table-wrap" id="cMatrix"></div></div>' +
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
    var A = compute(wiMode()), B = E.compute(alt, RULES, { mode: wiMode(), wounds: view.wounds, posts: view.posts, testBuff: view.testBuff ? { percent: view.testBuff, source: view.testSource } : null });
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
  var STAT_OPTS = [['punch', 'Сила удара'], ['lift', 'Подъём'], ['speed', 'Скорость'], ['reaction', 'Реакция'], ['stamina', 'Стамина'], ['all', 'Все статы'], ['attrPower', 'Сила атрибута'], ['artPower', 'Сила боевого искусства'], ['durability', 'Прочность (множитель)']];
  var SRC_OPTS = [['', '— не важно'], ['attribute', 'Атрибут'], ['trait', 'Трейт'], ['style', 'Стиль'], ['artifact', 'Артефакт'], ['external', 'Внешний']];
  var TYPE_OPTS = [['buff', 'Баф (×)'], ['debuff', 'Дебафф (÷)']];
  var LAYER_OPTS = [['internal', 'Внутренний'], ['external', 'Внешний']];
  var SECTORS = [
    { key: 'attribute', label: 'Атрибут', hint: 'бафы от атрибута и его режимов' },
    { key: 'trait', label: 'Трейты', hint: 'бонусы и дебаффы трейтов' },
    { key: 'style', label: 'Стиль', hint: 'боевое искусство и его приёмы' },
    { key: 'artifact', label: 'Артефакты', hint: 'свои артефакты · могут превысить предел' },
    { key: 'external', label: 'Внешний', hint: 'саппорты, враги, аномалии · могут превысить предел' }
  ];
  var SCOPE_OPTS = [['all', 'Все аспекты'], ['radius', 'Радиус'], ['power', 'Мощность'], ['speed', 'Скорость']];

  function opts(list, val) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (String(val || '') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function inp(path, val, type, attrs) {
    return '<input data-f="' + path + '" type="' + (type || 'text') + '" value="' + esc(val === null || val === undefined ? '' : val) + '"' + (attrs || '') + '>';
  }
  function fld(label, control, hint) { return '<label class="field">' + esc(label) + control + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</label>'; }

  /** Облегчённый режим: выбор пользователя; если не выбирал — включаем сами на устройствах с ≤ 2 ГБ памяти. */
  function liteOn() {
    var v = null; try { v = localStorage.getItem('rp-lite'); } catch (e) { /* ок */ }
    if (v === '1') return true; if (v === '0') return false;
    return !!(navigator.deviceMemory && navigator.deviceMemory <= 2);
  }
  if (liteOn()) document.documentElement.classList.add('lite');
  /** Вкладки формы: общая информация, способности, бафы и дебафы. */
  var edTab = 'general';
  function showEdTab() {
    $$('#editorBody .ed-grid > section').forEach(function (sec) { sec.hidden = (sec.getAttribute('data-etab') || 'general') !== edTab; });
    $$('#edTabs [data-etab]').forEach(function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-etab') === edTab ? 'true' : 'false');
      var c = b.querySelector('.cnt'); if (!c || !draft) return;
      var nb = {}; (draft.buffs || []).forEach(function (x) { nb[x.group || x.id] = 1; });
      c.textContent = b.getAttribute('data-etab') === 'abilities' ? (draft.abilities || []).length : Object.keys(nb).length;
    });
  }
  function setEdTab(t) { edTab = t; showEdTab(); $('#editorBody').scrollTop = 0; }
  function openEditor(isNew) {
    editingNew = !!isNew;
    draft = isNew ? blankCharacter() : clone(ch);
    edTab = 'general';
    $('#editorTitle').textContent = isNew ? 'Новый персонаж' : 'Персонаж · ' + (ch.name || '');
    $('#btnDelete').hidden = isNew;
    var noDel = Remote ? !ch.ownerId : chars.length <= 1;
    $('#btnDelete').disabled = noDel;
    $('#btnDelete').title = noDel ? (Remote ? 'Этого персонажа нет на сервере' : 'Нельзя удалить последнего персонажа') : '';
    $('#btnExport').hidden = isNew;
    renderEditor();
    draftSnap = JSON.stringify(draft);
    $('#editor').hidden = false;
    document.body.style.overflow = 'hidden';
    var first = $('#editorBody input'); if (first) first.focus();
  }
  function closeEditor() { $('#editor').hidden = true; draft = null; draftSnap = null; document.body.style.overflow = ''; hideTip(); }
  /** Есть ли в форме несохранённые правки (сравниваем с тем, что было при открытии). */
  var draftSnap = null;
  function editorDirty() { return !!draft && draftSnap !== null && JSON.stringify(draft) !== draftSnap; }
  /** Закрыть форму по ✕, «Отмена», Esc или клику мимо — с вопросом, если есть несохранённые правки. */
  function askCloseEditor() {
    if (editorDirty() && !confirm('В форме есть несохранённые изменения. Закрыть без сохранения?')) return;
    closeEditor();
  }

  function pcEditor(a, base, i) {
  function col(kind, title, ph) {
    var items = a[kind] || [];
    return '<div class="ab-pc-col"><div class="hint">' + title + '</div>' + items.map(function (s, k) {
      return '<div class="row pc-row"><textarea data-f="' + base + kind + '.' + k + '" rows="2" placeholder="' + ph + '" aria-label="' + title + '">' + esc(s) + '</textarea><button type="button" class="x" data-del-pc="' + i + '.' + kind + '.' + k + '" aria-label="Удалить">✕</button></div>';
    }).join('') + '<button type="button" class="mini-btn add" data-add-pc="' + i + '.' + kind + '">+ ' + (kind === 'pros' ? 'плюс' : 'минус') + '</button></div>';
  }
  return '<div class="ab-pc-edit">' + col('pros', 'Плюсы', 'Что способность даёт. Числа — метками, как в описании') + col('cons', 'Минусы', 'Ограничения и цена') + '</div>';
}
/** Пул AP способности в форме: у олицетворения — полные тысячи общего AP после получения; подспособности из счётчика стоят по шагу. */
function abPool(a) {
  var pers = a.persona === true && !a.parentId, R = pers ? E.personaRules(RULES) : RULES, U = R.abilities.upgrade;
  var pool = pers ? E.personaPool(draft ? draft.ap : 0, a.personaAp, RULES) : parseFloat(a.ap) || 0;
  return { persona: pers, rules: R, U: U, pool: pool, sub: Math.max(0, Math.floor(parseFloat(a.subCount) || 0)) * U.stepAp };
}
function upgItems(a) { return E.scanUpgradable(a, abPool(a).rules); }
/** Итог прокачки в форме: сколько AP ушло (считается из «было → стало»), сколько свободно. */
function allocHint(a) {
  var P = abPool(a), U = P.U, items = upgItems(a), spent = 0, parts = [];
  items.forEach(function (it) { spent += it.cost; if (it.cost > 0) parts.push(esc(it.label.toLowerCase()) + ' ' + (it.kind === 'temp' ? (it.pool === 'cold' ? '−' : '+') + fmt(Math.abs(it.gain), 1) + ' °C' : '+' + fmt(it.gain, 1) + '%') + ' (' + fmt(it.cost, 0) + ' AP)'); });
  var used = spent + P.sub, left = P.pool - used, st = U.stepAp, eps = 1e-6;
  var eq = function (x) { var k = x / st; return '+' + fmt(k * U.physPercentPerStep, 1) + '% к стату или счётчику, или +' + fmt(k * U.statusPercentPerStep, 1) + '% к баффу / дебаффу, или +' + fmt(k * U.heatPerStep, 0) + ' °C'; };
  return (P.persona ? 'Доступно <b>' + fmt(P.pool, 0) + ' AP</b> (' + fmt(P.pool / st, 0) + ' усил. по ' + fmt(st, 0) + ')' : 'AP способности: <b>' + fmt(P.pool, 0) + '</b>') +
    ' · вложено <b>' + fmt(used, 1) + '</b>' + (P.sub ? ' (подспособности ' + fmt(P.sub, 0) + ')' : '') + '. ' +
    (Math.abs(left) < eps ? '<b>Всё распределено.</b>' : left > 0 ? 'Свободно <b>' + fmt(left, 1) + ' AP</b> = ' + eq(left) + '.' : '<b class="bad">Перебор ' + fmt(-left, 1) + ' AP</b> (' + eq(-left).replace(/\+/g, '') + ').') +
    (parts.length ? '<br>Прокачано: ' + parts.join(', ') : '');
}
/** Прокачка: каждое число способности — «было → стало»; сколько это стоит в AP, сайт считает сам. */
function allocEditor(a, base, i) {
  var P = abPool(a), U = P.U, items = upgItems(a);
  var head = '<div class="hint">Меняй <b>«стало»</b> — сайт сам посчитает, сколько AP на это ушло. За ' + U.stepAp + ' AP: +' + U.physPercentPerStep + '% к стату или счётчику, +' + U.statusPercentPerStep + '% к баффу / дебаффу, +' + U.heatPerStep + ' °C / −' + U.coldPerStep + ' °C, +' + U.distancePercentPerStep + '% к расстоянию от начального.' + (a.parentId ? ' В подспособности число — доля от стата родителя (0,5 = половина).' : '') + '</div>';
  if (!items.length) return '<div class="ab-alloc">' + head + '<div class="hint">В описании нет чисел для прокачки: добавь метку <code>{сила 50%}</code>, эффект <code>{дебафф 40%}</code>, температуру <code>500 °C</code> или расстояние <code>10 м</code>.</div><div class="ab-alloc-hint">' + allocHint(a) + '</div></div>';
  var rows = items.map(function (it, j) {
    var u = it.kind === 'tag' ? it.unit : it.kind === 'temp' ? '°C' : esc(it.unit);
    var g = Math.abs(it.gain) < 1e-9 ? '<span class="hint">не прокачано</span>' : it.gain < 0 ? '<b class="bad">ниже исходного</b>' : (it.kind === 'temp' ? (it.pool === 'cold' ? '−' : '+') + fmt(Math.abs(it.gain), 1) + ' °C' : '+' + fmt(it.gain, 1) + '%') + ' = <b>' + fmt(it.cost, 1) + ' AP</b>';
    var inp2 = function (which, v) { return '<input type="number" step="any" inputmode="decimal" data-upg="' + i + '.' + j + '.' + which + '" value="' + (Math.round(v * 1000) / 1000) + '" aria-label="' + (which === 'from' ? 'было' : 'стало') + '">'; };
    return '<div class="upg-ed-row' + (it.cost > 0 ? ' on' : '') + '"><div class="ul"><b>' + esc(it.label) + '</b>' + (it.context ? '<small>' + esc(it.context) + '</small>' : '') + '</div>' +
      '<label class="uv"><small>было</small>' + inp2('from', it.from) + '<i>' + u + '</i></label><span class="ua">→</span>' +
      '<label class="uv to"><small>стало</small>' + inp2('to', it.to) + '<i>' + u + '</i></label><div class="uc">' + g + '</div></div>';
  }).join('');
  return '<div class="ab-alloc">' + head + '<div class="upg-ed">' + rows + '</div><div class="ab-alloc-hint">' + allocHint(a) + '</div></div>';
}
  function renderEditor() {
    var d = draft, body = $('#editorBody'), keep = body.scrollTop;
    var strikeOpts = [['', '— не указан']].concat(Object.keys(RULES.strike.types).map(function (k) { return [k, RULES.strike.types[k].label + ' ×' + RULES.strike.types[k].multiplier]; }));
    /* бафы по секторам: одарённость → атрибут × трейты × стиль × артефакты × внешний */
    function giftPicker() {
      var G = RULES.gifts || {}, cur = d.gift || '', g = G[cur] || G[''];
      var cards = Object.keys(G).filter(function (k) { return k; }).map(function (k) {
        return '<label class="gift-opt' + (k === cur ? ' on' : '') + '"><input type="radio" name="gift" value="' + k + '" data-f="gift"' + (k === cur ? ' checked' : '') + '><b>' + esc(G[k].short) + '</b><small>' + esc(G[k].tag || '') + '</small></label>';
      }).join('') + '<label class="gift-opt none' + (!cur ? ' on' : '') + '"><input type="radio" name="gift" value="" data-f="gift"' + (!cur ? ' checked' : '') + '><b>Нет</b><small>не выбрана</small></label>';
      var info = cur ? '<div class="gift-info"><p>' + esc(g.desc) + '</p>' +
        (g.pros || []).map(function (s) { return '<div class="ab-pc pro"><span class="ab-pc-i">+</span><div>' + esc(s) + '</div></div>'; }).join('') +
        (g.cons || []).map(function (s) { return '<div class="ab-pc con"><span class="ab-pc-i">−</span><div>' + esc(s) + '</div></div>'; }).join('') + '</div>' : '';
      return '<div class="gift-pick">' + cards + '</div>' + info;
    }
    function sectorOf(b) { return b.layer === 'external' ? 'external' : (SECTORS.some(function (s) { return s.key === b.source; }) ? b.source : 'other'); }
    function sectorSummary(list) {
      function line(mode) {
        var by = {};
        list.forEach(function (x) {
          var b = x.b, p = parseFloat(b.percent); if (b.mode !== mode || b.enabled === false || !isFinite(p) || !p) return;
          by[b.stat] = (by[b.stat] || 0) + (b.type === 'debuff' ? -p : p);
        });
        var keys = Object.keys(by);
        return keys.length ? keys.map(function (k) { var lbl = (STAT_OPTS.filter(function (o) { return o[0] === k; })[0] || [k, k])[1]; return esc(lbl) + ' <b>' + (by[k] > 0 ? '+' : '−') + fmt(Math.abs(by[k]), 1) + '%</b>'; }).join(', ') : '';
      }
      var ps = line('passive'), as = line('active');
      var gs = list.filter(function (x) { var p = parseFloat(x.b.percent); return x.b.mode === 'gradual' && x.b.enabled !== false && p; }).map(function (x) { var lbl = (STAT_OPTS.filter(function (o) { return o[0] === x.b.stat; })[0] || [x.b.stat, x.b.stat])[1]; return esc(lbl) + ' <b>' + (x.b.type === 'debuff' ? '−' : '+') + fmt(parseFloat(x.b.percent), 1) + '%</b>/пост' + (parseFloat(x.b.max) > 0 ? ' до ' + fmt(parseFloat(x.b.max), 1) + '%' : ''); }).join(', ');
      if (!ps && !as && !gs) return '';
      return '<div class="bsec-sum">' + (ps ? '<span><i>всегда</i> ' + ps + '</span>' : '') + (as ? '<span><i>в бою +</i> ' + as + '</span>' : '') + (gs ? '<span><i>постепенно</i> ' + gs + '</span>' : '') + '</div>';
    }
    function groupHtml(gid, rows) {
      var g0 = rows[0].b, mode = g0.mode === 'active' || g0.mode === 'gradual' ? g0.mode : 'passive';
      return '<div class="bgrp" data-group="' + esc(gid) + '">' +
        '<div class="bgrp-h"><input type="text" data-gname="' + esc(gid) + '" value="' + esc(g0.label || '') + '" placeholder="Название, например: Режим зверя" aria-label="Название эффекта">' +
        '<div class="seg" role="group" aria-label="Когда действует"><button type="button" data-gmode="' + esc(gid) + '" data-v="passive"' + (mode === 'passive' ? ' class="on"' : '') + ' title="Действует постоянно">Пассивный</button><button type="button" data-gmode="' + esc(gid) + '" data-v="active"' + (mode === 'active' ? ' class="on"' : '') + ' title="Включается в бою">Активный</button><button type="button" data-gmode="' + esc(gid) + '" data-v="gradual"' + (mode === 'gradual' ? ' class="on"' : '') + ' title="Растёт с каждым постом боя до максимума (режимы «Пассивные» и «Активные»)">Постепенный</button></div>' +
        '<button type="button" class="x" data-del-group="' + esc(gid) + '" aria-label="Удалить эффект">✕</button></div>' +
        rows.map(function (x) {
          var scoped = RULES.modifiers[x.b.stat] && RULES.modifiers[x.b.stat].scoped;
          return '<div class="brow">' +
            '<select data-f="buffs.' + x.i + '.stat" aria-label="Что бафает">' + opts(STAT_OPTS, x.b.stat) + '</select>' +
            (mode === 'gradual'
              ? '<div class="pct grad">' + inp('buffs.' + x.i + '.percent', x.b.percent, 'number', ' min="0" step="1" placeholder="20" aria-label="Процент за пост"') + '<span>% за пост, до</span>' + inp('buffs.' + x.i + '.max', x.b.max, 'number', ' min="0" step="1" placeholder="120" aria-label="Максимум, %"') + '<span>%</span></div>'
              : '<div class="pct">' + inp('buffs.' + x.i + '.percent', x.b.percent, 'number', ' min="0" step="1" placeholder="50" aria-label="Процент"') + '<span>%</span></div>') +
            '<select data-f="buffs.' + x.i + '.type" aria-label="Баф или дебафф">' + opts(TYPE_OPTS, x.b.type) + '</select>' +
            (scoped ? '<select data-f="buffs.' + x.i + '.scope" aria-label="Аспект">' + opts(SCOPE_OPTS, x.b.scope) + '</select>' : '<span></span>') +
            '<input type="checkbox" class="buff-on" data-f="buffs.' + x.i + '.enabled"' + (x.b.enabled === false ? '' : ' checked') + ' title="Бонус включён" aria-label="Включён">' +
            '<button type="button" class="x" data-del="buffs.' + x.i + '" aria-label="Удалить строку">✕</button></div>';
        }).join('') +
        '<button type="button" class="mini-btn add sm" data-add-row="' + esc(gid) + '">+ стат</button></div>';
    }
    function buffSectors() {
      var all = d.buffs.map(function (b, i) { return { b: b, i: i }; });
      var list = SECTORS.concat(all.some(function (x) { return sectorOf(x.b) === 'other'; }) ? [{ key: 'other', label: 'Прочее', hint: 'бонусы без источника из старых данных: каждый считается отдельным множителем' }] : []);
      return '<div class="bsec gift"><div class="bsec-h"><span class="bsec-n">1</span><b>Одарённость</b><small>выбирается одна из пяти, сама не редактируется; меняет базу до всех бафов</small></div>' + giftPicker() + '</div>' +
        list.map(function (s, si) {
          var mine = all.filter(function (x) { return sectorOf(x.b) === s.key; }), groups = [], byG = {};
          mine.forEach(function (x) { var g = x.b.group || x.b.id || ('i' + x.i); if (!byG[g]) { byG[g] = []; groups.push(g); } byG[g].push(x); });
          return '<div class="bsec"><div class="bsec-h"><span class="bsec-n">' + (si + 2) + '</span><b>' + esc(s.label) + '</b><small>' + esc(s.hint) + '</small></div>' +
            sectorSummary(mine) +
            (groups.length ? groups.map(function (g) { return groupHtml(g, byG[g]); }).join('') : '<div class="empty-note">Пусто.</div>') +
            (s.key !== 'other' ? '<button type="button" class="mini-btn add" data-add-group="' + s.key + '">+ эффект</button>' : '') + '</div>';
        }).join('');
    }    function abilityRows() {
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
        var isPers = a.persona === true && !depth, P = abPool(a), otherPers = !depth && !isPers && A.some(function (x) { return x.persona && !x.parentId && x !== a; });
        var persRow = depth ? '' : '<label class="chk ab-pers-chk"><input type="checkbox" data-f="' + base + 'persona"' + (isPers ? ' checked' : '') + (otherPers ? ' disabled' : '') + '> Олицетворение атрибута <span class="hint">' + (otherPers ? '(у персонажа уже есть олицетворение)' : '(одно на персонажа; прокачивается от общего AP, по ' + RULES.abilities.personaUpgrade.stepAp + ')') + '</span></label>';
        var out = '<div class="ab-edit' + (depth ? ' sub' : '') + (isPers ? ' persona' : '') + '">' +
          '<div class="ab-edit-h">' + (depth ? '<span class="ab-tag">подспособность</span>' : isPers ? '<span class="ab-tag persona">✦ олицетворение</span>' : '') + '<div class="row">' + inp(base + 'name', a.name, 'text', ' placeholder="' + (depth ? 'Название подспособности' : 'Название способности') + '" aria-label="Название"') + '<button type="button" class="x" data-del="abilities.' + i + '" aria-label="Удалить">✕</button></div>' + persRow + '</div>' +
          acc('desc', 'Описание',
            '<textarea data-f="' + base + 'description" rows="' + (depth ? 4 : 6) + '" placeholder="Описание. Число вставляй меткой, например: Скорость зеркала — {speed 910%} от скорости персонажа" aria-label="Описание">' + esc(a.description) + '</textarea>' +
            '<div class="row ab-marks"><span class="hint">выдели число в тексте:</span><button type="button" class="mini-btn" data-wrap="=" data-target="' + base + 'description" title="Число не будет расти от силы атрибута">🔒 не меняется</button>' +
            '<button type="button" class="mini-btn" data-wrap="~" data-target="' + base + 'description" title="Число без единицы тоже будет расти от силы атрибута">⚖ масштабировать</button></div>', true) +
          acc('pc', 'Плюсы и минусы <small>' + (nPc ? nPc + ' шт.' : 'нет') + '</small>', pcEditor(a, base, i), false) +
          acc('cost', 'Траты стамины <small>' + (costSum || 'не указаны') + (a.fixedCost ? ' · фиксированные' : '') + '</small>',
            '<div class="row3">' + fld('Призыв, % стамины', inp(base + 'entryCost', a.entryCost, 'number', ' min="0" step="any"')) + fld('Поддержание, %', inp(base + 'upkeepCost', a.upkeepCost, 'number', ' min="0" step="any"')) + fld('Период поддержания', inp(base + 'upkeepNote', a.upkeepNote, 'text', ' placeholder="за пост"')) + '</div>' +
            '<label class="chk"><input type="checkbox" data-f="' + base + 'fixedCost"' + (a.fixedCost ? ' checked' : '') + '> Фиксированные траты <span class="hint">(не снижаются от AP)</span></label>', false) +
          acc('up', 'Прокачка и AP <small>' + (function () { var sp = upgItems(a).reduce(function (t, x) { return t + x.cost; }, 0) + P.sub; return (isPers ? 'получено на ' + fmt(parseFloat(a.personaAp) || 0, 0) + ' AP · ' : '') + 'вложено ' + fmt(sp, 0) + ' из ' + fmt(P.pool, 0) + ' AP'; })() + (P.sub ? ' · подспособностей ' + fmt(P.sub / P.U.stepAp, 0) : '') + '</small>',
            '<div class="row">' + (isPers ? fld('Получено на общем AP', inp(base + 'personaAp', a.personaAp, 'number', ' min="0" step="100"')) : fld('AP, вложенные в способность', inp(base + 'ap', a.ap, 'number', ' min="0" step="10"'))) +
            fld('Подспособности от прокачки, шт.', inp(base + 'subCount', a.subCount, 'number', ' min="0" step="1"')) + '</div>' +
            '<div class="hint">' + (isPers ? 'Олицетворение усиливается за каждую полную тысячу общего AP персонажа после получения: сейчас общий AP ' + fmt(parseFloat(d.ap) || 0, 0) + ', значит доступно <b>' + fmt(P.pool, 0) + ' AP</b> (' + fmt(P.pool / P.U.stepAp, 0) + ' усил.). ' : '') +
            'Счётчик подспособностей: сколько подспособностей добавлено прокачкой. Каждая отнимает ' + fmt(P.U.stepAp, 0) + ' AP' + (isPers ? ' из доступных' : ' способности') + '; 0 — подспособности были изначально и AP не отнимают.</div>' +
            allocEditor(a, base, i), isPers) +
          acc('img', 'Картинки <small>' + (nImg ? nImg + ' шт.' : 'нет') + '</small>',
            '<div class="ab-imgs">' + (a.images || []).map(function (u, k) { return '<span class="ab-thumb"><img src="' + esc(u) + '" alt=""><button type="button" class="x" data-del-img="' + i + '.' + k + '" aria-label="Убрать картинку">✕</button></span>'; }).join('') +
            ((a.images || []).length < (RULES.abilities.maxImages || 6) ? '<button type="button" class="mini-btn add" data-add-img="' + i + '">+ картинка</button>' : '') + '</div>', false);        if (depth < 2) out += '<button type="button" class="mini-btn add" data-add-sub="' + esc(a.id) + '"' + (nA >= RULES.abilities.max ? ' disabled' : '') + '>+ подспособность</button>';
        A.forEach(function (c, j) { if (c.parentId === a.id && j !== i) out += one(j, depth + 1); });
        return out + '</div>';
      }
      var html = '';
      var rootIx = []; A.forEach(function (a, i) { if (!a.parentId || !ids[a.parentId] || a.parentId === a.id) rootIx.push(i); });
      rootIx.sort(function (x, y) { return (A[y].persona ? 1 : 0) - (A[x].persona ? 1 : 0) || x - y; }).forEach(function (i) { html += one(i, 0); });
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
      fld('Имя *', inp('name', d.name, 'text', ' required placeholder="Имя героя"')) +
      fld('Атрибут', inp('attribute.name', d.attribute.name, 'text', ' placeholder="Например: Лёд, Тень, Жар"')) +
      fld('Описание атрибута', '<textarea data-f="attribute.description" rows="3" placeholder="необязательно">' + esc(d.attribute.description) + '</textarea>') +
      '<div class="row3">' +
      fld('AP', inp('ap', d.ap, 'number', ' min="0" step="10"')) +
      fld('SP', inp('sp', d.sp, 'number', ' min="0" step="5"')) +
      fld('Вес, кг', inp('weightKg', d.weightKg, 'number', ' min="0" step="1"'), 'для бега по воде') +
      '</div></section>' +
      // базовые
      '<section class="ed-sec"><h3>Базовые характеристики</h3><div class="sub">Голые значения из анкеты: без одарённости и без бафов (одарённость выбирается в секторе 1 ниже)</div>' +
      '<div class="row2c">' +
      fld('Сила удара, кг', inp('stats.punch', d.stats.punch, 'number', ' min="0" step="10"')) +
      fld('Сила на подъём, кг', inp('stats.lift', d.stats.lift, 'number', ' min="0" step="5"')) +
      fld('Скорость, км/ч', inp('stats.speed', d.stats.speed, 'number', ' min="0" step="1"')) +
      fld('Реакция, мс', inp('stats.reaction', d.stats.reaction, 'number', ' min="0" step="any"')) +
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
        return '<div class="row style-row">' + inp('styles.' + i + '.name', s.name, 'text', ' placeholder="Название боевого искусства, например LINE: Колющее направление" aria-label="Название стиля"') +
          '<select data-f="styles.' + i + '.strikeType" aria-label="Тип удара">' + opts(strikeOpts, s.strikeType) + '</select>' +
          '<button type="button" class="x" data-del="styles.' + i + '" aria-label="Удалить">✕</button></div>';
      }).join('') : '<div class="empty-note">Нет стилей.</div>') +
      '<button type="button" class="mini-btn add" data-add="styles">+ стиль</button></section>' +
      // трейты
      '<section class="ed-sec"><h3>Трейты <span class="count">' + nTraits + (RULES.maxTraits ? ' / ' + RULES.maxTraits : '') + '</span></h3>' +
      (nTraits ? d.traits.map(function (t, i) {
        return '<div class="row trait-row">' + inp('traits.' + i + '.name', t.name, 'text', ' placeholder="Название" aria-label="Название трейта"') +
          inp('traits.' + i + '.description', t.description, 'text', ' placeholder="описание (необязательно)" aria-label="Описание трейта"') +
          '<button type="button" class="x" data-del="traits.' + i + '" aria-label="Удалить">✕</button></div>';
      }).join('') : '<div class="empty-note">Нет трейтов.</div>') +
      '<button type="button" class="mini-btn add" data-add="traits"' + (RULES.maxTraits && nTraits >= RULES.maxTraits ? ' disabled' : '') + '>' + (RULES.maxTraits && nTraits >= RULES.maxTraits ? 'максимум ' + RULES.maxTraits : '+ трейт') + '</button></section>' +
      '<section class="ed-sec ed-wide" data-etab="abilities"><h3>Способности атрибута</h3><details class="tag-guide"' + (d.abilities.length ? '' : ' open') + '><summary>Как писать способность</summary><p>Описание пиши обычным текстом. Числа, которые должны считаться, вставляй <b>меткой в фигурных скобках</b>: <code>{слово число}</code>. Процент можно заменить множителем: <code>{скорость x2}</code> = <code>{скорость 100%}</code>. На экране метка превратится в готовое значение от текущих статов персонажа; сила атрибута усиливает процент.</p><div class="tg"><div class="tg-h">Статы персонажа</div><div class="tg-r"><span>Сила удара</span><span><code>{сила 50%}</code></span><span class="tg-n">+30% за 100 AP</span></div><div class="tg-r"><span>Сила на подъём</span><span><code>{подъём 50%}</code></span><span class="tg-n">+30% за 100 AP</span></div><div class="tg-r"><span>Скорость</span><span><code>{скорость 50%}</code></span><span class="tg-n">+30% за 100 AP</span></div><div class="tg-r"><span>Реакция</span><span><code>{реакция 50%}</code></span><span class="tg-n">+30% за 100 AP, мс делятся</span></div><div class="tg-r"><span>Прочность</span><span><code>{прочность 50%}</code></span><span class="tg-n">+30% за 100 AP</span></div><div class="tg-r"><span>Все статы</span><span><code>{все 50%}</code></span><span class="tg-n">удар, подъём, скорость, реакция; без прочности. +7,5% за 100 AP</span></div><div class="tg-h">Эффекты на других</div><div class="tg-r"><span>Бафф союзнику</span><span><code>{бафф 30%}</code></span><span class="tg-n">+20% за 100 AP</span></div><div class="tg-r"><span>Дебафф врагу</span><span><code>{дебафф 30%}</code></span><span class="tg-n">+20% за 100 AP</span></div><div class="tg-r"><span>Бафф на все статы союзника</span><span><code>{бафф все 20%}</code></span><span class="tg-n">+5% за 100 AP</span></div><div class="tg-r"><span>Дебафф на все статы врага</span><span><code>{дебафф все 20%}</code></span><span class="tg-n">+5% за 100 AP</span></div><div class="tg-h">Особое</div><div class="tg-r"><span>Уникальный счётчик</span><span><code>{счётчик 100%}</code></span><span class="tg-n">множитель без статов; меняется от силы атрибута. +30% за 100 AP</span></div><div class="tg-r"><span>Нагрев</span><span><code>300 °C</code></span><span class="tg-n">без скобок, просто текстом; меняется от силы атрибута. +50 °C за 100 AP</span></div><div class="tg-r"><span>Охлаждение</span><span><code>-50 °C</code></span><span class="tg-n">без скобок, со знаком минус. −20 °C за 100 AP</span></div><div class="tg-h">Рост чисел</div><div class="tg-r"><span>Прокачано (было → стало)</span><span><code>{сила 50% → 80%}</code> <code>500 → 600 °C</code></span><span class="tg-n">удобнее через «Прокачка и AP»: AP посчитаются сами</span></div><div class="tg-r"><span>Число не меняется</span><span><code>{= 10 м}</code> <code>{= 3 поста}</code></span><span class="tg-n">кнопка «🔒 не меняется»</span></div><div class="tg-r"><span>Число растёт без единицы</span><span><code>{~ 15 лучей}</code></span><span class="tg-n">кнопка «⚖ масштабировать»</span></div></div><p><b>Подспособность:</b> число в метке — доля от стата родителя: <code>{сила 0.5}</code> = половина силы родителя. Если подспособность добавлена прокачкой, укажи это в счётчике «Подспособности от прокачки» у родителя: каждая отнимет 100 AP (у олицетворения 1000).</p><p><b>Олицетворение атрибута</b> (галочка у основной способности, одно на персонажа) пишется так же, но прокачивается от общего AP: за каждую полную 1000 AP после получения — одно усиление (стат +150%, бафф или дебафф +100%, нагрев +500 °C, охлаждение −80 °C) или одна подспособность.</p><p><b>Числа с единицами</b> (<code>15 м</code>, <code>20 кг</code>, <code>50 км/ч</code>) растут от силы атрибута сами. Чтобы число не росло, выдели его и нажми «🔒 не меняется».</p><p><b>Траты стамины</b> (если не отмечены как фиксированные) снижаются на 5% от изначальных за каждые 100 AP персонажа: изначально от 10% — не ниже 5%, до 5% — не ниже 0,5%.</p></details>' + abilityRows() + '</section>' +
      // бафы
      '<section class="ed-sec ed-wide" data-etab="buffs"><h3>Бафы и дебафы</h3><div class="sub">Идут по секторам. Внутри сектора проценты <b>складываются</b> (Режим зверя +50% и Дух зверя +50% = +100%, ×2), сектора <b>перемножаются</b>: <b>Атрибут × Трейты × Стиль × Артефакты × Внешний</b>. Дебафф делит. В каждом секторе добавь эффект, назови его и укажи, что он бафает; «Пассивный» действует всегда, «Активный» — только в режиме «Активные». Артефакты и внешний сектор могут вывести тело за предел.</div>' + buffSectors() + '</section>' +
      '</div>';
    showEdTab();
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
          if (fr.result.length > SHRINK_FROM * 2 && file.type !== 'image/gif') shrinkImage(fr.result, ART_SIDE, ART_Q).then(res); else res(fr.result);
        };
        im.onerror = function () { rej(new Error('Не удалось прочитать картинку')); };
        im.src = fr.result;
      };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(file);
    });
  }
  var abImgTarget = null;
  /**
   * Сжатие картинки: до maxSide px по большей стороне, в WebP (прозрачность сохраняется).
   * Если браузер не умеет WebP — JPEG, а при прозрачности PNG. Возвращает исходник, если сжатие не уменьшило размер.
   * GIF не трогаем (потеряется анимация).
   */
  function shrinkImage(url, maxSide, quality) {
    return new Promise(function (res) {
      if (typeof url !== 'string' || !/^data:image\/(png|jpeg|jpg|webp|bmp)/i.test(url)) return res(url);
      var im = new Image();
      im.onload = function () {
        try {
          var k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
          var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
          var g = cv.getContext('2d'); g.drawImage(im, 0, 0, cv.width, cv.height);
          var out = cv.toDataURL('image/webp', quality);
          if (out.indexOf('data:image/webp') !== 0) {
            var px = g.getImageData(0, 0, cv.width, cv.height).data, alpha = false;
            for (var i = 3; i < px.length; i += 4) if (px[i] < 255) { alpha = true; break; }
            out = alpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', quality);
          }
          res(out.length < url.length ? out : url);
        } catch (e) { res(url); }
      };
      im.onerror = function () { res(url); };
      im.src = url;
    });
  }
  var IMG_SIDE = 1400, IMG_Q = 0.86, ART_SIDE = 2400, ART_Q = 0.92, SHRINK_FROM = 300 * 1024;
  /** Перед сохранением: большие картинки (старые PNG и т. п.) пережимаются. */
  function shrinkCharacterImages(c) {
    var jobs = [];
    if (c.art && c.art.length > SHRINK_FROM * 2) jobs.push(shrinkImage(c.art, ART_SIDE, ART_Q).then(function (u) { c.art = u; }));
    (c.abilities || []).forEach(function (a) {
      (a.images || []).forEach(function (u, k) { if (u.length > SHRINK_FROM) jobs.push(shrinkImage(u, IMG_SIDE, IMG_Q).then(function (v) { a.images[k] = v; })); });
    });
    return Promise.all(jobs).then(function () { return c; });
  }
  /** Картинка способности: уменьшаем до 1400 px по большей стороне, чтобы не раздувать хранилище. */
  function readAbilityImage(file) {
    return new Promise(function (res, rej) {
      if (!file || !/^image\//.test(file.type)) return rej(new Error('Это не картинка'));
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () {
          if (file.type === 'image/gif') return res(fr.result);
          shrinkImage(fr.result, IMG_SIDE, IMG_Q).then(res);
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

  function saveEditor(e) {
    if (e) e.preventDefault();
    var c = cleanDraft(draft);
    if (!c.name) { toast('Укажи имя персонажа'); setEdTab('general'); var f = $('#editorBody [data-f="name"]'); if (f) f.focus(); return; }
    if (editingNew || !c.id) c.id = makeId(c.name);
    c.updatedAt = Date.now();
    if (!c.createdAt) c.createdAt = Date.now();
    shrinkCharacterImages(c).then(function () { return Store.put(c); }).then(function () {
      var i = chars.map(function (x) { return x.id; }).indexOf(c.id);
      if (i === -1) chars.push(c); else chars[i] = c;
      closeEditor();
      selectCharacter(c.id);
      toast('Сохранено');
    }).catch(function (err) { toast('Не удалось сохранить: ' + err.message); });
  }

  /** Резервная копия: все персонажи пользователя одним файлом (тот же формат читает «Загрузить»). */
  /** Приветствие: что куда вписывать. Показывается при первом запуске, потом по кнопке «Как пользоваться». */
  function showWelcome() {
    if ($('#welcome')) return;
    var el = document.createElement('div');
    el.className = 'modal'; el.id = 'welcome';
    el.innerHTML = '<div class="modal-backdrop" data-wel="close"></div><div class="modal-box panel" role="dialog" aria-modal="true" aria-label="Как пользоваться"><div class="modal-head"><h2 class="editor-title">Как пользоваться карточкой</h2><button class="close-btn" data-wel="close" aria-label="Закрыть">✕</button></div><div class="modal-body welcome-body">' +
      '<p>Это карточка РП-персонажа: статы считаются по правилам сервера, ты вводишь только исходные данные.</p>' +
      '<ol class="wel-steps">' +
      '<li><b>Нажми «✎ Редактировать».</b> Впиши имя. В «Базовых характеристиках» укажи голые значения из анкеты, без бонусов: сила удара, сила на подъём, скорость, реакция, стамина.</li>' +
      '<li><b>Атрибут и способности.</b> Название и описание атрибута пиши как в анкете. Число стата в способности вставляй меткой: <code>{speed 910%}</code>, <code>{punch 280%}</code>, <code>{durability 150%}</code>. Сайт сам посчитает значение от статов. Траты стамины указываются у каждой способности.</li>' +
      '<li><b>Одарённость и бафы.</b> В форме выбери одарённость (одна из пяти), затем заполни сектора: Атрибут, Трейты, Стиль, Артефакты, Внешний. В секторе добавь эффект (например «Режим зверя»), укажи, что он бафает, и пассивный он или активный. Внутри сектора проценты складываются, сектора перемножаются. Переключатель «Базовые / Пассивные / Активные» на главном экране пересчитывает статы.</li>' +
      '<li><b>Арт, трейты, стили боя.</b> Арт можно загрузить в редакторе, трейты и стили добавляются кнопками «+».</li>' +
      '<li><b>Сохрани данные у себя.</b> Персонажи хранятся только в этом браузере. Нажимай «⬇ Скачать данные», а «⬆ Загрузить» вернёт их на любом устройстве.</li>' +
      '</ol>' +
      '<div class="wel-actions"><button class="mini-btn accent big" data-wel="edit">✎ Начать заполнять</button><button class="mini-btn" data-wel="load">⬆ Загрузить из файла</button><button class="mini-btn" data-wel="example">Посмотреть пример (Кенос)</button></div>' +
      '</div></div>';
    document.body.appendChild(el);
    function close() { el.remove(); document.removeEventListener('keydown', onKey); try { localStorage.setItem('rp-welcome', '1'); } catch (e) { /* ок */ } }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-wel]'); if (!b) return;
      var k = b.getAttribute('data-wel');
      if (k === 'close') { close(); return; }
      if (k === 'edit') { close(); if (canEdit(ch)) openEditor(false); return; }
      if (k === 'load') { close(); $('#restoreFile').click(); return; }
      if (k === 'example') {
        var ex = SEED.map(function (c) { return normalize(clone(c)); })[0];
        if (!ex) { toast('Примера нет'); return; }
        ex.createdAt = Date.now();
        Store.put(ex).then(function () {
          var i = chars.map(function (x) { return x.id; }).indexOf(ex.id);
          if (i === -1) chars.push(ex); else chars[i] = ex;
          close(); selectCharacter(ex.id);
        }).catch(function (err) { toast('Не удалось: ' + err.message); });
      }
    });
    var f = el.querySelector('[data-wel=edit]'); if (f) f.focus();
  }

  function exportAll() {
    var list = chars.filter(function (c) { return !Remote || c.ownerId; }).map(function (c) { var x = clone(c); delete x.ownerId; delete x.ownerName; return x; });
    if (!list.length) { toast('Нечего скачивать'); return; }
    var blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'), d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = 'rp-characters-' + d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('Скачано персонажей: ' + list.length);
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
      if (!chars.length) chars = Remote ? demoList() : [templateCharacter()];
      closeEditor();
      selectCharacter(chars[0].id);
      toast('Удалено');
    }).catch(function (err) { toast('Не удалось удалить: ' + err.message); });
  }

  function bindEditor() {
    var body = $('#editorBody');
    body.addEventListener('input', function (e) {
      var gn = e.target.getAttribute('data-gname');
      if (gn !== null) { draft.buffs.forEach(function (b) { if ((b.group || b.id) === gn) { b.group = gn; b.label = e.target.value; } }); return; }
      var p = e.target.getAttribute('data-f');
      if (!p) return;
      setPath(draft, p, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      var am = /^abilities\.(\d+)\.(ap|alloc\.|personaAp|subCount)/.exec(p);
      if ((am && draft.abilities[+am[1]]) || p === 'ap') {
        // подпись «вложено / свободно» есть у каждой способности, а AP подспособностей входят в пул родителя — обновляем все
        $$('#editorBody .ab-alloc-hint').forEach(function (h) {
          var ed = h.closest('.ab-edit'), f = ed && ed.querySelector('[data-f^="abilities."]'), mm = f && /^abilities\.(\d+)\./.exec(f.getAttribute('data-f'));
          if (mm && draft.abilities[+mm[1]]) h.innerHTML = allocHint(draft.abilities[+mm[1]]);
        });
      }
      if (p === 'name') $('#editorTitle').textContent = (editingNew ? 'Новый персонаж · ' : 'Персонаж · ') + e.target.value;
    });
    body.addEventListener('toggle', function (e) {
      var dt = e.target; if (dt && dt.matches && dt.matches('details[data-acc]')) accOpen[dt.getAttribute('data-acc')] = dt.open;
    }, true);
    body.addEventListener('change', function (e) {
      if (/^(ap|abilities\.\d+\.(description|pros\.\d+|cons\.\d+|persona|personaAp|subCount))$/.test(e.target.getAttribute('data-f') || '')) { renderEditor(); return; }
      if (/^(gift|buffs\.\d+\.(stat|type|percent|max|enabled))$/.test(e.target.getAttribute('data-f') || '')) { renderEditor(); return; }
      var ug = e.target.getAttribute('data-upg');
      if (ug) {
        var up = ug.split('.'), UA = draft.abilities[+up[0]], its = UA ? upgItems(UA) : [], it = its[+up[1]];
        if (!it) return;
        var v = parseFloat(String(e.target.value).replace(',', '.'));
        var from = up[2] === 'from' ? (isFinite(v) ? v : it.from) : it.from, to = up[2] === 'to' ? (isFinite(v) ? v : from) : (Math.abs(it.to - it.from) < 1e-9 ? from : it.to);
        var fp = it.field.split('.'), txt = fp.length > 1 ? UA[fp[0]][+fp[1]] : UA[fp[0]];
        var nt = E.rewriteUpgradable(String(txt || ''), it, from, to);
        if (fp.length > 1) UA[fp[0]][+fp[1]] = nt; else UA[fp[0]] = nt;
        renderEditor(); return;
      }
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
        if (k === 'traits' && RULES.maxTraits && draft.traits.length >= RULES.maxTraits) return;
        draft[k].push(k === 'styles' ? { name: '', strikeType: '' } : { name: '', description: '' });
        renderEditor();
        var rows = $$('#editorBody .' + (k === 'styles' ? 'style' : 'trait') + '-row input');
        if (rows.length) rows[rows.length - (k === 'styles' ? 1 : 2)].focus();
        return;
      }
      var ag = t.closest('[data-add-group]');
      if (ag) { var sk = ag.getAttribute('data-add-group'), gid = makeBuffId(); draft.buffs.push({ id: makeBuffId(), group: gid, mode: 'passive', stat: 'all', percent: '', type: 'buff', layer: sk === 'external' ? 'external' : 'internal', scope: 'all', source: sk, label: '', enabled: true }); renderEditor(); var gi = $('#editorBody [data-gname="' + gid + '"]'); if (gi) gi.focus(); return; }
      var ar = t.closest('[data-add-row]');
      if (ar) { var rg = ar.getAttribute('data-add-row'), src = draft.buffs.filter(function (b) { return (b.group || b.id) === rg; })[0]; if (src) { if (!src.group) src.group = rg; draft.buffs.push({ id: makeBuffId(), group: rg, mode: src.mode, stat: 'punch', percent: '', type: 'buff', layer: src.layer, scope: 'all', source: src.source, label: src.label, enabled: true }); renderEditor(); } return; }
      var gm = t.closest('[data-gmode]');
      if (gm) { var mg = gm.getAttribute('data-gmode'), mv = gm.getAttribute('data-v'); draft.buffs.forEach(function (b) { if ((b.group || b.id) === mg) { b.mode = mv; if (mv === 'gradual' && !(parseFloat(b.max) > 0)) b.max = (parseFloat(b.percent) || 0) * 6 || ''; } }); renderEditor(); return; }
      var dg = t.closest('[data-del-group]');
      if (dg) { var xg = dg.getAttribute('data-del-group'); draft.buffs = draft.buffs.filter(function (b) { return (b.group || b.id) !== xg; }); renderEditor(); return; }
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
    $('#edTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-etab]'); if (b) setEdTab(b.getAttribute('data-etab')); });
    $('#edTabs').addEventListener('keydown', function (e) {
      var T = ['general', 'abilities', 'buffs'], x = T.indexOf(edTab);
      if (e.key === 'ArrowRight') x = (x + 1) % 3; else if (e.key === 'ArrowLeft') x = (x + 2) % 3; else return;
      setEdTab(T[x]); $('#edTabs [data-etab="' + T[x] + '"]').focus();
    });
    $('#editor').addEventListener('click', function (e) { if (e.target.closest('[data-eclose]')) askCloseEditor(); });
    // закрытие вкладки, перезагрузка, «Назад» со страницы: браузер сам спросит «Покинуть сайт?»
    window.addEventListener('beforeunload', function (e) { if (!$('#editor').hidden && editorDirty()) { e.preventDefault(); e.returnValue = ''; return ''; } });
    $('#btnExport').addEventListener('click', exportCharacter);
    $('#btnBackup').addEventListener('click', exportAll);
    $('#btnHelp').addEventListener('click', showWelcome);
    $('#restoreFile').addEventListener('change', function () { if (this.files[0]) importCharacters(this.files[0]); this.value = ''; });
    // просим браузер не вычищать данные при нехватке места
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ок */ }
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
      }).then(function () { btn.disabled = false; btn.textContent = '📷 Скриншот'; });
    });
    // облегчённый режим: без 3D-сцены, размытия и анимаций
    var lb = $('#btnLite');
    function liteLabel() { lb.querySelector('small').textContent = liteOn() ? 'включён · нажми, чтобы вернуть 3D и эффекты' : 'для слабых телефонов: без 3D, размытия и анимаций'; lb.setAttribute('aria-checked', liteOn() ? 'true' : 'false'); }
    liteLabel();
    lb.addEventListener('click', function () {
      try { localStorage.setItem('rp-lite', liteOn() ? '0' : '1'); } catch (e) { /* ок */ }
      if (draft && editorDirty() && !confirm('Страница перезагрузится, несохранённые изменения в форме пропадут. Продолжить?')) return;
      draftSnap = null; location.reload();
    });
    // меню «Данные»: новый персонаж, бэкап, загрузка, справка
    var mb = $('#btnMore'), mm = $('#moreMenu');
    function setMore(v) { mm.hidden = !v; mb.setAttribute('aria-expanded', v ? 'true' : 'false'); }
    mb.addEventListener('click', function (e) { e.stopPropagation(); setMore(mm.hidden); if (!mm.hidden) mm.querySelector('button').focus(); });
    document.addEventListener('click', function (e) { if (!e.target.closest('#more')) setMore(false); });
    mm.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setMore(false); mb.focus(); } });
    mm.addEventListener('click', function (e) { if (e.target.closest('button')) setMore(false); });
    $('#restoreFile').addEventListener('change', function () { setMore(false); });
  }

  /* ================= события главного экрана ================= */

  function bind() {
    $('#limitCard').addEventListener('toggle', function (e) { if (e.target.classList && e.target.classList.contains('test-buff')) testOpen = e.target.open; }, true);
    $('#derivedGrid').addEventListener('toggle', function (e) { if (e.target.classList && e.target.classList.contains('dmore')) dmoreOpen = e.target.open; }, true);
    $('#modalBody').addEventListener('keydown', function (e) {
      var tg = e.target.closest && e.target.closest('[data-ab-toggle]');
      if (tg && e.target === tg && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tg.click(); }
    });
    $('#modalBody').addEventListener('click', function (e) {
      var shb = e.target.closest('[data-ab-shot]');
      if (shb) {
        e.stopPropagation();
        var art = shb.closest('.abx'), abId = shb.getAttribute('data-ab-shot'), abR = R.derived.abilities.filter(function (x) { return x.id === abId; })[0];
        if (!art || !window.RPShot) return;
        shb.disabled = true; shb.textContent = '…';
        toast('Готовлю скриншот способности…');
        window.RPShot.capture('ability', Object.assign(shotContext(), { abilityEl: art, abilityName: abR ? abR.name : '', attribute: (ch.attribute && ch.attribute.name) || '' })).then(function (r) {
          toast('Сохранено: ' + r.name + ' · ' + r.width + '×' + r.height);
        }).catch(function (err) { console.error(err); toast('Скриншот не получился: ' + err.message); })
          .then(function () { shb.disabled = false; shb.textContent = '📷'; });
        return;
      }
      var im = e.target.closest('img.ab-img'); if (im) { im.classList.toggle('zoom'); return; }
      var allb = e.target.closest('[data-ab-all]');
      if (allb) { var on = allb.getAttribute('data-ab-all') === '1'; R.derived.abilities.forEach(function (x) { abOpen[ch.id + ':' + x.id] = on; }); renderModal(); return; }
      var tg = e.target.closest('[data-ab-toggle]');
      if (tg && !e.target.closest('[data-tip]')) { abOpen[tg.getAttribute('data-ab-toggle')] = tg.getAttribute('aria-expanded') !== 'true'; renderModal(); return; }   // переключатель режима внутри вкладки «Способности»
      var b = e.target.closest('button[data-abmode]'); if (!b) return;
      view.mode = b.getAttribute('data-abmode'); renderAll();
    });
    var box0 = $('#postCtl');
    box0.addEventListener('click', function (e) {
      if (e.target.closest('[data-post-fold]')) { var o = box0.classList.contains('collapsed'); try { localStorage.setItem('rp-posts-open', o ? '1' : '0'); } catch (er) { /* ок */ } renderPosts(); return; }
      var b = e.target.closest('[data-post]'); if (!b) return;
      var v = +b.getAttribute('data-post');
      view.posts = v === 0 ? 0 : Math.max(0, view.posts + v);
      renderAll();
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
      if (!$('#editor').hidden) askCloseEditor(); else if (!$('#modal').hidden) closeModal();
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
    figure = window.RPFigure ? window.RPFigure.init({ canvas: $('#figureCanvas'), fallback: $('#figureFallback'), stage: $('#stage'), lite: liteOn() }) : null;

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
        // первый запуск (или хранилище очищено): пустой шаблон; пример Кенос загружается кнопкой в приветствии
        list = [templateCharacter()];
        firstRun = true;
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
      var seen = false; try { seen = !!localStorage.getItem('rp-welcome'); } catch (e) { /* ок */ }
      if (!Remote && firstRun && !seen) showWelcome();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
