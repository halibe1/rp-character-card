/*
 * model.js — модель персонажа: пустой персонаж, приведение старых/чужих данных к полному формату, очистка формы.
 */
(function () {
  'use strict';

  var RULES = (window.RP_DATA || {}).rules, E = window.RPEngine;
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  function blankCharacter() {
    return {
      id: '', name: '', gift: '',
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
    if (RULES.maxTraits) c.traits = c.traits.slice(0, RULES.maxTraits);
    c.buffs = c.buffs.map(upgradeBuff);
    if (typeof c.gift !== 'string' || !(RULES.gifts || {})[c.gift]) c.gift = '';
    c.abilities = onePersona((Array.isArray(c.abilities) ? c.abilities : []).filter(function (a) { return a && typeof a === 'object'; }).slice(0, RULES.abilities.max).map(normAbility));
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
    if (a && a.alloc && E.migrateAlloc) a = E.migrateAlloc(a, a.persona === true && !a.parentId ? E.personaRules(RULES) : RULES);
    return { id: String(a.id || makeBuffId()), name: String(a.name || ''), description: String(a.description || ''), upkeepNote: String(a.upkeepNote || ''),
      parentId: String(a.parentId || ''), fixedCost: a.fixedCost === true, persona: a.persona === true, personaAp: a.personaAp === undefined || a.personaAp === '' ? RULES.abilities.personaUnlockAp || 1000 : a.personaAp, subCount: a.subCount === undefined || a.subCount === '' ? 0 : a.subCount, alloc: normAlloc(a.alloc), pros: normList(a.pros), cons: normList(a.cons), ap: a.ap === undefined || a.ap === '' ? 0 : a.ap,
      entryCost: a.entryCost === undefined ? null : a.entryCost, upkeepCost: a.upkeepCost === undefined ? null : a.upkeepCost,
      images: (Array.isArray(a.images) ? a.images : []).filter(function (u) { return typeof u === 'string' && /^(data:image\/|https:\/\/)/.test(u); }).slice(0, RULES.abilities.maxImages || 6) };
  }  var ALLOC_KEYS = E.ALLOC_ORDER.slice();
  var ALLOC_LABEL = { punch: 'Сила удара', speed: 'Скорость', durability: 'Прочность', radius: 'Радиус / дальность', other: 'Прочие числа', lift: 'Сила на подъём', reaction: 'Реакция', all: 'Все статы (удар, подъём, скорость, реакция)', statusAll: 'Эффект на все статы цели', unique: 'Счётчик 1', unique2: 'Счётчик 2', unique3: 'Счётчик 3', unique4: 'Счётчик 4', unique5: 'Счётчик 5', unique6: 'Счётчик 6', unique7: 'Счётчик 7', unique8: 'Счётчик 8', status: 'Эффект на цель (бафф / дебафф)', heat: 'Нагрев, °C', cold: 'Охлаждение, °C' };
  /** Олицетворение у персонажа одно и только у основной способности. */
  function onePersona(list) {
    var seen = false;
    list.forEach(function (a) { if (a.persona && (seen || a.parentId)) a.persona = false; if (a.persona) seen = true; });
    return list;
  }
  function normList(v) { return (Array.isArray(v) ? v : []).map(function (x) { return String(x == null ? '' : x); }); }
  function normAlloc(al) {
    var o = {}; ALLOC_KEYS.forEach(function (k) { var v = al ? parseFloat(al[k]) : 0; o[k] = isFinite(v) && v > 0 ? v : 0; }); return o;
  }
  function makeBuffId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function makeId(name) {
    var base = String(name || 'char').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') || 'char';
    return base + '-' + Math.random().toString(36).slice(2, 7);
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
    if (!(RULES.gifts || {})[c.gift]) c.gift = '';
    c.attribute.name = String(c.attribute.name || '').trim();
    c.attribute.entryCost = n(c.attribute.entryCost);
    c.attribute.upkeepCost = n(c.attribute.upkeepCost);
    c.attribute.upkeepIntervalMin = n(c.attribute.upkeepIntervalMin);
    Object.keys(c.stats).forEach(function (k) { c.stats[k] = n(c.stats[k]) || 0; });
    if (c.stats.reaction < RULES.reaction.absoluteMs) c.stats.reaction = RULES.reaction.absoluteMs;
    ['ap', 'sp', 'weightKg', 'awakenings'].forEach(function (k) { c[k] = Math.max(0, n(c[k]) || 0); });
    c.styles = c.styles.filter(function (s) { return String(s.name || '').trim(); }).map(function (s) { return { name: s.name.trim(), strikeType: s.strikeType || '' }; });
    c.traits = c.traits.filter(function (t) { return String(t.name || '').trim(); }).slice(0, RULES.maxTraits || undefined).map(function (t) { return { name: t.name.trim(), description: String(t.description || '').trim() }; });
    var ids = {};
    c.abilities = (c.abilities || []).filter(function (a) { return String(a.name || '').trim(); }).slice(0, RULES.abilities.max).map(function (a) {
      ids[String(a.id || '')] = true;
      return { id: String(a.id || makeBuffId()), name: String(a.name).trim(), description: String(a.description || '').trim(), upkeepNote: String(a.upkeepNote || '').trim(), parentId: String(a.parentId || ''),
        fixedCost: a.fixedCost === true, persona: a.persona === true, personaAp: Math.max(0, n(a.personaAp) || 0), subCount: Math.max(0, Math.floor(n(a.subCount) || 0)), alloc: cleanAlloc(a), pros: normList(a.pros).map(function (s) { return s.trim(); }).filter(Boolean), cons: normList(a.cons).map(function (s) { return s.trim(); }).filter(Boolean), ap: Math.max(0, n(a.ap) || 0), entryCost: n(a.entryCost), upkeepCost: n(a.upkeepCost),
        images: (Array.isArray(a.images) ? a.images : []).filter(function (u) { return typeof u === 'string' && /^(data:image\/|https:\/\/)/.test(u); }).slice(0, RULES.abilities.maxImages || 6) };
    });    c.abilities.forEach(function (a) { if (!ids[a.parentId] || a.parentId === a.id) a.parentId = ''; });
    onePersona(c.abilities);
    c.buffs = c.buffs.filter(function (b) { return n(b.percent); }).map(function (b) {
      var u = upgradeBuff(Object.assign({}, b, { percent: n(b.percent) }));
      var scoped = RULES.modifiers[u.stat] && RULES.modifiers[u.stat].scoped;
      return { id: u.id || makeBuffId(), group: String(u.group || ''), mode: u.mode, stat: u.stat, percent: u.percent, type: u.type, layer: u.layer, scope: scoped ? u.scope : 'all', source: u.source || '', label: String(u.label || '').trim(), enabled: u.enabled, max: u.mode === 'gradual' ? Math.max(0, n(u.max) || 0) : undefined };
    });
    return c;
  }


  window.RPModel = { blankCharacter: blankCharacter, normalize: normalize, upgradeBuff: upgradeBuff, normAbility: normAbility, normList: normList, onePersona: onePersona, normAlloc: normAlloc, ALLOC_KEYS: ALLOC_KEYS, ALLOC_LABEL: ALLOC_LABEL, makeBuffId: makeBuffId, makeId: makeId, cleanDraft: cleanDraft };
})();
