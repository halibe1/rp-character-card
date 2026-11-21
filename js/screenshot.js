/*
 * screenshot.js — «📷 Скриншот персонажа»: PNG в высоком разрешении через html-to-image.
 *
 * Как устроено:
 *  1. Экспортная версия экрана собирается в скрытом контейнере фиксированного размера
 *     (весь экран 1920×1080 CSS px, только карточка 1080×1350) — от окна и масштаба браузера не зависит.
 *     Это клон живого DOM (режим статов, ранения, числа — как на экране) с классом .exporting,
 *     который прячет интерфейсные элементы и заменяет эффекты, не переносимые в PNG (backdrop-filter), запечёнными.
 *  2. Сцена Three.js: рендерер временно получает размер сцены экспорта × pixelRatio, кадр забирается сразу
 *     после render() и рисуется прямо на холст поверх уже отрендеренного фона (так аддитивное свечение —
 *     луч, ореол, частицы — не теряется, как было бы при переводе прозрачного кадра в PNG).
 *     Сверху отдельным проходом ложатся оверлеи сцены. Всё с pixelRatio 3 (если браузер не тянет — 2).
 *
 *   RPShot.capture(kind, ctx) -> Promise<{ name, width, height, ratio }>
 *     kind: 'full' | 'card'
 *     ctx:  { name, mode, modeLabel, wounds: [строки], testBuff, figure, prepare(root) }
 */
(function (root) {
  'use strict';

  var SIZES = { full: { w: 1920, h: 1080 }, card: { w: 1080, h: 1350 }, ability: { w: 1000, h: 0 } };   // у способности высота по содержимому
  var RATIOS = [3, 2];
  var BG = '#0b0614';

  var TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  function slug(s) {
    return String(s || 'character').toLowerCase().split('').map(function (c) { return TR[c] !== undefined ? TR[c] : c; }).join('')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function each(rootEl, sel, fn) { Array.prototype.forEach.call(rootEl.querySelectorAll(sel), fn); }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }

  /* ---------- ожидание шрифтов и картинок ---------- */

  var FACES = ['400 14px Inter', '500 14px Inter', '600 14px Inter',
    '400 14px "Exo 2"', '500 14px "Exo 2"', '600 14px "Exo 2"', '700 14px "Exo 2"', '800 14px "Exo 2"',
    '600 14px Unbounded', '800 14px Unbounded'];
  function fontsLoaded() {
    if (!document.fonts) return Promise.resolve();
    return Promise.all(FACES.map(function (f) { return document.fonts.load(f, 'Кенос АБВабв ABCabc 0123').catch(function () {}); }))
      .then(function () { return document.fonts.ready; });
  }
  function imagesLoaded(rootEl) {
    return Promise.all(Array.prototype.map.call(rootEl.querySelectorAll('img'), function (img) {
      if (!img.getAttribute('src')) return null;
      if (img.decode) return img.decode().catch(function () {});
      return img.complete ? null : new Promise(function (r) { img.onload = img.onerror = r; });
    }));
  }

  /* ---------- сборка экспортной сцены ---------- */

  function buildFull() {
    var frame = el('div', 'xp-frame xp-full exporting');
    frame.appendChild(document.querySelector('.bg-layer').cloneNode(true));
    frame.appendChild(document.getElementById('app').cloneNode(true));
    return frame;
  }

  function buildCard(ctx) {
    var frame = el('div', 'xp-frame xp-card exporting');
    frame.appendChild(document.querySelector('.bg-layer').cloneNode(true));
    frame.appendChild(document.getElementById('stage').cloneNode(true));
    var cap = '<span class="xp-pill"><span class="dot"></span>Режим · <b>' + esc(ctx.modeLabel) + '</b></span>';
    if (ctx.testBuff) cap += '<span class="xp-pill">Внешний бафф <b>+' + esc(ctx.testBuff) + '%</b></span>';
    if (ctx.wounds.length) cap += '<span class="xp-pill hot">Ранения: <b>' + esc(ctx.wounds.join(', ')) + '</b></span>';
    frame.appendChild(el('div', 'xp-caption', cap));
    return frame;
  }

  function cleanup(frame, ctx) {
    if (ctx.prepare) ctx.prepare(frame); // финальные значения чисел (без середины анимации)
    // ранения: только включённые, без кнопок
    each(frame, '.wound.off', function (n) { n.remove(); });
    each(frame, '.wound-list', function (n) { if (!n.querySelector('.wound')) n.innerHTML = '<div class="empty-note">Ранений нет</div>'; });
    // модификаторы: только включённые, без формы добавления
    each(frame, '.mod.off', function (n) { n.remove(); });
    each(frame, '.mod-group', function (n) { if (!n.querySelector('.mod')) n.remove(); });
    each(frame, '#modList', function (n) { if (!n.querySelector('.mod')) n.innerHTML = '<div class="empty-note">Модификаторов нет</div>'; });
    // тестовый бафф: на картинке только значение, без ползунка
    each(frame, '.test-buff', function (n) {
      if (!ctx.testBuff) n.remove();
      else { var r = n.querySelector('.row2'); if (r) r.remove(); var l = n.querySelector('label'); if (l) l.textContent = 'Внешний бафф на все физ. статы'; }
    });
    // живой <canvas> не клонируется (WebGL-буфер пуст) — кадр Three.js кладётся в render()
    each(frame, 'canvas', function (c) { c.remove(); });
    if (ctx.figure && ctx.figure.webgl) each(frame, '.figure-fallback', function (n) { n.remove(); });
    // дубликаты id и тяжёлые атрибуты подсказок в клоне не нужны
    each(frame, '[id]', function (n) { n.removeAttribute('id'); });
    each(frame, '[data-tip]', function (n) { n.removeAttribute('data-tip'); });
    each(frame, 'select, input, textarea', function (n) { n.setAttribute('tabindex', '-1'); });
  }
  /** Скрин одной способности: шапка (персонаж, атрибут, режим) + карточка способности, развёрнутая вместе с подспособностями. */
  function buildAbility(ctx) {
    var frame = el('div', 'xp-frame xp-ability exporting');
    var cap = '<div class="xp-ab-who"><b>' + esc(ctx.name) + '</b>' + (ctx.attribute ? '<span>Атрибут · ' + esc(ctx.attribute) + '</span>' : '') + '</div>' +
      '<div class="xp-ab-pills"><span class="xp-pill"><span class="dot"></span>Режим · <b>' + esc(ctx.modeLabel) + '</b></span>' +
      (ctx.wounds.length ? '<span class="xp-pill hot">Ранения: <b>' + esc(ctx.wounds.join(', ')) + '</b></span>' : '') + '</div>';
    frame.appendChild(el('div', 'xp-ab-head', cap));
    var list = el('div', 'ab-list');
    var card = ctx.abilityEl.cloneNode(true);
    if (card.classList.contains('is-closed')) card.classList.remove('is-closed');
    each(card, '.abx.is-closed', function (n) { n.classList.remove('is-closed'); });
    each(card, '[aria-expanded]', function (n) { n.setAttribute('aria-expanded', 'true'); });
    each(card, '.abx-shot, .abx-chev', function (n) { n.remove(); });
    each(card, 'img.ab-img.zoom', function (n) { n.classList.remove('zoom'); });
    list.appendChild(card);
    frame.appendChild(list);
    frame.appendChild(el('div', 'xp-ab-foot', 'Карточка персонажа РП · значения посчитаны от статов в режиме «' + esc(ctx.modeLabel) + '»'));
    return frame;
  }

  /* ---------- шрифты ----------
     Картинка рисуется через SVG, а SVG-картинка не видит шрифты страницы — их нужно встроить.
     html-to-image на file:// не может прочитать таблицы стилей, поэтому берём CSS Google Fonts сами
     и встраиваем woff2 (кириллица и латиница) как data URL. */

  var fontCSS = null;
  var SUBSETS = /^(cyrillic|cyrillic-ext|latin|latin-ext)$/;
  function blobToDataURL(b) {
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b); });
  }
  function getFontCSS() {
    if (fontCSS !== null) return Promise.resolve(fontCSS);
    var link = document.querySelector('link[rel=stylesheet][href*="fonts.googleapis.com"]');
    if (!link) return Promise.resolve('');
    return fetch(link.href).then(function (r) { return r.text(); }).then(function (css) {
      var faces = [], re = /\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*{[^}]*})/g, m;
      while ((m = re.exec(css))) if (SUBSETS.test(m[1])) faces.push(m[2]);
      var urls = {};
      faces.forEach(function (f) { var u = /url\(([^)]+)\)/.exec(f); if (u) urls[u[1].replace(/["']/g, '')] = null; });
      return Promise.all(Object.keys(urls).map(function (u) {
        return fetch(u).then(function (r) { return r.blob(); }).then(blobToDataURL).then(function (d) { urls[u] = d; });
      })).then(function () {
        fontCSS = faces.map(function (f) {
          return f.replace(/url\(([^)]+)\)/g, function (all, u) { var d = urls[u.replace(/["']/g, '')]; return d ? 'url(' + d + ')' : all; });
        }).join('\n');
        return fontCSS;
      });
    }).catch(function (e) {
      console.warn('Скриншот: не удалось встроить шрифты (нет интернета?) — в PNG будут системные', e);
      return '';
    });
  }

  /* ---------- рендер ---------- */

  function canvasToBlob(c) {
    return new Promise(function (res, rej) {
      c.toBlob(function (b) { if (b) res(b); else rej(new Error('Браузер не смог собрать PNG такого размера')); }, 'image/png');
    });
  }

  function roundRectPath(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  /**
   * Без 3D — один проход html-to-image. С 3D — композиция на холсте (без огромных data URL внутри SVG):
   *  1) фон и панели (сцена пустая, без оверлеев);
   *  2) кадр Three.js рисуется прямо на этот холст в рамку сцены — аддитивное свечение ложится на настоящий фон;
   *  3) оверлеи поверх сцены (табличка, виньетка, подписи) на прозрачном фоне.
   */
  function render(frame, size, ratio, ctx, css) {
    var opts = { width: size.w, height: size.h, pixelRatio: ratio, backgroundColor: BG, fontEmbedCSS: css, cacheBust: false, skipAutoScale: true };
    var h2i = root.htmlToImage;
    var stage = frame.querySelector('.stage');
    var use3D = stage && ctx.figure && ctx.figure.snapshot;
    function pass(cls, o) {
      if (cls) frame.classList.add(cls);
      return nextFrame().then(function () { return h2i.toCanvas(frame, o || opts); })
        .then(function (c) { if (cls) frame.classList.remove(cls); return c; }, function (e) { if (cls) frame.classList.remove(cls); throw e; });
    }
    var job;
    if (!use3D) job = pass(null);
    else {
      var fr = frame.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      var box = { x: sr.left - fr.left, y: sr.top - fr.top, w: sr.width, h: sr.height, r: parseFloat(getComputedStyle(stage).borderTopLeftRadius) || 0 };
      var base;
      job = pass('xp-bgpass').then(function (c) {
        base = c;
        var g = c.getContext('2d');
        var used = ctx.figure.snapshot({
          width: box.w, height: box.h, ratio: ratio,
          draw: function (gl) {
            g.save();
            roundRectPath(g, box.x * ratio, box.y * ratio, box.w * ratio, box.h * ratio, box.r * ratio); g.clip();
            g.drawImage(gl, box.x * ratio, box.y * ratio, box.w * ratio, box.h * ratio);
            g.restore();
          }
        });
        if (used < ratio) console.warn('Скриншот: видеокарта ограничила кадр сцены до ×' + used.toFixed(2) + ' (растянут до ×' + ratio + ')');
        return pass('xp-overlaypass', Object.assign({}, opts, { backgroundColor: null }));
      }).then(function (over) {
        base.getContext('2d').drawImage(over, 0, 0);
        return base;
      });
    }
    return job.then(function (c) {
      if (c.width < size.w * ratio - 1) throw new Error('холст урезан до ' + c.width + '×' + c.height);
      return canvasToBlob(c).then(function (blob) { return { blob: blob, width: c.width, height: c.height }; });
    });
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  var busy = false;
  function capture(kind, ctx) {
    if (busy) return Promise.reject(new Error('скриншот уже готовится'));
    if (!root.htmlToImage) return Promise.reject(new Error('библиотека html-to-image не загрузилась (нужен интернет)'));
    busy = true;
    var size = Object.assign({}, SIZES[kind] || SIZES.full);
    var name = kind === 'ability' ? slug(ctx.name) + '-' + slug(ctx.abilityName || 'ability') + '.png' : slug(ctx.name) + '-' + ctx.mode + (kind === 'card' ? '-card' : '') + '.png';
    var host = el('div', 'xp-host');
    host.style.width = size.w + 'px'; host.style.height = size.h ? size.h + 'px' : 'auto';
    var frame = kind === 'card' ? buildCard(ctx) : kind === 'ability' ? buildAbility(ctx) : buildFull();
    cleanup(frame, ctx);
    host.appendChild(frame);
    document.body.appendChild(host);
    if (!size.h) { size.h = Math.ceil(frame.scrollHeight); host.style.height = size.h + 'px'; }
    document.body.classList.add('is-capturing');

    var ratios = kind === 'ability' ? [2, 1.5] : RATIOS;   // способность: 2000 px в ширину хватает, файл вдвое легче
    function attempt(i, lastErr) {
      if (i >= ratios.length) return Promise.reject(lastErr);
      return render(frame, size, ratios[i], ctx, fontCSS).then(function (out) { out.ratio = ratios[i]; return out; }, function (e) {
        console.warn('Скриншот с pixelRatio ' + ratios[i] + ' не удался', e);
        return attempt(i + 1, e);
      });
    }

    return fontsLoaded()
      .then(function () { return ctx.figure ? ctx.figure.ready() : null; })
      .then(function () { return imagesLoaded(frame); })
      .then(nextFrame)
      .then(getFontCSS)
      .then(function () { return attempt(0); })
      .then(function (out) {
        download(out.blob, name);
        var res = { name: name, width: out.width, height: out.height, ratio: out.ratio, bytes: out.blob.size };
        root.RPShot.last = res;
        console.info('Скриншот: ' + name + ' · ' + res.width + '×' + res.height + ' px (×' + res.ratio + ') · ' + (res.bytes / 1048576).toFixed(1) + ' МБ');
        return res;
      })
      .then(function (r) { finish(); return r; }, function (e) { finish(); throw e; });

    function finish() {
      host.remove();
      document.body.classList.remove('is-capturing');
      busy = false;
    }
  }

  root.RPShot = { capture: capture, sizes: SIZES };
})(window);
