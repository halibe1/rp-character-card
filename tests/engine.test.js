/*
 * Тесты engine.js. Запуск: node tests/engine.test.js
 * Без зависимостей: только встроенные assert и require.
 */
'use strict';
const assert = require('assert');
global.window = {};
require('../data/rules.js');
require('../data/characters.js');
const RULES = global.window.RP_DATA.rules;
const KENOS = global.window.RP_DATA.characters[0];
const E = require('../js/engine.js');

const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps === undefined ? 0.05 : eps), `${a} ≉ ${b}`);
const clone = o => JSON.parse(JSON.stringify(o));
const opt = { stacking: RULES.bonusStacking };
const B = (percent, extra) => Object.assign({ stat: 'x', mode: 'passive', percent: percent }, extra);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function section(t) { console.log('\n' + t); }

/** Персонаж Кенос + добавленные бонусы. */
function kenos(extra) { const c = clone(KENOS); c.buffs = c.buffs.concat(extra || []); return c; }
const run = (c, mode, o) => E.compute(c, RULES, Object.assign({ mode }, o || {}));

section('Формула слоёв: база × внутр.баф ÷ внутр.дебаф × внешн.баф ÷ внешн.дебаф');

test('пример: (100 × 2) / 1.5 = 133.3', () => {
  const r = E.chain(100, [B(100, { layer: 'internal', type: 'buff' }), B(50, { layer: 'internal', type: 'debuff' })], opt);
  near(r.value, 133.33, 0.01);
  assert.strictEqual(Math.round(r.value * 10) / 10, 133.3);
});

test('дебафф без баффа делит значение, а не вычитает процент (÷1.5, не −50%)', () => {
  const r = E.chain(100, [B(50, { layer: 'internal', type: 'debuff' })], opt);
  near(r.value, 66.667, 0.001);        // 100 / 1.5
  assert.notStrictEqual(Math.round(r.value), 50);
});

test('внутренний и внешний слои считаются независимо (×2 · ×1.5 = ×3, а не 1 + 1 + 0.5 = ×2.5)', () => {
  const r = E.chain(100, [B(100, { layer: 'internal' }), B(50, { layer: 'external' })], opt);
  near(r.value, 300, 1e-9);
  assert.strictEqual(r.parts.internalBuff.factor, 2);
  assert.strictEqual(r.parts.externalBuff.factor, 1.5);
});

test('все четыре звена: 100 × 2 ÷ 1.5 × 1.5 ÷ 2 = 100', () => {
  const r = E.chain(100, [
    B(100, { layer: 'internal', type: 'buff' }), B(50, { layer: 'internal', type: 'debuff' }),
    B(50, { layer: 'external', type: 'buff' }),  B(100, { layer: 'external', type: 'debuff' })], opt);
  near(r.value, 100, 1e-9);
  assert.deepStrictEqual(r.steps.map(s => s.key), ['internalBuff', 'internalDebuff', 'externalBuff', 'externalDebuff']);
});

test('внешний дебафф не гасит внутренний баф «внутри слоя»: суммы слоёв раздельны', () => {
  const r = E.chain(100, [B(100, { layer: 'internal' }), B(100, { layer: 'external', type: 'debuff' })], opt);
  near(r.value, 100, 1e-9);                       // ×2 ÷2
  assert.strictEqual(r.parts.internalDebuff.factor, 1);
  assert.strictEqual(r.parts.externalBuff.factor, 1);
});

test('бафы одного источника складываются: +40% и +60% = ×2', () => {
  near(E.chain(100, [B(40, { source: 'trait' }), B(60, { source: 'trait' })], opt).value, 200, 1e-9);
});

test('разные источники перемножаются: атрибут +40% и трейты +60% = ×1.4 · ×1.6 = ×2.24; без источника — отдельные множители', () => {
  near(E.chain(100, [B(40, { source: 'attribute' }), B(60, { source: 'trait' })], opt).value, 224, 1e-9);
  near(E.chain(100, [B(40), B(60)], opt).value, 224, 1e-9);
});

test('режим multiplicative меняет только сложение внутри слоя: ×1.4 · ×1.6 = ×2.24', () => {
  near(E.chain(100, [B(40), B(60)], { stacking: 'multiplicative' }).value, 224, 1e-9);
});

test('реакция (меньше = лучше): баф делит мс, дебафф умножает', () => {
  near(E.chain(230, [B(40)], { stacking: 'additive', lowerBetter: true }).value, 164.29, 0.01);
  near(E.chain(230, [B(50, { type: 'debuff' })], { stacking: 'additive', lowerBetter: true }).value, 345, 1e-9);
});

test('отключённый бонус (enabled:false) не учитывается', () => {
  near(E.chain(100, [B(100, { enabled: false })], opt).value, 100, 1e-9);
});

section('Обратная совместимость данных');

test('нет layer → внутренний; нет type → знак процента', () => {
  const a = E.normBuff({ stat: 'punch', percent: 40, mode: 'passive' });
  assert.strictEqual(a.layer, 'internal'); assert.strictEqual(a.type, 'buff'); assert.strictEqual(a.scope, 'all');
  const b = E.normBuff({ stat: 'punch', percent: -40, mode: 'active' });
  assert.strictEqual(b.type, 'debuff'); assert.strictEqual(b.magnitude, 40);
});

test('старый формат Кеноса (без layer/type/enabled) даёт те же 164.3 мс', () => {
  const old = clone(KENOS);
  old.buffs = [{ mode: 'passive', stat: 'reaction', percent: 40, source: 'attribute', label: 'Стеклоподобные зрачки' }];
  near(run(old, 'passive').stats.reaction.value, 164.29, 0.01);
});

section('Кенос: эталонные значения (раздел 7 ТЗ)');

const REF = {
  base:    { punch: 1000, lift: 200, speed: 10, reaction: 230,    stamina: 100, durability: 3000, pierce: 1400, kick: 1200, explosive: 400, attack: 15 },
  passive: { punch: 1000, lift: 200, speed: 10, reaction: 164.29, stamina: 100, durability: 3000, pierce: 1400, kick: 1200, explosive: 400, attack: 15 },
  active:  { punch: 1000, lift: 200, speed: 10, reaction: 164.29, stamina: 100, durability: 3000, pierce: 1400, kick: 1200, explosive: 400, attack: 15 }
};
['base', 'passive', 'active'].forEach(mode => test('режим «' + mode + '»', () => {
  const r = run(KENOS, mode), s = r.stats, d = r.derived, e = REF[mode];
  near(s.punch.value, e.punch); near(s.lift.value, e.lift); near(s.speed.value, e.speed);
  near(s.reaction.value, e.reaction); near(s.stamina.value, e.stamina);
  near(d.durability.value, e.durability);
  near(d.strikes.filter(x => x.key === 'pierce')[0].value, e.pierce);
  near(d.strikes.filter(x => x.key === 'kick')[0].value, e.kick);
  near(d.explosive.value, e.explosive); near(d.attackSpeed.kmh, e.attack);
  // новые параметры у Кеноса без бонусов = база
  near(d.mods.attrPower.value, 100); near(d.mods.artPower.value, 100);
}));

section('Предел: внутренние бафы не влияют, внешние считаются');

test('внутренний баф +100% силы удара: нагрузка на предел ×1', () => {
  const r = run(kenos([{ stat: 'punch', mode: 'active', percent: 100, layer: 'internal', source: 'attribute' }]), 'active');
  near(r.stats.punch.value, 2000); near(r.stats.punch.limitRatio, 1, 1e-9);
});
test('внешний баф +100% (саппорт): значение ×2 и нагрузка ×2 → уровень 1', () => {
  const r = run(kenos([{ stat: 'punch', mode: 'active', percent: 100, layer: 'external' }]), 'active');
  near(r.stats.punch.value, 2000); near(r.stats.punch.limitRatio, 2, 1e-9);
  assert.strictEqual(r.derived.limit.worst.zone.level, 1);
});
test('собственный артефакт (внутренний слой) всё равно может превысить предел', () => {
  const r = run(kenos([{ stat: 'punch', mode: 'active', percent: 200, layer: 'internal', source: 'artifact' }]), 'active');
  near(r.stats.punch.limitRatio, 3, 1e-9);
});
test('внутренний + внешний: 1000 × 2 × 1.5 = 3000, естественный максимум 2000, нагрузка ×1.5', () => {
  const r = run(kenos([
    { stat: 'punch', mode: 'passive', percent: 100, layer: 'internal', source: 'trait' },
    { stat: 'punch', mode: 'active',  percent: 50,  layer: 'external' }]), 'active');
  near(r.stats.punch.value, 3000); near(r.stats.punch.natural, 2000); near(r.stats.punch.limitRatio, 1.5, 1e-9);
});

section('Новые множители: сила атрибута, прочность, сила боевого искусства');

test('сила атрибута: +25% только скорости → скорость 125%, радиус и мощность 100%', () => {
  const m = run(kenos([{ stat: 'attrPower', scope: 'speed', percent: 25, mode: 'passive', layer: 'internal' }]), 'passive').derived.mods.attrPower;
  near(m.scopes.speed.value, 125); near(m.scopes.radius.value, 100); near(m.scopes.power.value, 100); near(m.scopes.all.value, 100);
});
test('сила атрибута: scope=all действует на все аспекты и складывается с точечным', () => {
  const m = run(kenos([
    { stat: 'attrPower', scope: 'all',   percent: 50, mode: 'passive', layer: 'internal', source: 'attribute' },
    { stat: 'attrPower', scope: 'speed', percent: 25, mode: 'passive', layer: 'internal', source: 'attribute' }]), 'passive').derived.mods.attrPower;
  near(m.scopes.all.value, 150); near(m.scopes.radius.value, 150); near(m.scopes.speed.value, 175);
});
test('сила атрибута: внешний дебафф ÷2 и внутренний баф ×2 → 100 × 2 ÷ 2 = 100', () => {
  const m = run(kenos([
    { stat: 'attrPower', percent: 100, mode: 'passive', layer: 'internal' },
    { stat: 'attrPower', percent: 100, mode: 'passive', layer: 'external', type: 'debuff' }]), 'passive').derived.mods.attrPower;
  near(m.value, 100, 1e-9);
});
test('сила боевого искусства: пример (100 × 2) / 1.5 = 133.3', () => {
  const m = run(kenos([
    { stat: 'artPower', percent: 100, mode: 'passive', layer: 'internal' },
    { stat: 'artPower', percent: 50,  mode: 'passive', layer: 'internal', type: 'debuff' }]), 'passive').derived.mods.artPower;
  near(m.value, 133.33, 0.01);
});
test('прочность: множитель ×2 → 6000 кг; внешний дебафф 50% → 3000 ÷ 1.5 = 2000 кг', () => {
  near(run(kenos([{ stat: 'durability', percent: 100, mode: 'passive', layer: 'internal' }]), 'passive').derived.durability.value, 6000);
  near(run(kenos([{ stat: 'durability', percent: 50, type: 'debuff', mode: 'active', layer: 'external' }]), 'active').derived.durability.value, 2000);
});
test('прочность: минимум 1500 кг применяется до множителя, дебафф может опустить ниже', () => {
  const weak = clone(KENOS); weak.stats.punch = 100;
  near(run(weak, 'base').derived.durability.value, 1500);
  weak.buffs = [{ stat: 'durability', percent: 50, type: 'debuff', mode: 'passive', layer: 'internal' }];
  near(run(weak, 'passive').derived.durability.value, 1000);
});
test('новые параметры учитывают режимы: пассивный баф есть в passive/active, нет в base; активный только в active', () => {
  const c = kenos([
    { stat: 'attrPower', percent: 20, mode: 'passive', layer: 'internal' },
    { stat: 'artPower',  percent: 30, mode: 'active',  layer: 'internal' }]);
  near(run(c, 'base').derived.mods.attrPower.value, 100);   near(run(c, 'passive').derived.mods.attrPower.value, 120);
  near(run(c, 'active').derived.mods.attrPower.value, 120); near(run(c, 'passive').derived.mods.artPower.value, 100);
  near(run(c, 'active').derived.mods.artPower.value, 130);
});
test('stat:"all" не затрагивает новые параметры и стамину', () => {
  const r = run(kenos([{ stat: 'all', percent: 100, mode: 'passive', layer: 'internal' }]), 'passive');
  near(r.stats.punch.value, 2000); near(r.stats.stamina.value, 100); near(r.derived.mods.attrPower.value, 100);
});
test('ранения применяются после слоёв: 1000 × 2 ÷ 1.3 (тяжёлое)', () => {
  const r = run(kenos([{ stat: 'punch', percent: 100, mode: 'passive', layer: 'internal' }]), 'passive', { wounds: [{ degree: 'heavy', stat: 'punch', enabled: true }] });
  near(r.stats.punch.value, 2000 / 1.3, 0.01);
});

section('Механика: сила атрибута / боевого искусства усиливает бафы своего источника');

const atk = { stat: 'punch', mode: 'passive', percent: 100, layer: 'internal', source: 'attribute' };
const pw = (percent, extra) => Object.assign({ stat: 'attrPower', mode: 'passive', percent: percent, layer: 'internal' }, extra);

test('баф атрибута +100%, сила атрибута +200% (×3) → баф 300% → удар ×4 = 4000', () => {
  const r = run(kenos([atk, pw(200)]), 'passive');
  near(r.derived.powerFactors.attrPower, 3, 1e-9);
  near(r.stats.punch.value, 4000);
  near(r.stats.punch.chain.parts.internalBuff.percent, 300, 1e-9);
});
test('сила атрибута +0.4 (140%): баф 100% → 140% → удар ×2.4 = 2400', () => {
  near(run(kenos([atk, pw(40)]), 'passive').stats.punch.value, 2400);
});
test('дебафф силы атрибута ×1.5: баф 100% ÷ 1.5 = 66.7% → удар 1666.7', () => {
  const r = run(kenos([atk, pw(50, { type: 'debuff' })]), 'passive');
  near(r.stats.punch.chain.parts.internalBuff.percent, 66.667, 0.001);
  near(r.stats.punch.value, 1666.67, 0.01);
});
test('усиливаются только бафы источника «атрибут»; трейты и внешние не трогает', () => {
  const r = run(kenos([{ stat: 'punch', mode: 'passive', percent: 100, layer: 'internal', source: 'trait' }, pw(200)]), 'passive');
  near(r.stats.punch.value, 2000);
  near(run(kenos([{ stat: 'punch', mode: 'passive', percent: 100, layer: 'external' }, pw(200)]), 'passive').stats.punch.value, 2000);
});
test('аспект: «скорость» и «радиус» не усиливают бафы, «мощность» и «все» усиливают', () => {
  near(run(kenos([atk, pw(200, { scope: 'speed' })]), 'passive').stats.punch.value, 2000);
  near(run(kenos([atk, pw(200, { scope: 'radius' })]), 'passive').stats.punch.value, 2000);
  near(run(kenos([atk, pw(200, { scope: 'power' })]), 'passive').stats.punch.value, 4000);
});
test('сила боевого искусства усиливает бафы источника «стиль», а не «атрибут»', () => {
  const style = { stat: 'punch', mode: 'passive', percent: 50, layer: 'internal', source: 'style' };
  near(run(kenos([style, { stat: 'artPower', mode: 'passive', percent: 100, layer: 'internal' }]), 'passive').stats.punch.value, 2000);
  near(run(kenos([style, pw(100)]), 'passive').stats.punch.value, 1500);
});
test('Кенос: зрачки +40% реакции при силе атрибута ×2 → 80% → 230 ÷ 1.8 = 127.8 мс', () => {
  near(run(kenos([pw(100)]), 'passive').stats.reaction.value, 127.78, 0.01);
});
test('в базовом режиме сила не действует (бафов нет)', () => {
  near(run(kenos([atk, pw(200)]), 'base').stats.punch.value, 1000);
});
test('усиленный внутренний баф не двигает предел', () => {
  const r = run(kenos([atk, pw(200)]), 'active');
  near(r.stats.punch.limitRatio, 1, 1e-9);
});
section('Способности атрибута: текст с метками, статы от статов персонажа и силы атрибута');

const abil = (c, mode) => run(c, mode).derived.abilities;
const line = (a, k) => a.lines.filter(l => l.key === k)[0];
const withAb = (c, list) => { c.abilities = list; return c; };

test('Зеркало Кеноса: ×10.1 (910%) от силы удара 1000 = 10100 кг; скорость 10 → 101 км/ч; прочность 3000 × 3.8 = 11400', () => {
  const m = abil(KENOS, 'base').find(x => x.id === 'mirror');
  near(line(m, 'punch').value, 10100, 1e-6); near(line(m, 'speed').value, 101, 1e-6); near(line(m, 'durability').value, 11400, 1e-6);
  near(line(m, 'punch').factor, 10.1, 1e-9);
});
test('текст остаётся текстом: сегменты чередуются «текст / число»', () => {
  const m = abil(KENOS, 'base').find(x => x.id === 'mirror');
  assert.ok(m.segments[0].text.indexOf('Кенос призывает') === 0);
  assert.strictEqual(m.segments.filter(s => s.line).length, 3);
  assert.ok(m.segments.filter(s => s.text).every(s => s.text.indexOf('{') === -1));
});
test('форматы метки: 910%, 910, x10.1, ×10.1, русская «х10.1», русские названия', () => {
  const segs = s => E.parseAbilityText(s, RULES.abilities.stats).filter(x => x.token).map(x => x.token);
  assert.strictEqual(segs('{speed 910%}')[0].num, 910);
  assert.strictEqual(segs('{speed x10.1}')[0].mark, 'x');
  assert.strictEqual(segs('{speed ×10.1}')[0].mark, 'x');
  assert.strictEqual(segs('{speed х10,1}')[0].num, 10.1);
  assert.strictEqual(segs('{сила удара 910}')[0].key, 'punch');
  assert.strictEqual(segs('{прочность: 280%}')[0].key, 'durability');
  assert.strictEqual(segs('{нет такого 5}').length, 0);
});
test('×10.1 и 910% дают одно и то же значение', () => {
  const a = abil(withAb(clone(KENOS), [{ id: 'a', name: 'A', description: '{punch x10.1}' }]), 'base')[0];
  const b = abil(withAb(clone(KENOS), [{ id: 'b', name: 'B', description: '{punch 910%}' }]), 'base')[0];
  near(line(a, 'punch').value, line(b, 'punch').value, 1e-9);
});
test('Reflection Light: половина силы и скорости зеркала (от родителя)', () => {
  const l = abil(KENOS, 'base').find(x => x.id === 'reflection-light');
  near(line(l, 'punch').value, 5050, 1e-6); near(line(l, 'speed').value, 50.5, 1e-6);
  assert.strictEqual(l.parentName, 'Зеркало'); assert.strictEqual(line(l, 'durability'), undefined);
});
test('подспособность: метка в процентах (50%) = ×0.5', () => {
  const c = withAb(clone(KENOS), [{ id: 'p', name: 'P', description: '{punch 100%}' }, { id: 'c', name: 'C', parentId: 'p', description: '{punch 50%}' }]);
  near(line(abil(c, 'base')[1], 'punch').value, 0.5 * line(abil(c, 'base')[0], 'punch').value, 1e-9);
});
test('пример ×4 → ×16: бафф атрибута ×2 и способность ×2 дают ×4; при силе атрибута +200% (F=3) оба ×4 → ×16', () => {
  const ab = [{ id: 'x', name: 'X', description: '{punch x2}' }];
  const c = withAb(kenos([{ stat: 'punch', mode: 'passive', percent: 100, layer: 'internal', source: 'attribute' }]), ab);
  near(line(abil(c, 'passive')[0], 'punch').value, 4000, 1e-6);
  const c2 = withAb(kenos([{ stat: 'punch', mode: 'passive', percent: 100, layer: 'internal', source: 'attribute' }, { stat: 'attrPower', mode: 'passive', percent: 200, layer: 'internal' }]), ab);
  const l = line(abil(c2, 'passive')[0], 'punch');
  near(run(c2, 'passive').stats.punch.value, 4000);
  near(l.effFactor, 4, 1e-9); near(l.value, 16000, 1e-6);
});
test('сила атрибута усиливает и подспособность через родителя (×16 → ×0.5 = ×8)', () => {
  const c = withAb(kenos([{ stat: 'punch', mode: 'passive', percent: 100, layer: 'internal', source: 'attribute' }, { stat: 'attrPower', mode: 'passive', percent: 200, layer: 'internal' }]),
    [{ id: 'p', name: 'P', description: '{punch x2}' }, { id: 'c', name: 'C', parentId: 'p', description: '{punch 0.5}' }]);
  near(line(abil(c, 'passive')[1], 'punch').value, 8000, 1e-6);
});
test('аспекты: скорость способности берёт аспект «скорость», удар и прочность — «мощность»', () => {
  const c = withAb(kenos([{ stat: 'attrPower', scope: 'speed', percent: 100, mode: 'passive', layer: 'internal' }]), [{ id: 'x', name: 'X', description: '{speed 100%} {punch 100%}' }]);
  const a = abil(c, 'passive')[0];
  near(line(a, 'speed').power, 2, 1e-9); near(line(a, 'punch').power, 1, 1e-9);
});
test('статы берутся из выбранного режима', () => {
  const c = withAb(kenos([{ stat: 'punch', mode: 'active', percent: 100, layer: 'external' }]), [{ id: 'x', name: 'X', description: '{punch 100%}' }]);
  near(line(abil(c, 'base')[0], 'punch').value, 2000, 1e-6);
  near(line(abil(c, 'active')[0], 'punch').value, 4000, 1e-6);
});

section('Другие числа в тексте и картинки');
const withPower = pct => { const c = withAb(clone(KENOS), []); c.buffs = (c.buffs || []).concat([pw(pct, { scope: 'radius' }), pw(pct, { scope: 'speed' })]); return c; };
const textOf = (desc, pct) => { const c = withPower(pct); c.abilities = [{ id: 'a', name: 'A', description: desc }]; return run(c, 'passive').derived.abilities[0].segments; };
test('число с единицей (радиус 1 метр) растёт от силы атрибута: ×3 → 3', () => {
  const s = textOf('Радиус в 1 метр, дальность 10 м.', 200).filter(x => x.scaled);
  assert.strictEqual(s.length, 2); near(s[0].scaled.value, 3); near(s[1].scaled.value, 30); assert.strictEqual(s[0].scaled.scope, 'radius');
});
test('склонения: «1 метра», «10 метров», «5 метрах» тоже ловятся', () => {
  const s = textOf('1 метра, 10 метров, 5 метрах', 200).filter(x => x.scaled);
  assert.strictEqual(s.length, 3); near(s[1].scaled.value, 30);
});
test('аспект зависит от единицы: км/ч — «скорость», кг — «мощность» (радиусу сила скорости не помогает)', () => {
  const s = textOf('50 км/ч и 20 кг и 5 м', 200).filter(x => x.scaled);
  assert.deepStrictEqual(s.map(x => x.scaled.scope), ['speed', 'power', 'radius']);
  near(s[0].scaled.value, 150); near(s[1].scaled.value, 20); near(s[2].scaled.value, 15);
});
test('исключение {= 15 м}: число не меняется и помечено', () => {
  const s = textOf('Лучи до {= 15 м} длиной', 200);
  assert.strictEqual(s.filter(x => x.scaled).length, 0); assert.strictEqual(s.filter(x => x.fixed)[0].fixed, '15 м');
});
test('{~ 15 лучей}: число без единицы всё же масштабируется; можно указать аспект {~радиус 4}', () => {
  const s = textOf('{~ 15 лучей} и {~радиус 4} шага; всего 3 поста', 200).filter(x => x.scaled);
  near(s[0].scaled.value, 15 * (s[0].scaled.F)); assert.strictEqual(s[1].scaled.scope, 'radius'); near(s[1].scaled.value, 12);
  assert.strictEqual(s.length, 2);
});
test('без силы атрибута (F=1) числа остаются как есть; слова вроде «минут/метаться» не ловятся', () => {
  const s = textOf('5 минут, 1 метр', 0).filter(x => x.scaled);
  assert.strictEqual(s.length, 1); near(s[0].scaled.value, 1);
});
test('картинки способности: только data:image/https, не больше maxImages', () => {
  const c = clone(KENOS); c.abilities = [{ id: 'a', name: 'A', description: '', images: ['data:image/png;base64,AAA', 'javascript:alert(1)', 'https://x/y.png', 5].concat(new Array(10).fill('https://x/z.png')) }];
  const a = run(c, 'base').derived.abilities[0];
  assert.ok(a.images.every(u => /^(data:image\/|https:\/\/)/.test(u))); assert.strictEqual(a.images.length, RULES.abilities.maxImages);
});

section('Прокачка способности: AP, вложенные в показатели');
const upg = (desc, alloc, ap, extra) => { const c = clone(KENOS); c.abilities = [Object.assign({ id: 'a', name: 'A', ap: ap, alloc: alloc, description: desc }, extra || {})]; return abil(c, 'base')[0]; };
test('100 AP поровну на 4 показателя = 25 AP каждому → +7.5%: баф 100% становится 107.5%', () => {
  const m = upg('{punch 100%} {speed 100%} {durability 100%}', { punch: 25, speed: 25, durability: 25, radius: 25 }, 100);
  m.lines.forEach(l => { near(l.bonusPp, 7.5, 1e-9); near(l.percentNow, 107.5, 1e-9); near(l.percent, 100); });
  near(line(m, 'punch').value, 1000 * 2.075, 1e-6);
});
test('все 100 AP в один показатель = +30%; 300 AP = +90%; изначальный множитель сохраняется', () => {
  const m = upg('{punch 910%}', { punch: 300 }, 1000);
  near(line(m, 'punch').bonusPp, 90); near(line(m, 'punch').factor, 10.1); near(line(m, 'punch').factorNow, 11, 1e-9);
  near(line(m, 'punch').value, 11000, 1e-6); near(line(m, 'punch').valueNoUpgrade, 10100, 1e-6);
});
test('пример: 100 AP в радиус, 300 в силу, 300 в скорость, 300 в прочность — свободно 0', () => {
  const m = upg('{speed 910%} {durability 280%} {punch 910%} радиус 100 см', { radius: 100, punch: 300, speed: 300, durability: 300 }, 1000);
  near(m.allocTotal, 1000); near(m.allocFree, 0); near(line(m, 'speed').bonusPp, 90);
});
test('радиус: 100 см при 100 AP в радиус становится 115 (+15% от начального); 200 AP → 130; другие единицы не затронуты', () => {
  const sc = (al) => upg('радиус 100 см и 20 кг', al, 300).segments.filter(x => x.scaled);
  near(sc({ radius: 100 })[0].scaled.value, 115, 1e-9); near(sc({ radius: 200 })[0].scaled.value, 130, 1e-9);
  near(sc({ radius: 100 })[1].scaled.value, 20, 1e-9);
});
test('прокачка складывается с силой атрибута: (910% + 30%) × F', () => {
  const c = withPower(200); c.abilities = [{ id: 'a', name: 'A', ap: 100, alloc: { speed: 100 }, description: '{speed 100%}' }];
  const l = line(run(c, 'passive').derived.abilities[0], 'speed');
  near(l.effPercent, 130 * 3, 1e-9);
});
test('подспособность: прокачка добавляет к множителю родителя (0.5 + 30% = 0.8)', () => {
  const c = clone(KENOS);
  c.abilities = [{ id: 'p', name: 'P', description: '{punch 910%}' }, { id: 'c', name: 'C', parentId: 'p', ap: 100, alloc: { punch: 100 }, description: '{punch 0.5}' }];
  const [p, k] = abil(c, 'base'); near(line(k, 'punch').k, 0.8, 1e-9); near(line(k, 'punch').value, line(p, 'punch').value * 0.8, 1e-6);
});

test('AP можно вложить только в то, что есть в тексте: нет метки скорости → вложения в скорость не считаются', () => {
  const m = upg('{punch 910%} и число 5 м', { punch: 100, speed: 200, durability: 100, radius: 100, other: 100 }, 600);
  assert.deepStrictEqual(m.targets, ['punch', 'radius']);
  near(m.allocTotal, 200); near(m.allocFree, 400); near(m.alloc.speed, 0);
});
test('число с замочком {= 5 м} не даёт цели «радиус»; кг и {~ 3 луча} дают «прочие числа»', () => {
  assert.deepStrictEqual(upg('{= 5 м} и {speed 100%}', {}, 0).targets, ['speed']);
  assert.deepStrictEqual(upg('20 кг и {~ 3 луча}', {}, 0).targets, ['other']);
  const s = upg('20 кг', { other: 100 }, 100).segments.filter(x => x.scaled)[0].scaled; near(s.value, 23, 1e-9);
});

test('плюсы и минусы: отдельные списки, метки в них считаются как в описании', () => {
  const c = clone(KENOS); c.abilities = [{ id: 'a', name: 'A', description: 'x', pros: ['Скорость {speed 100%}', '  ', 'радиус 2 м'], cons: ['Минус {punch 50%}'] }];
  const a = abil(c, 'base')[0];
  assert.strictEqual(a.pros.length, 2); assert.strictEqual(a.cons.length, 1);
  near(a.pros[0].filter(s => s.line)[0].line.value, 20, 1e-9); near(a.cons[0].filter(s => s.line)[0].line.value, 1500, 1e-9);
  assert.ok(a.targets.indexOf('radius') !== -1 && a.targets.indexOf('speed') !== -1);
});

section('Траты способностей и AP');
const costOf = (cost, ap, fixed) => { const c = clone(KENOS); c.ap = ap; return abil(withAb(c, [{ id: 'a', name: 'A', entryCost: cost, upkeepCost: cost, fixedCost: fixed, description: '' }]), 'base')[0]; };
test('нефиксированные: каждые 100 AP −5% от изначальной траты (30% при 200 AP → 27%)', () => {
  near(costOf(30, 200, false).entryEff, 27, 1e-9); near(costOf(30, 99, false).entryEff, 30, 1e-9);
});
test('пол трат: изначально ≥10% → не ниже 5%; ≤5% → не ниже 0.5%', () => {
  near(costOf(50, 100000, false).entryEff, 5, 1e-9); near(costOf(10, 100000, false).entryEff, 5, 1e-9);
  near(costOf(30, 100000, false).entryEff, 5, 1e-9); near(costOf(5, 100000, false).entryEff, 0.5, 1e-9);
  near(costOf(3, 100000, false).entryEff, 0.5, 1e-9); near(costOf(2, 100000, false).entryEff, 0.5, 1e-9);
  near(costOf(0.4, 100000, false).entryEff, 0.4, 1e-9);
});
test('снижение идёт от общего AP персонажа: способность с 0 вложенных AP тоже дешевеет, 2000 AP → пол у всех', () => {
  const c = clone(KENOS); c.ap = 2000;
  const r = abil(withAb(c, [{ id: 'a', name: 'A', ap: 0, entryCost: 30, upkeepCost: 10, description: '' }, { id: 'b', name: 'B', ap: 0, entryCost: 5, upkeepCost: 5, description: '' }]), 'base');
  near(r[0].entryEff, 5, 1e-9); near(r[0].upkeepEff, 5, 1e-9); near(r[1].entryEff, 0.5, 1e-9);
});
test('фиксированные траты от AP не зависят', () => {
  near(costOf(30, 1000, true).entryEff, 30, 1e-9); near(costOf(30, 1000, true).upkeepEff, 30, 1e-9);
});
test('цикл родителей не зависает', () => {
  const c = withAb(clone(KENOS), [{ id: 'a', name: 'A', parentId: 'b', description: '{punch 1}' }, { id: 'b', name: 'B', parentId: 'a', description: '{punch 1}' }]);
  assert.ok(abil(c, 'base').length >= 1);
});
section('Эффекты на цель и температура');
test('дебафф врага: 40% + 100 AP = 60% (+20% за 100 AP), множитель ÷1.6', () => {
  const m = upg('Цель получает {дебафф 40%}.', { status: 100 }, 100);
  const l = m.lines[0]; assert.strictEqual(l.effect, 'debuff'); near(l.percentNow, 60, 1e-9); near(l.factorNow, 1.6, 1e-9);
  assert.ok(m.targets.includes('status'));
});
test('бафф союзника тоже +20% за 100 AP; сила атрибута на него не влияет', () => {
  const m = upg('{бафф 30%}', { status: 200 }, 200); near(m.lines[0].percentNow, 70, 1e-9);
});
test('нагрев: 500 °C + 100 AP = 550 °C; холод: -100 °C + 100 AP = -120 °C', () => {
  const m = upg('До 500 °C, холод -100 °C.', { heat: 100, cold: 100 }, 200);
  assert.strictEqual(m.temps.length, 2); near(m.temps[0].value, 550, 1e-9); near(m.temps[1].value, -120, 1e-9);
  assert.deepStrictEqual(m.targets.filter(k => k === 'heat' || k === 'cold'), ['heat', 'cold']);
});
test('диапазон «10–20 °C» не считается одной температурой', () => {
  const m = upg('Температура 10–20 °C.', {}, 0); assert.strictEqual(m.temps.length, 0);
});
test('замочек {= 500 °C} оставляет температуру нетронутой', () => {
  const m = upg('{= 500 °C}', { heat: 100 }, 100); assert.strictEqual(m.temps.length, 0);
});
test('AP нельзя вложить в температуру, которой нет в тексте', () => {
  const m = upg('Просто текст', { heat: 100 }, 100); assert.strictEqual(m.alloc.heat, 0);
});
section('Метка «все статы»');
test('{все 40%} = сила удара, подъём, скорость и реакция; прочность не входит', () => {
  const m = upg('Повышает {все 40%}.', {}, 0);
  assert.deepStrictEqual(m.lines.map(l => l.key).sort(), ['lift', 'punch', 'reaction', 'speed']);
  near(m.lines.find(l => l.key === 'punch').value, 1400, 1e-6); near(m.lines.find(l => l.key === 'lift').value, 280, 1e-6);
  near(m.lines.find(l => l.key === 'speed').value, 14, 1e-6); near(m.lines.find(l => l.key === 'reaction').value, 230 / 1.4, 1e-6);
  assert.deepStrictEqual(m.targets, ['all']);
});
test('100 AP в «все статы» дают +7.5% каждому из четырёх показателей (30% ÷ 4)', () => {
  const m = upg('{все статы 100%}', { all: 100 }, 100);
  m.lines.forEach(l => near(l.percentNow, 107.5, 1e-9));
  near(m.alloc.all, 100, 1e-9);
});
test('реакция в способности: баф делит мс (+100% → 230 ÷ 2 = 115)', () => {
  const m = upg('{реакция 100%}', {}, 0); near(m.lines[0].value, 115, 1e-6);
});
test('подъём отдельной меткой: {подъём 50%} = 200 × 1.5', () => {
  const m = upg('{подъём 50%}', {}, 0); near(m.lines[0].value, 300, 1e-6);
});

section('Эффект на все статы цели');
test('{дебафф все 40%}: 100 AP дают 20% ÷ 4 = +5% (40% → 45%)', () => {
  const m = upg('Цель получает {дебафф все 40%}.', { statusAll: 100 }, 100);
  near(m.lines[0].percentNow, 45, 1e-9); assert.strictEqual(m.lines[0].effAll, true); assert.deepStrictEqual(m.targets, ['statusAll']);
});
test('бафф на все статы тоже делится на 4; обычный {бафф 30%} остаётся отдельным пунктом (+20%)', () => {
  const m = upg('{бафф на все статы 30%} и {бафф 30%}', { statusAll: 100, status: 100 }, 200);
  near(m.lines[0].percentNow, 35, 1e-9); near(m.lines[1].percentNow, 50, 1e-9); assert.deepStrictEqual(m.targets, ['status', 'statusAll']);
});
console.log('\n' + (failed ? '✗ ПРОВАЛЕНО: ' + failed + ', ' : '') + 'пройдено: ' + passed + ' из ' + (passed + failed));
process.exit(failed ? 1 : 0);
