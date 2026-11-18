/*
 * Константы правил сервера. Внутри — обычный JSON.
 * Обёртка "window.RP_DATA.rules = ..." нужна, чтобы сайт открывался двойным кликом (file://).
 */
(window.RP_DATA = window.RP_DATA || {}).rules =
{
  "bonusStacking": "additive",

  "stats": {
    "punch":    { "label": "Сила удара",     "unit": "кг",   "short": "УДАР",   "betterLower": false, "barMax": 3000 },
    "lift":     { "label": "Сила на подъём", "unit": "кг",   "short": "ПОДЪЁМ", "betterLower": false, "barMax": 600 },
    "speed":    { "label": "Скорость",       "unit": "км/ч", "short": "СКОР",   "betterLower": false, "barMax": 100 },
    "reaction": { "label": "Реакция",        "unit": "мс",   "short": "РЕАКЦ",  "betterLower": true,  "barWorst": 400, "barBest": 50 },
    "stamina":  { "label": "Стамина",        "unit": "%",    "short": "СТАМ",   "betterLower": false, "barMax": 150 }
  },

  "modes": {
    "base":    { "label": "Базовые",   "includes": [] },
    "passive": { "label": "Пассивные", "includes": ["passive"] },
    "active":  { "label": "Активные",  "includes": ["passive", "active"] }
  },

  "buffSources": {
    "attribute": { "label": "Атрибут",   "affectsLimit": false },
    "trait":     { "label": "Трейты",    "affectsLimit": false },
    "style":     { "label": "Стиль",     "affectsLimit": false },
    "artifact":  { "label": "Артефакты", "affectsLimit": true },
    "external":  { "label": "Внешний",   "affectsLimit": true },
    "":          { "label": "Без источника", "affectsLimit": false }
  },

  "layers": {
    "internal": { "label": "Внутренние", "desc": "От самого персонажа: его атрибут, трейты, боевое искусство, собственные артефакты" },
    "external": { "label": "Внешние",    "desc": "От других: саппорты, чужие способности, дебаффы врагов, аномалии" }
  },

  "modifiers": {
    "attrPower":  { "label": "Сила атрибута",             "base": 100, "unit": "%", "scoped": true,  "desc": "Радиус, мощность и скорость способностей атрибута. Сам эффект (степень лечения, тип кислоты) не меняется; температура и другие измеримые величины усиливаются." },
    "artPower":   { "label": "Сила боевого искусства",    "base": 100, "unit": "%", "scoped": true,  "desc": "То же, что сила атрибута, но для приёмов боевого искусства." },
    "durability": { "label": "Множитель прочности",       "base": 1,   "unit": "кг", "scoped": false, "desc": "Множитель к прочности (сила удара × 3, минимум 1500 кг)." }
  },
  "scopes": {
    "all":    { "label": "Все аспекты" },
    "radius": { "label": "Радиус" },
    "power":  { "label": "Мощность" },
    "speed":  { "label": "Скорость" }
  },

  "limit": {
    "levels": [
      { "level": 1, "multiplier": 2, "label": "Уровень 1", "effect": "Сдирание кожи, ушибы, синяки" },
      { "level": 2, "multiplier": 3, "label": "Уровень 2", "effect": "Разрушение костей, потеря кусков плоти, повреждение мышц и органов" },
      { "level": 3, "multiplier": 5, "label": "Уровень 3", "effect": "Мгновенная смерть" }
    ],
    "awakeningBonusPerCount": 1,
    "reactionWarning": "Реакция выше предела не вредит телу, но тело не успевает за мыслями: персонаж видит атаку, а мышцы отвечают с опозданием."
  },

  "durability": {
    "punchMultiplier": 3,
    "minimum": 1500,
    "wounds": [
      { "id": "light",    "label": "Малое",       "factor": 0.1 },
      { "id": "medium",   "label": "Среднее",     "factor": 0.3333333333333333 },
      { "id": "heavy",    "label": "Тяжёлое",     "factor": 1 },
      { "id": "critical", "label": "Критическое", "factor": 1.5 },
      { "id": "lethal",   "label": "Смертельное", "factor": 2 }
    ],
    "weakZone": { "start": 1.1, "step": 0.1 },
    "zones": {
      "normal":   { "label": "Обычная зона",      "divisor": 1 },
      "weak":     { "label": "Слабая зона",       "divisor": "byDegree" },
      "internal": { "label": "Внутренние органы", "divisor": 1.2 },
      "external": { "label": "Внешние органы (глаза, перепонки)", "divisor": 3 }
    },
    "erosion": { "percentOfForce": 20, "recoveryPosts": 3, "speedPenaltyPerX": 5, "minPercent": 5 },
    "presetTargets": [1500, 3000, 6000]
  },

  "strike": {
    "types": {
      "hand":       { "label": "Рука",             "multiplier": 1,   "note": "Удар одной рукой (основной конечностью)" },
      "kick":       { "label": "Нога",             "multiplier": 1.2, "note": "Удар ногой" },
      "pierce":     { "label": "Колющий",          "multiplier": 1.4, "note": "Острие клинка, кончик пальца, копьё. Площадь не больше кулака" },
      "slashPalm":  { "label": "Режущий (ладонь)", "multiplier": 1.1, "note": "Ребро ладони" },
      "slashBlade": { "label": "Режущий (клинок)", "multiplier": 1.4, "note": "Острый предмет, который выдерживает силу удара" }
    }
  },

  "lift": {
    "legsMultiplier": 1.5,
    "missingLimbDivisor": 2,
    "explosiveMultiplier": 2,
    "explosiveTimeReactionFactor": 0.5,
    "explosiveTimeMaxMs": 100,
    "palmAreaCm2": 100,
    "pressureMaxMultiplier": 4
  },

  "speed": {
    "accelStartDivisor": 10,
    "accelDistanceM": 10,
    "attackMultiplier": 1.5,
    "water": { "baseMs": 40, "heavyThresholdKg": 100, "heavyMs": 50, "stepKg": 100, "stepMs": 50 }
  },

  "stamina": {
    "critical": 10,
    "sleepPerHour": 12.5,
    "restPerHour": 6.25,
    "apStep": 100,
    "apReductionPercent": 5,
    "costFloor": { "highFrom": 10, "high": 5, "low": 0.5 }
  },

  "reaction": {
    "meleeDistanceM": 2,
    "meleeMaxM": 2,
    "structurePerM3": 0.3333333333333333,
    "absoluteMs": 1
  },

  "wounds": {
    "degrees": [
      { "id": "light",    "label": "Лёгкие",      "desc": "Синяки, царапины, порезы до 1.5 см", "divisor": 1, "accumulationCap": 1, "all": false },
      { "id": "medium",   "label": "Средние",     "desc": "Незначительные переломы, вывихи, порезы 1.5–2 см", "divisor": 1.2, "accumulationCap": 1.2, "all": false },
      { "id": "heavy",    "label": "Тяжёлые",     "desc": "Переломы важных конечностей, потеря пальцев, обильное кровотечение", "divisor": 1.3, "accumulationCap": 1.5, "all": false },
      { "id": "critical", "label": "Критические", "desc": "Потеря основной части конечности, значительная рана жизненного органа", "divisor": 1.5, "accumulationCap": 1.8, "all": false },
      { "id": "lethal",   "label": "Смертельные", "desc": "Потеря конечностей или жизненных органов, критическая кровопотеря", "divisor": 2, "accumulationCap": 2, "all": true }
    ]
  },

  "martialArts": {
    "levels": [
      { "id": "novice", "label": "Новичок",  "sp": 0 },
      { "id": "owner",  "label": "Владелец", "sp": 350 },
      { "id": "expert", "label": "Эксперт",  "sp": 1000 },
      { "id": "master", "label": "Мастер",   "sp": 2500 }
    ],
    "spSources": [
      { "label": "Тренировочный бой", "sp": 25,  "cooldown": "раз в сутки" },
      { "label": "Серьёзный бой",     "sp": 70,  "cooldown": "раз в 6 часов", "upTo": true },
      { "label": "Смертельный бой",   "sp": 200, "cooldown": "раз в сутки",   "upTo": true }
    ],
    "spModifiers": [
      { "label": "В союзе", "value": "÷1.5" },
      { "label": "Против нескольких (кроме тренировки)", "value": "×1.5" },
      { "label": "С учителем", "value": "×2" }
    ]
  },

  "ap": {
    "upgradeStep": 100,
    "personification": 1000,
    "sources": [
      { "label": "/social-rp", "ap": 10, "cooldown": "за 12 ч" },
      { "label": "/train",     "ap": 10, "cooldown": "за 5 ч" },
      { "label": "Бои",        "ap": 80, "upTo": true }
    ]
  },

  "abilities": {
    "max": 12,
    "maxImages": 6,
    "upgrade": { "stepAp": 100, "physPercentPerStep": 30, "distancePercentPerStep": 15 },
    "scaleUnits": [
      { "pattern": "км/ч|м/с", "scope": "speed" },
      { "pattern": "км|метр[а-яё]*|м|см|мм", "scope": "radius" },
      { "pattern": "кг", "scope": "power" }
    ],
    "stats": {
      "speed":      { "label": "Скорость",   "unit": "км/ч", "scope": "speed",  "aliases": ["скорость"] },
      "durability": { "label": "Прочность",  "unit": "кг",   "scope": "power", "aliases": ["прочность"] },
      "punch":      { "label": "Сила удара", "unit": "кг",   "scope": "power", "aliases": ["сила", "сила удара", "удар"] }
    }
  },

  "maxTraits": 8
}
;
