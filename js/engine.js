/*
 * engine.js — вся математика правил сервера. Чистые функции, без DOM.
 * Работает в браузере (window.RPEngine) и в Node (module.exports).
 *
 * Итог по каждому показателю (характеристики, прочность, сила атрибута, сила боевого искусства):
 *   результат = база × внутр.баф ÷ внутр.дебаф × внешн.баф ÷ внешн.дебаф
 *   где баф слоя = произведение по источникам (атрибут, трейты, стиль, артефакт, внешний, без источника)
 *   величин «1 + сумма бафов источника в долях»; дебафф считается так же, но делит.
 *   Реакция («меньше = лучше») — зеркально: баф делит мс, дебафф умножает.
 *   Бонус: { stat, percent, type?, layer?, scope?, mode, enabled?, source?, label? } — см. normBuff().
 *
 *   RPEngine.compute(character, rules, options) -> полный объект расчётов
 *   options = {
 *     mode: 'base' | 'passive' | 'active',
 *     wounds: [{ degree: 'heavy', stat: 'punch', enabled: true }],
 *     testBuff: { percent: 0, source: 'external' }   // тестовый внешний бафф (только режим active)
 *   }
 */
(function (root) {
  'use strict';

  var PHYS = ['punch', 'lift', 'speed', 'reaction'];
  var ALL = ['punch', 'lift', 'speed', 'reaction', 'stamina'];

  function r(x, d) { var p = Math.pow(10, d === undefined ? 1 : d); return Math.round(x * p) / p; }
  function n(x, d) { return x === null || x === undefined || !isFinite(x) ? '—' : String(r(x, d === undefined ? 2 : d)); }
  function kmhToMs(v) { return v / 3.6; }
  function msToKmh(v) { return v * 3.6; }
  function num(v, def) { v = parseFloat(v); return isFinite(v) ? v : def; }

  /* ---------- бонусы → множители ---------- */

  var LAYERS = ['internal', 'external'];
  var KINDS = ['buff', 'debuff'];
  var LAYER_LABEL = { internal: 'внутренние', external: 'внешние' };
  var KIND_LABEL = { buff: 'бафы', debuff: 'дебафы' };

  /**
   * Приводит запись бонуса из данных к единому виду.
   * Старые данные поддерживаются:
   *   нет layer  -> 'internal';
   *   нет type   -> знак процента (отрицательный = дебафф);
   *   нет scope  -> 'all'; нет enabled -> включён.
   */
  function normBuff(b) {
    var p = num(b.percent, 0);
    return {
      id: b.id, label: b.label || '', source: b.source || '', mode: b.mode, stat: b.stat,
      scope: b.scope || 'all',
      layer: b.layer === 'external' ? 'external' : 'internal',
      type: b.type === 'debuff' || b.type === 'buff' ? b.type : (p < 0 ? 'debuff' : 'buff'),
      magnitude: Math.abs(p),
      enabled: b.enabled !== false,
      affectsLimit: b.affectsLimit === true
    };
  }
  function normalizeBuffs(list) {
    return (list || []).filter(function (b) { return b && b.stat; }).map(normBuff).filter(function (b) { return b.magnitude > 0; });
  }

  /**
   * Один слой одного вида (например, внутренние бафы): проценты -> множитель.
   * Единственное место, где решается, как складываются бонусы одного слоя и вида:
   *   'additive'       — 1 + сумма долей: +40% и +60% = ×2  (по умолчанию)
   *   'multiplicative' — ×1.4 × ×1.6 = ×2.24
   * Дебафф ×1.5 (то есть 50%) считается так же, но потом ДЕЛИТ значение.
   */
  function stackFactor(percents, stacking) {
    if (!percents.length) return 1;
    if (stacking === 'multiplicative') return percents.reduce(function (m, p) { return m * (1 + p / 100); }, 1);
    return 1 + percents.reduce(function (s, p) { return s + p; }, 0) / 100;
  }

  /**
   * Цепочка одного показателя:
   *   результат = база × внутр.баф ÷ внутр.дебаф × внешн.баф ÷ внешн.дебаф
   * Для показателей «меньше = лучше» (реакция) направление зеркальное: баф делит, дебафф умножает.
   * items — записи бонусов в любом формате (см. normBuff); отключённые (enabled:false) пропускаются.
   */
  function chain(base, items, o) {
    o = o || {};
    var lower = !!o.lowerBetter, running = base, steps = [];
    var norm = (items || []).map(function (b) { return b.magnitude !== undefined ? b : normBuff(b); }).filter(function (b) { return b.enabled && b.magnitude > 0; });
    var parts = {}, factor = 1;
    LAYERS.forEach(function (layer) {
      KINDS.forEach(function (kind) {
        var list = norm.filter(function (b) { return b.layer === layer && b.type === kind; });
        var pct = list.reduce(function (s, b) { return s + b.magnitude; }, 0);
        // как раньше: бонусы одного источника складываются, разные источники перемножаются,
        // бонус без источника — отдельный множитель
        var groups = [], byKey = {};
        list.forEach(function (b, i) {
          var key = b.source ? b.source : '_' + i;
          if (!byKey[key]) { byKey[key] = { source: b.source, items: [] }; groups.push(byKey[key]); }
          byKey[key].items.push(b);
        });
        var f = 1;
        groups.forEach(function (g) {
          g.percent = g.items.reduce(function (s, b) { return s + b.magnitude; }, 0);
          g.factor = stackFactor(g.items.map(function (b) { return b.magnitude; }), o.stacking);
          f *= g.factor;
        });
        var divides = (kind === 'buff') === lower;           // дебафф делит, баф умножает (для реакции наоборот)
        running = divides ? running / f : running * f;
        factor = kind === 'buff' ? factor * f : factor / f;
        var key = layer + (kind === 'buff' ? 'Buff' : 'Debuff');
        parts[key] = { key: key, layer: layer, kind: kind, label: LAYER_LABEL[layer] + ' ' + KIND_LABEL[kind], items: list, groups: groups, percent: pct, factor: f, op: divides ? '÷' : '×', after: running };
        steps.push(parts[key]);
      });
    });
    var value = running;
    var f = n(base);
    steps.forEach(function (s) { if (s.factor !== 1) f += ' ' + s.op + ' ' + n(s.factor, 3); });
    return { base: base, parts: parts, steps: steps, factor: factor, value: value, lowerBetter: lower,
      formula: f + ' = ' + n(value, 1) };
  }

  function appliesTo(b, stat) {
    if (b.stat === stat) return true;
    if (b.stat === 'all' && stat !== 'stamina') return true;
    return false;
  }
  function inMode(b, mode, rules) { return rules.modes[mode].includes.indexOf(b.mode) !== -1; }
  /** Может ли бонус вывести тело за предел: внешние (саппорты) и артефакты. Внутренние бонусы предел не двигают. */
  function limitBuff(b, rules) {
    var src = rules.buffSources[b.source];
    return b.affectsLimit || b.layer === 'external' || !!(src && src.affectsLimit);
  }

  /* ---------- ранения ---------- */

  function woundDivisors(wounds, rules) {
    var degrees = {};
    rules.wounds.degrees.forEach(function (d) { degrees[d.id] = d; });
    var out = {};
    ALL.forEach(function (s) { out[s] = { divisor: 1, parts: [], light: 0 }; });
    var lethal = 1;
    (wounds || []).forEach(function (w) {
      if (w.enabled === false) return;
      var d = degrees[w.degree];
      if (!d) return;
      if (d.all) { lethal *= d.divisor; return; }
      var t = out[w.stat];
      if (!t) return;
      if (d.id === 'light') { t.light++; return; }
      t.parts.push(d);
    });
    ALL.forEach(function (s) {
      var t = out[s];
      if (t.parts.length) {
        // накопление: (делитель − 1) складываются, но не выше потолка самой тяжёлой степени
        var sum = t.parts.reduce(function (a, d) { return a + (d.divisor - 1); }, 0);
        var cap = Math.max.apply(null, t.parts.map(function (d) { return d.accumulationCap; }));
        var single = Math.max.apply(null, t.parts.map(function (d) { return d.divisor; }));
        t.divisor = Math.max(single, Math.min(cap, 1 + sum));
      }
      if (s !== 'stamina') t.divisor *= lethal;
    });
    return out;
  }

  /* ---------- предел ---------- */

  function limitZone(ratio, limitBonus, rules) {
    var zone = { level: 0, label: ratio > 1 ? 'Сверх нормы' : 'Безопасно', effect: ratio > 1 ? 'Выше естественного максимума, но ниже порога травм' : 'В пределах тела' };
    rules.limit.levels.forEach(function (l) {
      if (ratio >= l.multiplier + limitBonus) zone = { level: l.level, label: l.label, effect: l.effect };
    });
    return zone;
  }

  /* ---------- главный расчёт ---------- */

  function compute(ch, rules, opts) {
    opts = opts || {};
    var mode = opts.mode || 'base';
    var stacking = rules.bonusStacking;
    var buffs = normalizeBuffs(ch.buffs);
    if (opts.testBuff && opts.testBuff.percent) {
      var tsrc = opts.testBuff.source || 'external';
      buffs.push(normBuff({ mode: 'active', stat: 'all', percent: opts.testBuff.percent, source: tsrc, layer: tsrc === 'artifact' ? 'internal' : 'external', label: 'Тестовый бафф' }));
    }
    buffs = buffs.filter(function (b) { return b.enabled; });

    /* сила атрибута / боевого искусства усиливает величину бафов своего источника:
       бафф атрибута +100% при силе атрибута +200% (множитель ×3) станет +300%;
       +40% силы → 140%; дебафф ×1.5 силы → 100% ÷ 1.5 = 66.7%. Работает аспект «мощность» (и «все»). */
    var POWER_OF_SOURCE = { attribute: 'attrPower', style: 'artPower' };
    var pf = {};
    Object.keys(POWER_OF_SOURCE).forEach(function (src) {
      var k = POWER_OF_SOURCE[src], def = rules.modifiers[k];
      var pb = buffs.filter(function (b) { return b.stat === k && inMode(b, mode, rules) && (b.scope === 'all' || b.scope === 'power'); });
      pf[k] = chain(def.base, pb, { stacking: stacking }).value / def.base;
    });
    buffs = buffs.map(function (b) {
      var k = POWER_OF_SOURCE[b.source];
      if (!k || pf[k] === 1 || rules.modifiers[b.stat]) return b;
      return Object.assign({}, b, { baseMagnitude: b.magnitude, powerFactor: pf[k], magnitude: b.magnitude * pf[k] });
    });
    var wd = woundDivisors(opts.wounds, rules);
    /* одарённость: меняет саму базу (до бафов) */
    var gift = (rules.gifts || {})[ch.gift || ''] || { label: '', effects: {} }, GE = gift.effects || {};
    function giftBase(s, raw, lb) {
      var v = raw, parts = [];
      if (GE.baseFlat && GE.baseFlat[s]) { v += GE.baseFlat[s]; parts.push('+ ' + GE.baseFlat[s]); }
      if (GE.baseImprove && GE.baseImprove[s]) { var k1 = GE.baseImprove[s]; v = lb ? v / k1 : v * k1; parts.push((lb ? '÷ ' : '× ') + k1); }
      if (GE.baseDebuff && GE.baseDebuff[s]) { var k2 = 1 + GE.baseDebuff[s] / 100; v = lb ? v * k2 : v / k2; parts.push((lb ? '× ' : '÷ ') + n(k2, 3)); }
      return { value: v, formula: parts.length ? n(raw, 1) + ' ' + parts.join(' ') + ' (' + gift.label.toLowerCase() + ') = ' + n(v, 1) : '' };
    }
    if (GE.woundDivisorReduce) Object.keys(wd).forEach(function (s) { if (wd[s].divisor > 1) wd[s].divisor = Math.max(1, wd[s].divisor - GE.woundDivisorReduce); });

    var stats = {};
    ALL.forEach(function (s) {
      var def = rules.stats[s], lb = def.betterLower;
      var rawBase = num(ch.stats && ch.stats[s], 0), gb = s === 'stamina' ? { value: rawBase, formula: '' } : giftBase(s, rawBase, lb);
      var base = gb.value;
      var forStat = buffs.filter(function (b) { return appliesTo(b, s); });
      var modeBuffs = forStat.filter(function (b) { return inMode(b, mode, rules); });
      var cn = chain(base, modeBuffs, { stacking: stacking, lowerBetter: lb });
      // естественный максимум: всё активное, кроме бонусов, которые умеют превышать предел
      var natBuffs = forStat.filter(function (b) { return inMode(b, 'active', rules) && !limitBuff(b, rules); });
      var natural = chain(base, natBuffs, { stacking: stacking, lowerBetter: lb }).value;
      var wound = wd[s];
      var value = lb ? cn.value * wound.divisor : cn.value / wound.divisor;
      if (s === 'reaction') value = Math.max(rules.reaction.absoluteMs, value);

      var formula = (gb.formula ? gb.formula + ' → ' : '') + cn.formula + ' ' + def.unit;
      if (wound.divisor !== 1) formula += ' ' + (lb ? '×' : '÷') + ' ' + n(wound.divisor, 3) + ' (ранения) = ' + n(value, 1) + ' ' + def.unit;

      stats[s] = {
        key: s, label: def.label, unit: def.unit,
        base: base, rawBase: rawBase, giftFormula: gb.formula, value: value, delta: value - base,
        multiplier: cn.factor, chain: cn, buffs: modeBuffs,
        woundDivisor: wound.divisor, lightWounds: wound.light,
        natural: natural,
        limitRatio: base ? (lb ? natural / cn.value : cn.value / natural) : 1,
        formula: formula
      };
    });

    var S = function (k) { return stats[k].value; };
    var d = {};

    /* множители: сила атрибута, сила боевого искусства (по аспектам), прочность */
    function modBuffs(stat, scope) {
      return buffs.filter(function (b) {
        return b.stat === stat && inMode(b, mode, rules) && (scope === 'all' ? b.scope === 'all' : (b.scope === 'all' || b.scope === scope));
      });
    }
    var mods = {};
    ['attrPower', 'artPower'].forEach(function (k) {
      var def = rules.modifiers[k], m = { key: k, label: def.label, unit: def.unit, base: def.base, scopes: {} };
      Object.keys(rules.scopes).forEach(function (sc) { m.scopes[sc] = chain(def.base, modBuffs(k, sc), { stacking: stacking }); });
      m.value = m.scopes.all.value;
      mods[k] = m;
    });

    /* прочность */
    var dur = rules.durability;
    var durMin = GE.durabilityMin || dur.minimum, durPM = 1;
    if (GE.durabilityPunchMultiplier && S('punch') * dur.punchMultiplier > durMin) durPM = GE.durabilityPunchMultiplier;
    var durRaw = S('punch') * durPM * dur.punchMultiplier, durBase = Math.max(durMin, durRaw);
    var durChain = chain(durBase, modBuffs('durability', 'all'), { stacking: stacking });
    d.durability = { value: durChain.value, base: durBase, min: durMin, chain: durChain,
      formula: n(S('punch'), 1) + (durPM !== 1 ? ' × ' + durPM + ' (' + gift.label.toLowerCase() + ')' : '') + ' × ' + dur.punchMultiplier + ' = ' + n(durRaw, 1) + ' кг' + (durRaw < durMin ? ' → минимум ' + durMin + ' кг' + (GE.durabilityMin ? ' (' + gift.label.toLowerCase() + ')' : '') : '') + (durChain.steps.some(function (s) { return s.factor !== 1; }) ? '; множитель: ' + durChain.formula + ' кг' : '') };
    mods.durability = { key: 'durability', label: rules.modifiers.durability.label, unit: 'кг', base: durBase, scopes: { all: durChain }, value: durChain.value };
    d.mods = mods;
    d.powerFactors = pf;

    /* удары */
    var primaryStyle = (ch.styles || []).filter(function (st) { return st && st.strikeType; })[0];
    var primary = primaryStyle ? primaryStyle.strikeType : 'hand';
    d.strikes = Object.keys(rules.strike.types).map(function (k) {
      var t = rules.strike.types[k], v = S('punch') * t.multiplier;
      return { key: k, label: t.label, multiplier: t.multiplier, value: v, primary: k === primary, style: k === primary && primaryStyle ? primaryStyle.name : null, note: t.note,
        formula: n(S('punch'), 1) + ' × ' + t.multiplier + ' = ' + n(v, 1) + ' кг, ' + t.note.toLowerCase() };
    });

    /* подъём */
    var L = rules.lift, lift = S('lift');
    var explosive = lift * L.explosiveMultiplier;
    var expF = GE.explosiveTimeReactionFactor || L.explosiveTimeReactionFactor;
    var expT = Math.min(S('reaction') * expF, L.explosiveTimeMaxMs);
    d.explosive = { value: explosive, timeMs: expT, formula: n(lift, 1) + ' × ' + L.explosiveMultiplier + ' = ' + n(explosive, 1) + ' кг', timeFormula: 'min(' + n(S('reaction'), 1) + ' × ' + n(expF, 3) + ', ' + L.explosiveTimeMaxMs + ') = ' + n(expT, 1) + ' мс' };
    d.liftLegs = { value: lift * L.legsMultiplier, formula: n(lift, 1) + ' × ' + L.legsMultiplier + ' = ' + n(lift * L.legsMultiplier, 1) + ' кг (ногами)' };
    d.liftOneLimb = { value: lift / L.missingLimbDivisor, formula: n(lift, 1) + ' ÷ ' + L.missingLimbDivisor + ' = ' + n(lift / L.missingLimbDivisor, 1) + ' кг (без одной конечности)' };
    d.pressure = pressure(lift, L.palmAreaCm2, rules);

    /* скорость */
    var SP = rules.speed, speed = S('speed');
    var accel = lift / SP.accelStartDivisor;
    d.speed = { kmh: speed, ms: kmhToMs(speed), formula: n(speed, 1) + ' км/ч ÷ 3.6 = ' + n(kmhToMs(speed), 2) + ' м/с' };
    d.accel = { start: accel, effectiveStart: Math.min(accel, speed), instantMax: accel >= speed, distanceM: SP.accelDistanceM,
      formula: n(lift, 1) + ' ÷ ' + SP.accelStartDivisor + ' = ' + n(accel, 1) + ' км/ч' + (accel >= speed ? ' ≥ максимума ' + n(speed, 1) + ' → сразу максимум' : '') + '; на максимум минимум ' + SP.accelDistanceM + ' м' };
    var atkM = GE.attackMultiplier || SP.attackMultiplier, atk = speed * atkM;
    d.attackSpeed = { kmh: atk, multiplier: atkM, ms: kmhToMs(atk), formula: n(speed, 1) + ' × ' + atkM + (GE.attackMultiplier ? ' (' + gift.label.toLowerCase() + ')' : '') + ' = ' + n(atk, 1) + ' км/ч (' + n(kmhToMs(atk), 2) + ' м/с)' };
    d.water = waterRun(num(ch.weightKg, 0), kmhToMs(speed), rules);

    /* реакция */
    d.meleeTiming = reactionCheck(atk, S('reaction'), rules);

    /* стамина / траты атрибута */
    d.stamina = attributeEndurance(ch, rules, { max: S('stamina'), ap: num(ch.ap, 0) });

    /* предел */
    var limitBonus = num(ch.awakenings, 0) * rules.limit.awakeningBonusPerCount;
    var perStat = {}, worst = null;
    PHYS.forEach(function (s) {
      var st = stats[s], z = limitZone(st.limitRatio, limitBonus, rules);
      perStat[s] = { ratio: st.limitRatio, zone: z, natural: st.natural, current: st.value, harmless: s === 'reaction' };
      if (s !== 'reaction' && (!worst || st.limitRatio > worst.ratio)) worst = { stat: s, ratio: st.limitRatio, zone: z };
    });
    var thresholds = rules.limit.levels.map(function (l) { return { level: l.level, at: l.multiplier + limitBonus, label: l.label, effect: l.effect }; });
    d.limit = {
      perStat: perStat, worst: worst, thresholds: thresholds, limitBonus: limitBonus,
      reactionWarning: perStat.reaction.ratio > 1 ? rules.limit.reactionWarning : null,
      formula: 'нагрузка = текущее ÷ естественный максимум (все бафы, кроме артефактов и внешних). Пороги: ' + thresholds.map(function (t) { return '×' + t.at; }).join(' / ') + (limitBonus ? ' (+' + limitBonus + 'x за пробуждения)' : '')
    };

    /* прогресс */
    d.progress = { martial: martialProgress(num(ch.sp, 0), rules), ap: apProgress(num(ch.ap, 0), rules) };

    /* способности атрибута: статы считаются от текущих статов персонажа */
    d.abilities = abilityStats(ch.abilities, { punch: S('punch'), speed: S('speed'), durability: d.durability.value, lift: S('lift'), reaction: S('reaction') }, mods.attrPower, ch.ap, rules);

    d.gift = { key: ch.gift || '', label: gift.label, short: gift.short, desc: gift.desc, pros: gift.pros || [], cons: gift.cons || [] };
    return { mode: mode, modeLabel: rules.modes[mode].label, stats: stats, derived: d };
  }

  /* ---------- способности атрибута ---------- */

  /**
   * Описание способности — обычный текст; число статов вставляется меткой, например
   *   «Скорость зеркала — {speed 910%} от максимальной скорости»   (также x10.1, ×10.1, 910 — это процент)
   *   «Сила луча — {punch 0.5} зеркала»                              (у подспособности: множитель от стата родителя)
   * Метки: speed|скорость, durability|прочность, punch|сила (удара). Всё остальное — просто текст.
   *
   * Значение метки в основной способности = стат персонажа × (1 + процент × сила атрибута):
   *   сила атрибута (аспект «скорость» или «мощность») увеличивает именно процент:
   *   100% при силе атрибута ×3 → 300% (×4). Бафф атрибута ×2 и способность ×2 = ×4; при силе ×3 оба ×4 → ×16.
   * В подспособности: значение = такой же стат родителя × k (сила атрибута уже учтена в родителе).
   */
  /** Слова-метки «на все показатели»: {все 40%}, {all 40%}, {все статы 40%}. */
  var ALL_AFTER = ['все', 'всё', 'all', 'все статы', 'статы', 'на все статы', 'на все', 'всех', 'все показатели'];
  var ALL_WORDS = ['all', 'все', 'всё', 'все статы', 'статы', 'все показатели', 'физа'];
  function parseAbilityText(text, defs, effects, allStats) {
    var map = {}, eff = {};
    Object.keys(defs).forEach(function (k) { [k].concat(defs[k].aliases || []).forEach(function (al) { map[al.toLowerCase()] = k; }); });
    Object.keys(effects || {}).forEach(function (k) { [k].concat(effects[k].aliases || []).forEach(function (al) { eff[al.toLowerCase()] = k; }); });
    var re = /\{\s*([^{}\d]+?)[\s:=]+([xх×])?\s*(\d+(?:[.,]\d+)?)\s*(%)?\s*\}/gi, segs = [], last = 0, m;
    text = String(text || '');
    while ((m = re.exec(text)) !== null) {
      var nm0 = m[1].trim().toLowerCase(), key = map[nm0], effKind = key ? null : eff[nm0];
      var effAll = false;
      if (!key && !effKind) {   // «дебафф все 40%», «бафф на все статы 30%»
        var pw0 = nm0.split(/\s+/), tail = pw0.slice(1).join(' ');
        if (pw0.length > 1 && eff[pw0[0]] && ALL_AFTER.indexOf(tail) !== -1) { effKind = eff[pw0[0]]; effAll = true; }
      }
      var isAll = !key && !effKind && ALL_WORDS.indexOf(nm0) !== -1;
      if (!key && !effKind && !isAll) continue;
      if (m.index > last) segs.push({ text: text.slice(last, m.index) });
      if (isAll) {
        // «все статы»: метка раскрывается в бафф на сила удара, подъём, скорость и реакцию (прочность не входит)
        var mk = m[2] ? 'x' : (m[4] ? '%' : ''), nv = parseFloat(m[3].replace(',', '.'));
        (allStats || Object.keys(defs).filter(function (k) { return k !== 'durability'; })).filter(function (k) { return defs[k]; }).forEach(function (k, ix) {
          segs.push({ text: (ix ? ', ' : '') + String(defs[k].label || k).toLowerCase() + ' ' });
          segs.push({ token: { key: k, effect: '', num: nv, mark: mk, src: m[0], viaAll: true } });
        });
        last = re.lastIndex;
        continue;
      }
      segs.push({ token: { key: effKind ? ((effects[effKind] && effects[effKind].pool) || 'status') : key, effect: effKind || '', effAll: effAll, num: parseFloat(m[3].replace(',', '.')), mark: m[2] ? 'x' : (m[4] ? '%' : ''), src: m[0] } });
      last = re.lastIndex;
    }
    if (last < text.length) segs.push({ text: text.slice(last) });
    return segs;
  }

  /**
   * Остальные числа в тексте способности (радиус, дальность, скорость…) тоже растут от силы атрибута:
   *  - числа с единицами (м, км, см, кг, км/ч, м/с…) масштабируются сами, по аспекту единицы (расстояние → «радиус», кг → «мощность», скорость → «скорость»);
   *  - {= 10 м} — исключение: число НЕ меняется;
   *  - {~ 15 лучей} или {~радиус 15 лучей} — число без единицы всё же масштабируется (аспект по умолчанию «все»).
   */
  var SCOPE_ALIAS = { radius: 'radius', 'радиус': 'radius', power: 'power', 'мощность': 'power', speed: 'speed', 'скорость': 'speed', all: 'all', 'все': 'all' };
  /** Прокачка дальности: каждые 100 AP, вложенные в «радиус», дают +15% от НАЧАЛЬНОГО значения (100 см → 115). */
  function distFactor(alloc, rules, key) {
    var u = rules.abilities.upgrade, v = alloc ? alloc[key || 'radius'] : 0;
    return 1 + (v > 0 ? v / u.stepAp * u.distancePercentPerStep / 100 : 0);
  }
  /**
   * Куда можно вложить AP в способности: показатели из меток ({speed …}, {punch …}), «радиус» — если в тексте есть
   * масштабируемые числа-расстояния, «other» — прочие масштабируемые числа (кг, км/ч, {~ …}). Числа с замочком {= …} не считаются.
   */
  var ALLOC_ORDER = ['punch', 'lift', 'speed', 'reaction', 'durability', 'all', 'status', 'statusAll', 'unique', 'radius', 'other', 'heat', 'cold'];
  /** Что даёт вложение AP в показатель: число (процентные пункты, множитель или градусы). */
  function upgradeGain(key, ap, rules) {
    var u = rules.abilities.upgrade, s = (ap || 0) / u.stepAp;
    if (key === 'status') return s * u.statusPercentPerStep;
    if (key === 'unique') return s * u.physPercentPerStep;
    if (key === 'statusAll') return s * u.statusPercentPerStep / ((rules.abilities.allStats || [1, 2, 3, 4]).length);
    if (key === 'all') return s * u.physPercentPerStep / ((rules.abilities.allStats || [1, 2, 3, 4]).length);
    if (key === 'heat') return s * u.heatPerStep;
    if (key === 'cold') return s * u.coldPerStep;
    if (key === 'radius' || key === 'other') return s * u.distancePercentPerStep;
    return s * u.physPercentPerStep;
  }
  function upgradeText(key, ap, rules) {
    var g = upgradeGain(key, ap, rules);
    if (key === 'heat') return '+' + n(g, 1) + ' °C';
    if (key === 'cold') return '−' + n(g, 1) + ' °C';
    if (key === 'radius' || key === 'other') return '×' + n(1 + g / 100, 3) + ' от начального';
    return '+' + n(g, 2) + '%';
  }
  function abilityTargets(text, rules) {
    if (text && typeof text === 'object') text = [text.description].concat(text.pros || [], text.cons || []).join('\n');
    var defs = rules.abilities.stats, keys = [], dummy = { base: 100, scopes: {} };
    Object.keys(rules.scopes).forEach(function (sc) { dummy.scopes[sc] = { value: 100 }; });
    function add(k) { if (keys.indexOf(k) === -1) keys.push(k); }
    parseAbilityText(text, defs, rules.abilities.effects, rules.abilities.allStats).forEach(function (s) {
      if (s.token) { add(s.token.viaAll ? 'all' : s.token.effAll ? 'statusAll' : s.token.key); return; }
      expandPlain(s.text, dummy, rules, {}).forEach(function (x) { if (x.scaled) add(x.scaled.scope === 'radius' ? 'radius' : 'other'); if (x.temp) add(x.temp.key); });
    });
    var order = ALLOC_ORDER;
    return order.filter(function (k) { return keys.indexOf(k) !== -1; });
  }
  function scaledSeg(numStr, suffix, scope, power, rules, forced, alloc) {
    var num = parseFloat(String(numStr).replace(',', '.')), sc = power.scopes[scope] ? scope : 'all';
    var F = power.scopes[sc].value / power.base, D = distFactor(alloc, rules, sc === 'radius' ? 'radius' : 'other'), value = num * D * F;
    return { scaled: { num: num, suffix: suffix, scope: sc, scopeLabel: rules.scopes[sc].label, F: F, D: D, allocAp: alloc ? alloc[sc === 'radius' ? 'radius' : 'other'] || 0 : 0,
      valueNoUpgrade: num * F, value: value, forced: !!forced,
      formula: n(num, 2) + (D !== 1 ? ' × ' + n(D, 3) + ' (прокачка)' : '') + ' × ' + n(F, 3) + ' (сила атрибута, ' + rules.scopes[sc].label.toLowerCase() + ') = ' + n(value, 2) } };
  }
  function expandPlain(text, power, rules, alloc) {
    var units = (rules.abilities.scaleUnits || []), out = [];
    var auto = units.length ? new RegExp('(\\d+(?:[.,]\\d+)?)(\\s*)(' + units.map(function (u) { return u.pattern; }).join('|') + ')(?![а-яёa-z0-9/])', 'gi') : null;
    function tempSeg(sign, numStr, gap, suffix) {
      var num = parseFloat(String(numStr).replace(',', '.')), cold = sign === '-', U = rules.abilities.upgrade;
      var key = cold ? 'cold' : 'heat', ap = alloc ? alloc[key] || 0 : 0, gain = upgradeGain(key, ap, rules);
      var value = cold ? -num - gain : num + gain;
      return { temp: { key: key, num: cold ? -num : num, plus: sign === '+', suffix: gap + suffix, value: value, allocAp: ap, gain: gain,
        formula: (cold ? '−' + n(num, 2) : n(num, 2)) + (gain ? (cold ? ' − ' : ' + ') + n(gain, 2) + ' (прокачка: ' + n(ap, 0) + ' AP × ' + (cold ? U.coldPerStep : U.heatPerStep) + ' °C / ' + U.stepAp + ' AP)' : '') + ' = ' + n(value, 2) + ' °C' } };
    }
    var tempRe = /([+\-−–]?)(\d+(?:[.,]\d+)?)(\s*)(°\s?[CС]?|градус[а-яё]*(?:\s+Цельсия)?)/gi;
    function plain(chunk) {
      if (!chunk) return;
      if (/°|градус/i.test(chunk)) {
        var tl = 0, tm; tempRe.lastIndex = 0;
        while ((tm = tempRe.exec(chunk)) !== null) {
          var sg = tm[1] === '−' || tm[1] === '–' ? '-' : tm[1], cut = tm.index;
          if (sg && /\d\s*$/.test(chunk.slice(0, tm.index))) continue;   // диапазон «10–20 °C»: не меняем, это не одна температура
          plainUnits(chunk.slice(tl, cut));
          out.push(tempSeg(sg, tm[2], tm[3], tm[4]));
          tl = tempRe.lastIndex;
        }
        plainUnits(chunk.slice(tl));
        return;
      }
      plainUnits(chunk);
    }
    function plainUnits(chunk) {
      if (!chunk) return;
      if (!auto) { out.push({ text: chunk }); return; }
      var last = 0, m; auto.lastIndex = 0;
      while ((m = auto.exec(chunk)) !== null) {
        var scope = 'all';
        units.some(function (u) { if (new RegExp('^(?:' + u.pattern + ')$', 'i').test(m[3])) { scope = u.scope; return true; } return false; });
        if (m.index > last) out.push({ text: chunk.slice(last, m.index) });
        out.push(scaledSeg(m[1], m[2] + m[3], scope, power, rules, false, alloc));
        last = auto.lastIndex;
      }
      if (last < chunk.length) out.push({ text: chunk.slice(last) });
    }
    var re = /\{([=~])\s*(?:(radius|power|speed|all|радиус|мощность|скорость|все)\s+)?([^{}]*?)\s*\}/gi, last = 0, m;
    text = String(text || '');
    while ((m = re.exec(text)) !== null) {
      plain(text.slice(last, m.index));
      if (m[1] === '=') out.push({ fixed: m[3] });
      else {
        var nm = /^(\d+(?:[.,]\d+)?)([\s\S]*)$/.exec(m[3]);
        if (nm) { out.push(scaledSeg(nm[1], '', m[2] ? SCOPE_ALIAS[m[2].toLowerCase()] : 'all', power, rules, true, alloc)); if (nm[2]) out.push({ text: nm[2] }); }
        else out.push({ text: m[3] });
      }
      last = re.lastIndex;
    }
    plain(text.slice(last));
    return out;
  }
  function abilityStats(list, user, power, ap, rules) {
    var defs = rules.abilities.stats, items = (list || []).filter(function (a) { return a && a.id; });
    var byId = {}, done = {}, busy = {};
    items.forEach(function (a) { byId[a.id] = a; });

    function build(a) {
      if (done[a.id]) return done[a.id];
      if (busy[a.id]) return null;               // цикл родителей: считаем как основную
      busy[a.id] = true;
      var parent = a.parentId && a.parentId !== a.id && byId[a.parentId] ? build(byId[a.parentId]) : null;
      var lines = [], U = rules.abilities.upgrade;
      var targets = abilityTargets(a, rules), alloc = {};
      ALLOC_ORDER.forEach(function (k) { var v = a.alloc ? parseFloat(a.alloc[k]) : 0; alloc[k] = targets.indexOf(k) !== -1 && isFinite(v) && v > 0 ? v : 0; });
      var temps = [];
      function segsFor(text) { var raw = parseAbilityText(text, defs, rules.abilities.effects, rules.abilities.allStats).map(function (s) {
        if (!s.token) return s;
        var tk = s.token;
        if (tk.effect) {
          var ef = rules.abilities.effects[tk.effect], pe = tk.mark === 'x' ? (tk.num - 1) * 100 : tk.num, ep = tk.effAll ? 'statusAll' : (ef.pool || 'status'), bp = upgradeGain(ep, alloc[ep], rules), pn = pe + bp;
          var el = { key: ep === 'unique' ? 'unique' : 'status', pool: ep, effAll: !!tk.effAll, kind: 'effect', effect: tk.effect, label: ef.label + (tk.effAll ? ' (все статы)' : ''), unit: '%', src: tk.src, percent: pe, bonusPp: bp, allocAp: alloc[ep], percentNow: pn, factorNow: 1 + pn / 100, factor: 1 + pe / 100, value: pn,
            formula: n(pe, 1) + '%' + (bp ? ' + ' + n(bp, 2) + '% (прокачка: ' + n(alloc[ep], 0) + ' AP × ' + (ep === 'unique' ? U.physPercentPerStep : U.statusPercentPerStep) + '%' + (tk.effAll ? ' ÷ ' + rules.abilities.allStats.length + ' (все статы)' : '') + ' / ' + U.stepAp + ' AP)' : '') + ' = ' + n(pn, 1) + '% (' + (tk.effect === 'debuff' ? '÷' : '×') + n(1 + pn / 100, 2) + ')' };
          lines.push(el);
          return { line: el };
        }
        var def = defs[tk.key], pool = tk.viaAll ? 'all' : tk.key, low = !!def.betterLower, line = { key: tk.key, pool: pool, label: def.label, unit: def.unit, src: tk.src, viaAll: !!tk.viaAll, betterLower: low };
        if (parent) {
          var pl = parent.lines.filter(function (l) { return l.key === tk.key; })[0];
          if (!pl) return { text: tk.src, missing: true };
          var k0 = tk.mark === '%' ? tk.num / 100 : tk.num;
          var bonusPp = upgradeGain(pool, alloc[pool], rules), k = k0 + bonusPp / 100;
          line.child = true; line.parentName = parent.name; line.k0 = k0; line.k = k; line.bonusPp = bonusPp; line.allocAp = alloc[pool];
          line.base = pl.value; line.value = low ? pl.value / k : pl.value * k; line.valueNoUpgrade = low ? pl.value / k0 : pl.value * k0;
          line.formula = n(pl.value, 1) + (low ? ' ÷ ' : ' × ') + n(k, 3) + (bonusPp ? ' (' + n(k0, 3) + ' + ' + n(bonusPp, 2) + '% прокачки)' : '') + ' (от «' + parent.name + '») = ' + n(line.value, 1) + ' ' + def.unit;
        } else {
          var pct = tk.mark === 'x' ? (tk.num - 1) * 100 : tk.num;
          var F = power.scopes[def.scope].value / power.base;
          var bonusPp = upgradeGain(pool, alloc[pool], rules), pctNow = pct + bonusPp;
          line.percent = pct; line.factor = 1 + pct / 100; line.power = F;
          line.bonusPp = bonusPp; line.allocAp = alloc[pool]; line.percentNow = pctNow; line.factorNow = 1 + pctNow / 100;
          line.effPercent = pctNow * F; line.effFactor = 1 + line.effPercent / 100;
          var ub = user[tk.key], dv = function (x) { return low ? ub / x : ub * x; };
          line.base = ub; line.value = dv(line.effFactor); line.valuePlain = dv(line.factorNow);
          line.valueNoUpgrade = dv(1 + pct * F / 100);
          line.formula = n(ub, 1) + (low ? ' ÷ (1 + ' : ' × (1 + ') + n(pct, 1) + (bonusPp ? ' + ' + n(bonusPp, 2) + ' (прокачка)' : '') + '%' + (F !== 1 ? ' × ' + n(F, 3) + ' (сила атрибута)' : '') + ') = ' + n(ub, 1) + (low ? ' ÷ ' : ' × ') + n(line.effFactor, 3) + ' = ' + n(line.value, 1) + ' ' + def.unit;
        }
        if (tk.key === 'speed') line.ms = kmhToMs(line.value);
        lines.push(line);
        return { line: line };
      });
      return [].concat.apply([], raw.map(function (s) { return s.text !== undefined && !s.missing ? expandPlain(s.text, power, rules, alloc) : [s]; })).map(function (x) { if (x.temp) temps.push(x.temp); return x; }); }
      var segments = segsFor(a.description);
      var strs = function (v) { return (Array.isArray(v) ? v : []).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean); };
      var prosSegs = strs(a.pros).map(segsFor), consSegs = strs(a.cons).map(segsFor);
      var fixed = !!a.fixedCost;
      var res = { id: a.id, name: a.name || '', description: a.description || '', ap: num(a.ap, 0), parentId: parent ? a.parentId : '', parentName: parent ? parent.name : '',
        entry: num(a.entryCost, null), upkeep: num(a.upkeepCost, null), upkeepNote: a.upkeepNote || '', fixedCost: fixed, segments: segments, pros: prosSegs, cons: consSegs, lines: lines, temps: temps,
        images: (Array.isArray(a.images) ? a.images : []).filter(function (u) { return typeof u === 'string' && /^(data:image\/|https:\/\/)/.test(u); }).slice(0, rules.abilities.maxImages || 6) };
      var total = 0; Object.keys(alloc).forEach(function (k) { total += alloc[k]; });
      res.alloc = alloc; res.targets = targets; res.allocTotal = total; res.allocFree = res.ap - total; res.upgradeSteps = Math.floor(res.ap / U.stepAp);
      res.entryEff = res.entry === null ? null : fixed ? res.entry : reduceCost(res.entry, ap, rules);
      res.upkeepEff = res.upkeep === null ? null : fixed ? res.upkeep : reduceCost(res.upkeep, ap, rules);
      busy[a.id] = false; done[a.id] = res;
      return res;
    }
    var out = items.map(build).filter(Boolean);
    // AP, вложенные в подспособности, берутся из пула родителя: они уже «потрачены» и не считаются свободными
    out.forEach(function (r) {
      var kids = 0; out.forEach(function (c) { if (c.parentId === r.id) kids += c.ap; });
      r.childAp = kids; r.allocFree = r.ap - r.allocTotal - kids;
    });
    return out;
  }
  /* ---------- калькуляторы ---------- */

  function pressure(lift, areaCm2, rules) {
    var L = rules.lift, raw = lift / areaCm2, cap = lift * L.pressureMaxMultiplier, v = Math.min(raw, cap);
    return { value: v, raw: raw, cap: cap, capped: raw > cap, area: areaCm2,
      formula: n(lift, 1) + ' ÷ ' + n(areaCm2, 2) + ' см² = ' + n(raw, 2) + ' кг/см²' + (raw > cap ? ' → потолок ×' + L.pressureMaxMultiplier + ' = ' + n(cap, 1) : '') };
  }

  function waterRun(massKg, speedMs, rules) {
    var W = rules.speed.water, need;
    if (massKg <= W.heavyThresholdKg) need = W.baseMs;
    else need = W.heavyMs + W.stepMs * Math.max(0, Math.ceil((massKg - W.heavyThresholdKg) / W.stepKg) - 1);
    return { requiredMs: need, currentMs: speedMs, available: speedMs >= need,
      deficitMs: Math.max(0, need - speedMs), deficitKmh: Math.max(0, msToKmh(need - speedMs)),
      formula: 'масса ' + (massKg || '?') + ' кг → нужно ' + need + ' м/с; есть ' + n(speedMs, 2) + ' м/с' + (speedMs >= need ? '' : ', не хватает ' + n(need - speedMs, 2) + ' м/с') };
  }

  function reactionCheck(attackKmh, reactionMs, rules, distanceM) {
    var R = rules.reaction;
    var dist = distanceM === undefined || distanceM <= R.meleeMaxM ? R.meleeDistanceM : distanceM;
    var v = kmhToMs(attackKmh), t = v > 0 ? dist / v * 1000 : Infinity, free = t - reactionMs;
    return { distance: dist, attackTimeMs: t, reactionMs: reactionMs, freeMs: free, aware: free >= 0, canCast: free >= reactionMs,
      formula: n(dist) + ' м ÷ ' + n(v, 2) + ' м/с = ' + n(t, 1) + ' мс; ' + n(t, 1) + ' − ' + n(reactionMs, 1) + ' = ' + n(free, 1) + ' мс свободного времени' };
  }

  function structureCast(reactionMs, volumeM3, rules) {
    var add = reactionMs * rules.reaction.structurePerM3 * volumeM3;
    return { value: reactionMs + add, formula: n(reactionMs, 1) + ' + ' + n(reactionMs, 1) + ' × ⅓ × ' + n(volumeM3) + ' м³ = ' + n(reactionMs + add, 1) + ' мс' };
  }

  function apReduction(ap, rules) {
    var st = rules.stamina;
    return Math.max(0, 1 - Math.floor((ap || 0) / st.apStep) * st.apReductionPercent / 100);
  }

  /** Трата после снижения от AP. ap — ОБЩЕЕ число AP персонажа. Изначально >=10% → не ниже 5%; <=5% → не ниже 0.5%. */
  function reduceCost(orig, ap, rules) {
    var f = rules.stamina.costFloor, floor = orig >= f.highFrom ? f.high : orig <= f.high ? f.low : f.high;
    floor = Math.min(floor, orig);
    return Math.max(floor, orig * apReduction(ap, rules));
  }
  /** Сколько персонаж продержит способность атрибута (вход + поддержание каждые N мин). */
  function attributeEndurance(ch, rules, o) {
    var at = ch.attribute || {};
    var entryBase = num(at.entryCost, 0), upBase = num(at.upkeepCost, 0), interval = num(at.upkeepIntervalMin, 0);
    if (!entryBase && !upBase) return null;
    var st = rules.stamina, people = 1 + (o.passengers || 0);
    var start = o.start !== undefined ? o.start : o.max;
    var entry = reduceCost(entryBase, o.ap, rules) * people, up = reduceCost(upBase, o.ap, rules) * people;
    var k = entryBase ? entry / people / entryBase : 1;   // фактический множитель трат (с учётом пола)
    var after = start - entry;
    var hasUp = up > 0 && interval > 0;
    var t0 = hasUp ? (after > 0 ? Math.floor(after / up + 1e-9) : 0) * interval : null;
    var tC = hasUp ? (after > st.critical ? Math.floor((after - st.critical) / up + 1e-9) : 0) * interval : null;
    return {
      max: o.max, start: start, apFactor: k, people: people, entry: entry, upkeep: up, interval: interval, hasUpkeep: hasUp,
      afterEntry: after, minutesTo0: t0, minutesToCritical: tC, critical: st.critical, canEnter: after > 0,
      formulaEntry: entryBase + '%' + (k !== 1 ? ' × ' + n(k, 2) + ' (AP)' : '') + (people > 1 ? ' × ' + people + ' чел.' : '') + ' = ' + n(entry, 2) + '%',
      formula0: hasUp ? '(' + n(start, 1) + ' − ' + n(entry, 2) + ') ÷ ' + n(up, 2) + '% × ' + interval + ' мин = ' + t0 + ' мин (до 0%)' : '',
      formulaC: hasUp ? '(' + n(start, 1) + ' − ' + n(entry, 2) + ' − ' + st.critical + ') ÷ ' + n(up, 2) + '% × ' + interval + ' мин = ' + tC + ' мин (до ' + st.critical + '%)' : ''
    };
  }

  function staminaRecovery(current, max, rules) {
    var st = rules.stamina, miss = Math.max(0, max - current);
    return { missing: miss, sleepHours: miss / st.sleepPerHour, restHours: miss / st.restPerHour,
      formula: 'сон: ' + n(miss, 1) + ' ÷ ' + st.sleepPerHour + ' = ' + n(miss / st.sleepPerHour, 2) + ' ч; отдых: ' + n(miss, 1) + ' ÷ ' + st.restPerHour + ' = ' + n(miss / st.restPerHour, 2) + ' ч' };
  }

  function woundsAgainst(force, P, zone, rules) {
    var D = rules.durability, z = D.zones[zone || 'normal'];
    var rows = D.wounds.map(function (w, i) {
      var div = z.divisor === 'byDegree' ? D.weakZone.start + D.weakZone.step * i : z.divisor;
      var need = P * w.factor / div;
      return { id: w.id, label: w.label, required: need, reached: force >= need, formula: n(P) + ' × ' + n(w.factor, 3) + (div !== 1 ? ' ÷ ' + n(div, 2) : '') + ' = ' + n(need, 1) + ' кг' };
    });
    var best = null;
    rows.forEach(function (rw) { if (rw.reached) best = rw; });
    return { rows: rows, best: best };
  }

  function erosion(force, P, speedRatio, rules) {
    var E = rules.durability.erosion, p = E.percentOfForce;
    if (speedRatio > 1 && Math.abs(force - P) > 1e-9) p = Math.max(E.minPercent, p - E.speedPenaltyPerX * Math.floor(speedRatio - 1 + 1e-9));
    var perHit = force * p / 100, hits = 0, cur = P;
    while (force < cur && hits < 200) { hits++; cur = Math.max(0, cur - perHit); }
    return { percent: p, perHit: perHit, hitsToHeavy: force >= P ? 0 : hits, capped: hits >= 200,
      formula: n(force, 1) + ' × ' + p + '% = −' + n(perHit, 1) + ' кг прочности зоны за удар (восстановление через ' + E.recoveryPosts + ' поста без ударов)' };
  }

  function martialProgress(sp, rules) {
    var lv = rules.martialArts.levels, cur = lv[0], next = null;
    lv.forEach(function (l, i) { if (sp >= l.sp) { cur = l; next = lv[i + 1] || null; } });
    return { sp: sp, level: cur, next: next, progress: next ? (sp - cur.sp) / (next.sp - cur.sp) : 1, toNext: next ? next.sp - sp : 0 };
  }

  function apProgress(ap, rules) {
    var A = rules.ap;
    return { ap: ap, upgrades: Math.floor(ap / A.upgradeStep), toNextUpgrade: A.upgradeStep - (ap % A.upgradeStep),
      stepProgress: (ap % A.upgradeStep) / A.upgradeStep, personification: A.personification,
      personificationProgress: Math.min(1, ap / A.personification), staminaFactor: apReduction(ap, rules) };
  }

  var api = {
    compute: compute, abilityStats: abilityStats, abilityTargets: abilityTargets, chain: chain, normBuff: normBuff, normalizeBuffs: normalizeBuffs, stackFactor: stackFactor,
    pressure: pressure, waterRun: waterRun, reactionCheck: reactionCheck, structureCast: structureCast,
    attributeEndurance: attributeEndurance, staminaRecovery: staminaRecovery, woundsAgainst: woundsAgainst,
    erosion: erosion, martialProgress: martialProgress, apProgress: apProgress,
    parseAbilityText: parseAbilityText, upgradeGain: upgradeGain, upgradeText: upgradeText, ALLOC_ORDER: ALLOC_ORDER, kmhToMs: kmhToMs, msToKmh: msToKmh, PHYS: PHYS, ALL: ALL
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RPEngine = api;
})(typeof window !== 'undefined' ? window : this);
