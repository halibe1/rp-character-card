/*
 * figure.js — карточка персонажа на пьедестале.
 * Three.js (UMD, r149) из CDN: вращающаяся карточка с артом (хромированная рамка,
 * голографический блик), многоступенчатый пьедестал со светящимися кольцами,
 * парящие зеркальные осколки, частицы и луч света.
 * Без Three.js/WebGL — CSS-карточка (fallback).
 *
 *   RPFigure.init({ canvas, fallback, stage }) -> { setState({ mode, limitLevel }), setCard({ name, attribute, style, level, art }),
 *                                                   ready() -> Promise, snapshot({ width, height, ratio, draw(canvas, ratio) }) | null, webgl }
 */
(function (root) {
  'use strict';

  var reduceMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function webglOK() {
    try { var c = document.createElement('canvas'); return !!(root.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); }
    catch (e) { return false; }
  }

  /* ---------------- 2D-рисование ---------------- */

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }

  function drawRunes(g, S, alpha) {
    g.save();
    g.translate(S / 2, S / 2);
    g.strokeStyle = 'rgba(233,213,255,' + alpha + ')';
    g.shadowColor = '#c084fc'; g.shadowBlur = 12;
    function ring(r, w, dash) { g.beginPath(); g.setLineDash(dash || []); g.lineWidth = w; g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
    var k = S / 1024;
    ring(500 * k, 3); ring(470 * k, 1.5, [2, 10]); ring(430 * k, 2); ring(300 * k, 1.5); ring(280 * k, 1, [30, 12, 4, 12]);
    g.setLineDash([]);
    for (var i = 0; i < 120; i++) {
      var a = i / 120 * Math.PI * 2, long = i % 10 === 0;
      g.lineWidth = long ? 3 : 1.2;
      g.beginPath(); g.moveTo(Math.cos(a) * 432 * k, Math.sin(a) * 432 * k); g.lineTo(Math.cos(a) * (long ? 400 : 418) * k, Math.sin(a) * (long ? 400 : 418) * k); g.stroke();
    }
    for (var j = 0; j < 24; j++) {
      g.save(); g.rotate(j / 24 * Math.PI * 2); g.translate(0, -360 * k); g.lineWidth = 2; g.beginPath();
      if (j % 3 === 0) { g.moveTo(0, -18 * k); g.lineTo(12 * k, 0); g.lineTo(0, 18 * k); g.lineTo(-12 * k, 0); g.closePath(); }
      else if (j % 3 === 1) { g.moveTo(-14 * k, -8 * k); g.lineTo(14 * k, -8 * k); g.moveTo(-8 * k, 8 * k); g.lineTo(8 * k, 8 * k); g.moveTo(0, -16 * k); g.lineTo(0, 16 * k); }
      else { g.moveTo(-12 * k, 12 * k); g.lineTo(0, -14 * k); g.lineTo(12 * k, 12 * k); }
      g.stroke(); g.restore();
    }
    g.restore();
  }

  function fitText(g, text, font, size, maxW) {
    var s = size;
    do { g.font = font.replace('{s}', s); s -= 2; } while (g.measureText(text).width > maxW && s > 20);
  }

  var CW = 1024, CH = 1536, CR = 60;
  var ART_MIN_HEIGHT = 1500; // ниже этого арт на скриншоте в высоком разрешении будет мыльным

  /**
   * Во сколько раз увеличить холст карточки, чтобы арт лёг в него 1:1 (без уменьшения).
   * Рисуем всё в координатах 1024×1536, а холст масштабируем. Потолок — максимальный размер текстуры GPU.
   */
  function artScale(img, maxTex) {
    if (!img) return 1;
    var k = Math.min(img.naturalWidth / CW, img.naturalHeight / CH);
    return Math.max(1, Math.min(k, (maxTex || 4096) / CH));
  }

  /** Лицевая сторона карточки. img — загруженное изображение арта или null. k — масштаб холста. */
  function paintFront(cv, card, img, k) {
    k = k || 1;
    cv.width = Math.round(CW * k); cv.height = Math.round(CH * k);
    var g = cv.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, CW, CH);
    g.save();
    roundRect(g, 0, 0, CW, CH, CR); g.clip();
    var bg = g.createLinearGradient(0, 0, CW, CH);
    bg.addColorStop(0, '#2a1650'); bg.addColorStop(0.5, '#120a22'); bg.addColorStop(1, '#3b1c72');
    g.fillStyle = bg; g.fillRect(0, 0, CW, CH);
    if (img) {
      var sc = Math.max(CW / img.width, CH / img.height);
      var w = img.width * sc, h = img.height * sc;
      g.drawImage(img, (CW - w) / 2, (CH - h) / 2.6, w, h);
    } else {
      g.globalAlpha = 0.55; drawRunes(g, CW, 0.5); g.globalAlpha = 1;
      g.fillStyle = 'rgba(233,213,255,.6)';
      g.textAlign = 'center';
      g.font = '500 38px "Exo 2", sans-serif';
      g.fillText('Загрузи арт', CW / 2, CH / 2 - 10);
      g.font = '400 28px "Exo 2", sans-serif';
      g.fillStyle = 'rgba(185,163,220,.6)';
      g.fillText('в форме персонажа', CW / 2, CH / 2 + 34);
    }
    // затемнение снизу и сверху
    var vg = g.createLinearGradient(0, CH * 0.5, 0, CH);
    vg.addColorStop(0, 'rgba(11,6,20,0)'); vg.addColorStop(0.55, 'rgba(11,6,20,.78)'); vg.addColorStop(1, 'rgba(11,6,20,.97)');
    g.fillStyle = vg; g.fillRect(0, 0, CW, CH);
    var tg = g.createLinearGradient(0, 0, 0, 240);
    tg.addColorStop(0, 'rgba(11,6,20,.75)'); tg.addColorStop(1, 'rgba(11,6,20,0)');
    g.fillStyle = tg; g.fillRect(0, 0, CW, 240);

    // внутренняя рамка
    g.shadowColor = '#a855f7'; g.shadowBlur = 18;
    g.strokeStyle = 'rgba(192,132,252,.95)'; g.lineWidth = 4;
    roundRect(g, 30, 30, CW - 60, CH - 60, 40); g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(233,213,255,.35)'; g.lineWidth = 1.5;
    roundRect(g, 44, 44, CW - 88, CH - 88, 30); g.stroke();
    // уголки-ромбы
    g.fillStyle = '#e9d5ff';
    [[30, 30], [CW - 30, 30], [30, CH - 30], [CW - 30, CH - 30]].forEach(function (p) {
      g.save(); g.translate(p[0], p[1]); g.rotate(Math.PI / 4); g.fillRect(-11, -11, 22, 22); g.restore();
    });

    // верх: атрибут и уровень
    g.textAlign = 'left'; g.textBaseline = 'middle';
    if (card.attribute) {
      g.font = '600 30px "Exo 2", sans-serif';
      g.fillStyle = 'rgba(233,213,255,.9)';
      var at = ('АТРИБУТ · ' + card.attribute).toUpperCase();
      var tw = g.measureText(at).width;
      g.fillStyle = 'rgba(26,16,51,.75)'; roundRect(g, 74, 74, tw + 48, 54, 27); g.fill();
      g.strokeStyle = 'rgba(192,132,252,.7)'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#e9d5ff'; g.fillText(at, 98, 102);
    }
    if (card.level) {
      g.textAlign = 'right';
      g.font = '700 30px "Exo 2", sans-serif';
      var lv = card.level.toUpperCase(), lw = g.measureText(lv).width;
      g.fillStyle = 'rgba(124,58,237,.85)'; roundRect(g, CW - 74 - lw - 48, 74, lw + 48, 54, 27); g.fill();
      g.fillStyle = '#fff'; g.fillText(lv, CW - 98, 102);
    }

    // низ: имя и стиль
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    var name = (card.name || 'Без имени').toUpperCase();
    fitText(g, name, '800 {s}px "Unbounded", "Exo 2", sans-serif', 104, CW - 160);
    var ng = g.createLinearGradient(0, CH - 330, 0, CH - 210);
    ng.addColorStop(0, '#ffffff'); ng.addColorStop(1, '#c084fc');
    g.shadowColor = 'rgba(168,85,247,.9)'; g.shadowBlur = 30;
    g.fillStyle = ng; g.fillText(name, CW / 2, CH - 230);
    g.shadowBlur = 0;
    // разделитель
    g.strokeStyle = 'rgba(192,132,252,.8)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(170, CH - 182); g.lineTo(CW / 2 - 26, CH - 182); g.moveTo(CW / 2 + 26, CH - 182); g.lineTo(CW - 170, CH - 182); g.stroke();
    g.save(); g.translate(CW / 2, CH - 182); g.rotate(Math.PI / 4); g.fillStyle = '#e9d5ff'; g.fillRect(-9, -9, 18, 18); g.restore();
    if (card.style) {
      fitText(g, card.style.toUpperCase(), '600 {s}px "Exo 2", sans-serif', 38, CW - 200);
      g.fillStyle = 'rgba(233,213,255,.9)';
      g.fillText(card.style.toUpperCase(), CW / 2, CH - 118);
    }
    g.restore();
  }

  function paintBack(cv, card) {
    var g = cv.getContext('2d');
    g.clearRect(0, 0, CW, CH);
    g.save();
    roundRect(g, 0, 0, CW, CH, CR); g.clip();
    var bg = g.createRadialGradient(CW / 2, CH / 2, 50, CW / 2, CH / 2, CH * 0.75);
    bg.addColorStop(0, '#3b1c72'); bg.addColorStop(0.55, '#170c2e'); bg.addColorStop(1, '#0b0614');
    g.fillStyle = bg; g.fillRect(0, 0, CW, CH);
    // сетка ромбов
    g.strokeStyle = 'rgba(168,85,247,.12)'; g.lineWidth = 1.5;
    for (var i = -CH; i < CW + CH; i += 64) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + CH, CH); g.stroke();
      g.beginPath(); g.moveTo(i, CH); g.lineTo(i + CH, 0); g.stroke();
    }
    g.save(); g.translate(0, (CH - CW) / 2); drawRunes(g, CW, 0.85); g.restore();
    g.fillStyle = '#e9d5ff';
    [[CW / 2, CH / 2 - 160], [CW / 2 + 160, CH / 2], [CW / 2, CH / 2 + 160], [CW / 2 - 160, CH / 2]].forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 10, 0, Math.PI * 2); g.fill(); });
    g.shadowColor = '#c084fc'; g.shadowBlur = 30;
    g.beginPath(); g.arc(CW / 2, CH / 2, 20, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(192,132,252,.95)'; g.lineWidth = 4;
    roundRect(g, 30, 30, CW - 60, CH - 60, 40); g.stroke();
    g.textAlign = 'center';
    g.fillStyle = 'rgba(233,213,255,.85)';
    fitText(g, (card.name || '').toUpperCase(), '800 {s}px "Unbounded", "Exo 2", sans-serif', 56, CW - 240);
    g.fillText((card.name || '').toUpperCase(), CW / 2, CH - 150);
    g.font = '600 26px "Exo 2", sans-serif'; g.fillStyle = 'rgba(185,163,220,.7)';
    g.fillText('КАРТОЧКА ПЕРСОНАЖА', CW / 2, CH - 100);
    g.restore();
  }

  function loadImage(src) {
    return new Promise(function (res) {
      if (!src) return res(null);
      var im = new Image();
      if (/^https?:/.test(src)) im.crossOrigin = 'anonymous'; // арты с сервера: иначе WebGL откажется брать текстуру
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = src;
    });
  }
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('800 80px "Unbounded"', 'АБВ'),
      document.fonts.load('600 30px "Exo 2"', 'АБВ'),
      document.fonts.load('700 30px "Exo 2"', 'АБВ')
    ]).catch(function () {});
  }

  function glowTexture(THREE, inner, outer) {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(0.25, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  function runeTexture(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 1024;
    var g = c.getContext('2d');
    drawRunes(g, 1024, 0.95);
    g.fillStyle = 'rgba(233,213,255,0.9)';
    [[512, 282], [742, 512], [512, 742], [282, 512]].forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 9, 0, Math.PI * 2); g.fill(); });
    var t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }

  /* ---------------- Three.js сцена ---------------- */

  function initThree(opts) {
    var THREE = root.THREE;
    var canvas = opts.canvas, stage = opts.stage;
    // preserveDrawingBuffer не нужен: кадр для скриншота забираем сразу после render() в snapshot()
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    var maxTex = renderer.capabilities.maxTextureSize;
    var maxAniso = renderer.capabilities.getMaxAnisotropy();
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b0614, 0.04);
    var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    var camTarget = new THREE.Vector3(0, 2.35, 0);

    // окружение для хромовых отражений
    var pmrem = new THREE.PMREMGenerator(renderer);
    var envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x07040d);
    function softbox(color, w, h, pos) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 2, 0); envScene.add(m);
    }
    softbox(0xffffff, 6, 1.2, [0, 9, 0.1]);
    softbox(0xc084fc, 2, 10, [-8, 2, 3]);
    softbox(0x7c3aed, 2, 10, [8, 2, -3]);
    softbox(0xe9d5ff, 10, 0.6, [0, 3, -9]);
    softbox(0xa855f7, 10, 0.5, [0, 1, 9]);
    softbox(0x2a1450, 30, 30, [0, -6, 0.1]);
    scene.environment = pmrem.fromScene(envScene, 0.035).texture;

    var M = {
      pedestal: new THREE.MeshStandardMaterial({ color: 0x1a1033, metalness: 0.85, roughness: 0.3 }),
      pedestalTop: new THREE.MeshStandardMaterial({ color: 0x0f0820, metalness: 0.95, roughness: 0.12, envMapIntensity: 1.2 }),
      frame: new THREE.MeshStandardMaterial({ color: 0xcdb8f5, metalness: 1, roughness: 0.14, envMapIntensity: 1.6 })
    };

    scene.add(new THREE.AmbientLight(0x6b4fa0, 0.4));
    var key = new THREE.SpotLight(0xf3e8ff, 3, 30, Math.PI / 7, 0.55, 1.2);
    key.position.set(0.6, 11, 2.2); key.target.position.set(0, 1, 0); scene.add(key, key.target);
    var rimL = new THREE.PointLight(0xa855f7, 2.4, 14, 1.6); rimL.position.set(-3.5, 3.5, -2.5); scene.add(rimL);
    var rimR = new THREE.PointLight(0x7c3aed, 2.6, 14, 1.6); rimR.position.set(3.5, 2.8, -2.8); scene.add(rimR);
    var cardLight = new THREE.PointLight(0xc084fc, 1.6, 5, 2); scene.add(cardLight);

    /* пьедестал */
    var pedestal = new THREE.Group(); scene.add(pedestal);
    var tiers = [{ r: 2.15, h: 0.28, y: 0 }, { r: 1.72, h: 0.24, y: 0.28 }, { r: 1.32, h: 0.2, y: 0.52 }];
    var ringMats = [];
    tiers.forEach(function (t, i) {
      var cyl = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r + 0.08, t.h, 96, 1), i === 2 ? M.pedestalTop : M.pedestal);
      cyl.position.y = t.y + t.h / 2; pedestal.add(cyl);
      var rm = new THREE.MeshBasicMaterial({ color: i === 2 ? 0xe9d5ff : 0xa855f7, transparent: true, opacity: 0.9 });
      ringMats.push(rm);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(t.r + 0.005, 0.014, 8, 160), rm);
      ring.rotation.x = Math.PI / 2; ring.position.y = t.y + t.h; pedestal.add(ring);
      var ring2 = new THREE.Mesh(new THREE.TorusGeometry(t.r + 0.07, 0.008, 6, 160), rm);
      ring2.rotation.x = Math.PI / 2; ring2.position.y = t.y + 0.02; pedestal.add(ring2);
    });
    var topY = tiers[2].y + tiers[2].h;
    var runeTex = runeTexture(THREE);
    var runeMat = new THREE.MeshBasicMaterial({ map: runeTex, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xc084fc });
    var rune = new THREE.Mesh(new THREE.CircleGeometry(1.28, 96), runeMat);
    rune.rotation.x = -Math.PI / 2; rune.position.y = topY + 0.003; pedestal.add(rune);
    var rune2 = new THREE.Mesh(new THREE.RingGeometry(1.75, 2.12, 128), new THREE.MeshBasicMaterial({ map: runeTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xa855f7 }));
    rune2.rotation.x = -Math.PI / 2; rune2.position.y = tiers[0].h + 0.003; pedestal.add(rune2);
    var glowTex = glowTexture(THREE, 'rgba(192,132,252,0.9)', 'rgba(124,58,237,0.35)');
    var floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    floorGlow.rotation.x = -Math.PI / 2; floorGlow.position.y = 0.01; scene.add(floorGlow);
    // световой столб от площадки к карточке
    var padGlow = new THREE.Mesh(new THREE.CircleGeometry(1.1, 64), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    padGlow.rotation.x = -Math.PI / 2; padGlow.position.y = topY + 0.006; scene.add(padGlow);

    var orbitRings = [];
    [[2.6, 0.9, 0.12], [2.9, 2.4, -0.18], [2.4, 3.9, 0.08]].forEach(function (o, i) {
      var m = new THREE.Mesh(new THREE.TorusGeometry(o[0], 0.006, 4, 200), new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = Math.PI / 2 + o[2]; m.position.y = o[1]; m.userData.speed = (i % 2 ? -1 : 1) * (0.08 + i * 0.03);
      scene.add(m); orbitRings.push(m);
    });

    /* карточка */
    var CARD_W = 2.2, CARD_H = 3.3;
    var cardY = topY + 0.42 + CARD_H / 2;
    var card = new THREE.Group(); card.position.y = cardY; scene.add(card);

    var frontCv = document.createElement('canvas'); frontCv.width = CW; frontCv.height = CH;
    var backCv = document.createElement('canvas'); backCv.width = CW; backCv.height = CH;
    var frontTex = new THREE.CanvasTexture(frontCv); frontTex.encoding = THREE.sRGBEncoding; frontTex.anisotropy = maxAniso;
    var backTex = new THREE.CanvasTexture(backCv); backTex.encoding = THREE.sRGBEncoding; backTex.anisotropy = 8;
    var front = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), new THREE.MeshBasicMaterial({ map: frontTex, transparent: true, alphaTest: 0.5, toneMapped: false }));
    front.position.z = 0.031; card.add(front);
    var back = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), new THREE.MeshBasicMaterial({ map: backTex, transparent: true, alphaTest: 0.5, toneMapped: false }));
    back.rotation.y = Math.PI; back.position.z = -0.031; card.add(back);

    // хромовая рамка (скруглённый прямоугольник с отверстием)
    function rr(shape, w, h, r) {
      var x = -w / 2, y = -h / 2;
      shape.moveTo(x + r, y); shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
      shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
      shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
    }
    var outer = new THREE.Shape(); rr(outer, CARD_W + 0.1, CARD_H + 0.1, 0.16);
    var hole = new THREE.Path(); rr(hole, CARD_W - 0.04, CARD_H - 0.04, 0.11);
    outer.holes.push(hole);
    var frameGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.07, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 10 });
    frameGeo.translate(0, 0, -0.035);
    card.add(new THREE.Mesh(frameGeo, M.frame));
    // сердцевина, чтобы между сторонами не было видно насквозь
    var core = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W - 0.06, CARD_H - 0.06), new THREE.MeshBasicMaterial({ color: 0x0b0614, side: THREE.DoubleSide }));
    card.add(core);

    // голографический блик поверх лица
    var holoMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: frontTex }, uShift: { value: 0 }, uTime: { value: 0 }, uStrength: { value: 0.22 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform sampler2D uMap; uniform float uShift; uniform float uTime; uniform float uStrength; varying vec2 vUv;',
        'void main(){',
        '  float a = texture2D(uMap, vUv).a; if (a < 0.5) discard;',
        '  float t = vUv.x * 0.9 + vUv.y * 0.55 + uShift;',
        '  float band = 1.0 - smoothstep(0.0, 0.08, abs(fract(t) - 0.5));',
        '  float sheen = pow(max(0.0, 1.0 - abs(fract(t * 0.5 + uTime * 0.02) - 0.5) * 5.0), 3.0);',
        '  vec3 c1 = vec3(0.91, 0.84, 1.0); vec3 c2 = vec3(0.66, 0.33, 0.97); vec3 c3 = vec3(0.91, 0.47, 0.98);',
        '  vec3 col = mix(mix(c1, c2, fract(t * 2.0)), c3, sin(t * 6.283) * 0.5 + 0.5);',
        '  gl_FragColor = vec4(col * (sheen * 0.9 + band * 0.25), (sheen + band * 0.3) * uStrength);',
        '}'
      ].join('\n')
    });
    var holo = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), holoMat);
    holo.position.z = 0.033; card.add(holo);

    var cardGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xa855f7, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    cardGlow.scale.set(5, 6.2, 1); cardGlow.position.set(0, cardY, -1.2); scene.add(cardGlow);

    var cardData = {};
    var paintId = 0, painted = Promise.resolve();
    function repaint() {
      var id = ++paintId;
      painted = Promise.all([loadImage(cardData.art), fontsReady()]).then(function (res) {
        if (id !== paintId) return;
        var img = res[0];
        if (img && img.naturalHeight < ART_MIN_HEIGHT) {
          console.warn('Арт «' + (cardData.name || '') + '»: ' + img.naturalWidth + '×' + img.naturalHeight + ' px — меньше ' + ART_MIN_HEIGHT + ' px по высоте, на скриншоте будет мыльным. Загрузи исходник побольше.');
        }
        var oldW = frontCv.width, oldH = frontCv.height;
        paintFront(frontCv, cardData, img, artScale(img, maxTex));
        if (frontCv.width !== oldW || frontCv.height !== oldH) {
          // размер холста изменился — текстуру нужно создать заново (старая выделена под прежний размер)
          var old = frontTex;
          frontTex = new THREE.CanvasTexture(frontCv); frontTex.encoding = THREE.sRGBEncoding; frontTex.anisotropy = maxAniso;
          front.material.map = frontTex; holoMat.uniforms.uMap.value = frontTex;
          old.dispose();
        } else frontTex.needsUpdate = true;
        paintBack(backCv, cardData); backTex.needsUpdate = true;
      });
      return painted;
    }

    /* осколки */
    var shards = [];
    var edgeMat = new THREE.LineBasicMaterial({ color: 0xe9d5ff, transparent: true, opacity: 0.7 });
    var shardCount = reduceMotion ? 10 : 16;
    for (var i = 0; i < shardCount; i++) {
      var sh = new THREE.Shape(), pts = 3 + (i % 3 === 0 ? 1 : 0), sz = 0.1 + Math.random() * 0.16;
      for (var k = 0; k < pts; k++) {
        var a = k / pts * Math.PI * 2 + Math.random() * 0.6, rr2 = sz * (0.6 + Math.random() * 0.6);
        if (k === 0) sh.moveTo(Math.cos(a) * rr2, Math.sin(a) * rr2 * 1.6); else sh.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2 * 1.6);
      }
      sh.closePath();
      var geo = new THREE.ShapeGeometry(sh);
      var mat = new THREE.MeshStandardMaterial({ color: 0xf2eeff, metalness: 1, roughness: 0.02, side: THREE.DoubleSide, envMapIntensity: 2, emissive: 0x7c3aed, emissiveIntensity: 0.05 });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
      mesh.userData = { r: 2.4 + Math.random() * 1.0, a: i / shardCount * Math.PI * 2, y: 0.9 + Math.random() * 3.6,
        speed: 0.06 + Math.random() * 0.08, bob: Math.random() * 6.28,
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8), twinkle: Math.random() * 10 };
      scene.add(mesh); shards.push(mesh);
    }

    /* частицы */
    var PCOUNT = reduceMotion ? 120 : 340;
    var pGeo = new THREE.BufferGeometry(), pPos = new Float32Array(PCOUNT * 3), pSpeed = new Float32Array(PCOUNT);
    for (var p = 0; p < PCOUNT; p++) {
      var pa = Math.random() * Math.PI * 2, pr = 0.4 + Math.pow(Math.random(), 0.7) * 3.2;
      pPos[p * 3] = Math.cos(pa) * pr; pPos[p * 3 + 1] = Math.random() * 6; pPos[p * 3 + 2] = Math.sin(pa) * pr;
      pSpeed[p] = 0.12 + Math.random() * 0.35;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    var points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.06, map: glowTexture(THREE, 'rgba(255,255,255,1)', 'rgba(192,132,252,0.6)'), color: 0xd8b4fe, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(points);

    /* луч сверху */
    var beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0xc4a5ff) }, uStrength: { value: 0.2 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uStrength; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(abs(dot(vN,vV)),2.5); float h=smoothstep(0.0,0.35,vUv.y)*0.7+0.3; gl_FragColor=vec4(uColor, f*h*uStrength); }'
    });
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.3, 9, 64, 1, true), beamMat);
    beam.position.y = 4.6; scene.add(beam);

    var aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(232,121,249,0.6)', 'rgba(232,121,249,0.2)'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.scale.set(4.2, 5.6, 1); aura.position.set(0, cardY, -0.6); scene.add(aura);

    /* управление */
    var rotY = 0, rotTarget = 0, tilt = 0, tiltTarget = 0, dragging = false, lastX = 0, lastY = 0, idle = 10, vel = 0;
    canvas.addEventListener('pointerdown', function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; idle = 0; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      rotTarget += dx * 0.012; vel = dx * 0.012;
      tiltTarget = Math.max(-0.25, Math.min(0.35, tiltTarget + dy * 0.003));
    });
    function end() { dragging = false; idle = 0; }
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('dblclick', function () { rotTarget = Math.round(rotTarget / (Math.PI * 2)) * Math.PI * 2; tiltTarget = 0; idle = 0; });

    function resize() {
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.set(0, 3.2, 12.2 * Math.max(1, 0.9 / camera.aspect));
      camera.lookAt(camTarget);
      camera.updateProjectionMatrix();
    }
    if (root.ResizeObserver) new ResizeObserver(resize).observe(stage); else root.addEventListener('resize', resize);
    resize();

    var state = { mode: 'base', limitLevel: 0 }, energy = 0, energyTarget = 0;
    function setState(s) { Object.assign(state, s); energyTarget = state.mode === 'active' ? 1 : state.mode === 'passive' ? 0.45 : 0; }

    var visible = true;
    if (root.IntersectionObserver) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }).observe(stage);
    var clock = new THREE.Clock();
    function frame() {
      requestAnimationFrame(frame);
      if (!visible || document.hidden) { clock.getDelta(); return; }
      var dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, motion = reduceMotion ? 0 : 1;
      energy += (energyTarget - energy) * Math.min(1, dt * 2.5);
      idle += dt;
      if (!dragging) {
        if (Math.abs(vel) > 0.0005) { rotTarget += vel; vel *= 0.93; }
        // карточка медленно вращается сама: быстрее на ребре, медленнее лицом к зрителю
        if (idle > 2.5 && motion) rotTarget += dt * (0.35 + 0.45 * Math.pow(Math.abs(Math.sin(rotTarget)), 2)) * (1 + energy * 0.3);
      }
      rotY += (rotTarget - rotY) * Math.min(1, dt * 6);
      tilt += (tiltTarget - tilt) * Math.min(1, dt * 6);
      card.rotation.y = rotY;
      card.rotation.z = Math.sin(t * 0.6) * 0.025 * motion;
      card.position.y = cardY + Math.sin(t * 1.1) * 0.07 * motion;
      cardLight.position.set(0, card.position.y - 1.4, 0.6);
      pedestal.rotation.y += dt * 0.05 * motion;
      camera.position.y = 3.2 + tilt * 6;
      camera.lookAt(camTarget);

      holoMat.uniforms.uShift.value = rotY * 0.35 + tilt;
      holoMat.uniforms.uTime.value = t;
      holoMat.uniforms.uStrength.value = 0.28 + energy * 0.2;

      rune.rotation.z += dt * 0.12 * motion * (1 + energy * 2);
      rune2.rotation.z -= dt * 0.05 * motion;
      runeMat.opacity = 0.55 + energy * 0.35 + Math.sin(t * 2) * 0.08 * motion;
      padGlow.material.opacity = 0.55 + energy * 0.4 + Math.sin(t * 1.7) * 0.1 * motion;
      orbitRings.forEach(function (m) { m.rotation.z += dt * m.userData.speed * motion * (1 + energy); m.material.opacity = 0.2 + energy * 0.3; });
      ringMats.forEach(function (m, i) { m.opacity = 0.65 + 0.3 * Math.sin(t * 1.6 + i) * motion; });
      cardGlow.material.opacity = 0.4 + energy * 0.3;
      cardGlow.position.y = card.position.y;

      shards.forEach(function (m) {
        var o = m.userData;
        o.a += dt * o.speed * motion * (1 + energy * 1.8);
        var r2 = o.r - energy * 0.2;
        m.position.set(Math.cos(o.a) * r2, o.y + Math.sin(t * 0.8 + o.bob) * 0.15 * motion, Math.sin(o.a) * r2);
        m.rotation.x += o.spin.x * dt * motion; m.rotation.y += o.spin.y * dt * motion; m.rotation.z += o.spin.z * dt * motion;
        m.material.emissiveIntensity = 0.05 + Math.pow(Math.max(0, Math.sin(t * 1.3 + o.twinkle)), 8) * (0.6 + energy) + energy * 0.15;
      });

      if (motion) {
        var arr = pGeo.attributes.position.array;
        for (var q = 0; q < PCOUNT; q++) { arr[q * 3 + 1] += pSpeed[q] * dt * (1 + energy); if (arr[q * 3 + 1] > 6.2) arr[q * 3 + 1] = 0.1; }
        pGeo.attributes.position.needsUpdate = true;
        points.rotation.y += dt * 0.03;
      }

      var lvl = state.limitLevel || 0;
      aura.material.opacity = lvl * 0.2 * (lvl >= 2 ? 0.75 + 0.25 * Math.sin(t * (lvl >= 3 ? 14 : 6)) : 1);
      aura.position.y = card.position.y;
      beamMat.uniforms.uStrength.value = 0.18 + energy * 0.08;

      renderer.render(scene, camera);
    }
    frame();

    /**
     * Кадр для скриншота: рендерер временно получает экспортный размер (width×height CSS px × ratio),
     * карточка поворачивается лицом к зрителю, после render() кадр сразу отдаётся в draw(canvas)
     * (в той же задаче, поэтому preserveDrawingBuffer не нужен), затем всё возвращается как было.
     */
    function snapshot(o) {
      var gl = renderer.getContext();
      var maxRb = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0], gl.getParameter(gl.MAX_VIEWPORT_DIMS)[1]);
      var ratio = Math.min(o.ratio, maxRb / o.width, maxRb / o.height);
      var prevRatio = renderer.getPixelRatio();
      var saved = { ry: card.rotation.y, rz: card.rotation.z, py: card.position.y, shift: holoMat.uniforms.uShift.value };
      try {
        renderer.setPixelRatio(ratio);
        renderer.setSize(o.width, o.height, false);
        camera.aspect = o.width / o.height;
        camera.position.set(0, 3.2, 12.2 * Math.max(1, 0.9 / camera.aspect));
        camera.lookAt(camTarget);
        camera.updateProjectionMatrix();
        // лёгкий поворот, чтобы была видна толщина хромовой рамки
        card.rotation.y = -0.14; card.rotation.z = 0; card.position.y = cardY;
        cardGlow.position.y = aura.position.y = cardY;
        cardLight.position.set(0, cardY - 1.4, 0.6);
        holoMat.uniforms.uShift.value = -0.14 * 0.35;
        renderer.render(scene, camera);
        o.draw(canvas, ratio);
      } finally {
        card.rotation.y = saved.ry; card.rotation.z = saved.rz; card.position.y = saved.py;
        holoMat.uniforms.uShift.value = saved.shift;
        renderer.setPixelRatio(prevRatio);
        resize();
        camera.position.y = 3.2 + tilt * 6; camera.lookAt(camTarget);
        renderer.render(scene, camera);
      }
      return ratio;
    }

    return {
      setState: setState,
      setCard: function (c) { cardData = c || {}; repaint(); },
      ready: function () { return painted; },
      snapshot: snapshot,
      webgl: true
    };
  }

  /* ---------------- CSS fallback ---------------- */

  function initCSS(opts) {
    var el = opts.fallback;
    opts.canvas.style.display = 'none';
    el.hidden = false;
    el.innerHTML = '<div class="css-card"><div class="css-face css-front"><img alt=""><div class="css-name"></div><div class="css-style"></div></div><div class="css-face css-back"><div class="css-name"></div></div></div><div class="css-pedestal"></div>';
    return {
      setState: function () {},
      ready: function () { return Promise.resolve(); },
      snapshot: null,
      webgl: false,
      setCard: function (c) {
        var img = el.querySelector('img');
        if (c.art) { img.src = c.art; img.hidden = false; } else img.hidden = true;
        Array.prototype.forEach.call(el.querySelectorAll('.css-name'), function (n) { n.textContent = c.name || ''; });
        el.querySelector('.css-style').textContent = c.style || '';
      }
    };
  }

  function init(opts) {
    if (root.THREE && webglOK()) {
      try { return initThree(opts); } catch (e) { console.warn('Three.js сцена не запустилась, используем CSS-карточку', e); }
    }
    return initCSS(opts);
  }

  root.RPFigure = { init: init };
})(window);
