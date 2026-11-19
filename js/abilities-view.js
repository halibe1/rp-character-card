/*
 * abilities-view.js — вкладка «Способности»: карточки, числа в тексте, плюсы и минусы, прокачка.
 */
(function () {
  'use strict';

  var RULES = (window.RP_DATA || {}).rules, U0 = window.RPUtil, fmt = U0.fmt, esc = U0.esc, tipAttr = U0.tipAttr;

  function render(ctx) {
    var R = ctx.R, ch = ctx.ch, view = ctx.view, canEdit = ctx.canEdit, abOpen = ctx.abOpen;
    var list = R.derived.abilities, pw = R.derived.mods.attrPower;
    function pctTxt(v) { return fmt(v, v % 1 ? 1 : 0) + '%'; }
    var UPG_KEYS = [['radius', 'Радиус / дальность'], ['other', 'Прочие числа'], ['punch', 'Сила удара'], ['speed', 'Скорость'], ['durability', 'Прочность'], ['lift', 'Сила на подъём'], ['reaction', 'Реакция'], ['all', 'Все статы'], ['status', 'Эффект на цель'], ['heat', 'Нагрев, °C'], ['cold', 'Охлаждение, °C']];
    var EXTRA = { status: 1, heat: 1, cold: 1, all: 1 };
    function gainTxt(key, ap) { return window.RPEngine.upgradeText(key, ap, RULES); }
    function mulTxt(f, pctVal) { return '×' + fmt(f, 2) + (pctVal === undefined ? '' : '<small>(' + pctTxt(pctVal) + ')</small>'); }
    /** Сколько AP вложено в каждый показатель способности и как изменился множитель (было → стало). */
    function allocBlock(a, mark) {
      if ((!a.ap && !a.allocTotal) || !a.targets.length) return '';
      var U = RULES.abilities.upgrade, rows = UPG_KEYS.filter(function (kv) { return a.targets.indexOf(kv[0]) !== -1; }).map(function (kv) {
        var key = kv[0], ap = a.alloc[key] || 0, l = a.lines.filter(function (x) { return x.key === key; })[0], eff = '';
        if (EXTRA[key]) eff = gainTxt(key, ap) + (key === 'status' ? ' к проценту бафа / дебафа' : key === 'all' ? ' к каждому из 4 показателей (удар, подъём, скорость, реакция)' : ' к максимуму');
        else if (key === 'radius' || key === 'other') eff = mulTxt(1) + ' → ' + mulTxt(1 + ap / U.stepAp * U.distancePercentPerStep / 100) + ' (+' + fmt(ap / U.stepAp * U.distancePercentPerStep, 1) + '% от начального)';
        else if (l && l.child) eff = mulTxt(l.k0) + ' → ' + mulTxt(l.k) + (l.bonusPp ? ' (+' + fmt(l.bonusPp, 1) + '%)' : '');
        else if (l) eff = mulTxt(l.factor, l.percent) + ' → ' + mulTxt(l.factorNow, l.percentNow) + (l.bonusPp ? ' (+' + fmt(l.bonusPp, 1) + '%)' : '');
        else if (ap) eff = '+' + fmt(ap / U.stepAp * U.physPercentPerStep, 1) + '% (в описании нет метки)';
        return '<div class="upg-row' + (key === mark ? ' me' : '') + '"><span>' + kv[1] + '</span><b>' + fmt(ap, 0) + ' AP</b><span class="upg-eff">' + eff + '</span></div>';
      }).join('');
      return '<div class="upg"><div class="upg-h">Вложено в способность: ' + fmt(a.allocTotal, 0) + ' из ' + fmt(a.ap, 0) + ' AP' + (a.allocFree > 0 ? ' · свободно ' + fmt(a.allocFree, 0) : '') + (a.allocFree < 0 ? ' · <em>вложено больше, чем AP способности</em>' : '') + '</div>' + rows + '</div>';
    }
    function effHtml(l, a) {
      var deb = l.effect === 'debuff', up = l.bonusPp > 0, mark = deb ? '÷' : '×';
      var extra = (deb ? 'Дебафф врага: его характеристика делится на ' : 'Бафф союзника: его характеристика умножается на ') + '<b>' + fmt(l.factorNow, 2) + '</b>. Сила атрибута и статы персонажа на этот процент не влияют.' + (up ? '<br>Изначально ' + fmt(l.percent, 1) + '%, с прокачкой (' + fmt(l.allocAp, 0) + ' AP): ' + fmt(l.percentNow, 1) + '%.' : '') + allocBlock(a, 'status');
      return '<span class="ab-num ab-eff' + (deb ? ' deb' : '') + '"' + tipAttr(l.label, l.formula, extra) + '>' + fmt(l.percentNow, l.percentNow % 1 ? 1 : 0) + '%' + (up ? '<span class="ab-up" title="прокачано">▲</span>' : '') + '<span class="ab-mul">' + mark + fmt(l.factorNow, 2) + '</span></span>';
    }
    function numHtml(l, a) {
      if (l.kind === 'effect') return effHtml(l, a);
      var val = fmt(l.value, l.key === 'speed' || l.key === 'reaction' ? 1 : 0) + ' ' + esc(l.unit);
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
      extra = 'Множитель: <b>' + body + '</b>' + (l.ms !== undefined ? '<br>' + fmt(l.ms, 1) + ' м/с' : '') + '<br>' + extra + allocBlock(a, l.pool || l.key);
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
        if (s.temp) {
          var tp = s.temp, cold = tp.key === 'cold', shown = (tp.plus && tp.value >= 0 ? '+' : '') + fmt(tp.value, Math.abs(tp.value - Math.round(tp.value)) < 1e-9 ? 0 : 1).replace('-', '−') + tp.suffix;
          if (!tp.gain) return esc((tp.plus ? '+' : '') + fmt(tp.num, tp.num % 1 ? 1 : 0).replace('-', '−') + tp.suffix);
          return '<span class="ab-sc ab-temp ' + tp.key + '"' + tipAttr(cold ? 'Охлаждение' : 'Нагрев', tp.formula, 'Было ' + fmt(tp.num, 1) + ' °C. ' + (cold ? 'Каждые ' + RULES.abilities.upgrade.stepAp + ' AP понижают температуру на ' + RULES.abilities.upgrade.coldPerStep + ' °C.' : 'Каждые ' + RULES.abilities.upgrade.stepAp + ' AP повышают максимальную температуру на ' + RULES.abilities.upgrade.heatPerStep + ' °C.') + allocBlock(a, tp.key)) + '>' + esc(shown) + '<span class="ab-up" title="прокачано">▲</span></span>';
        }
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
        if (EXTRA[key]) eff = gainTxt(key, a.alloc[key]);
        else if (key === 'radius' || key === 'other') eff = '×' + fmt(1 + a.alloc[key] / U.stepAp * U.distancePercentPerStep / 100, 2);
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
  }

  window.RPAbilitiesView = { render: render };
})();
