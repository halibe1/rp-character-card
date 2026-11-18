/*
 * remote.js — общий сервер персонажей на Supabase: вход через Discord, база, хранилище артов.
 * Включается, когда в data/config.js заполнены supabaseUrl и supabaseKey (публичный anon-ключ).
 * Без них window.RPRemote.enabled === false, и сайт работает как раньше (персонажи в браузере).
 * Права на запись держит база (supabase/schema.sql, RLS), а не этот файл.
 */
(function () {
  'use strict';

  var cfg = ((window.RP_DATA || {}).config) || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) { window.RPRemote = { enabled: false }; return; }

  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } });
  var BUCKET = 'arts', RETURN_KEY = 'rp-return-hash';
  var user = null, admin = false;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fail(e) { throw new Error(e && e.message ? e.message : String(e)); }

  function displayName(u) {
    var m = (u && u.user_metadata) || {};
    var c = m.custom_claims || {};
    return c.global_name || m.full_name || m.name || m.user_name || 'Игрок';
  }

  function setSession(session) {
    user = session && session.user ? session.user : null;
    admin = false;
    if (!user) return Promise.resolve();
    return sb.from('admins').select('user_id').eq('user_id', user.id).then(function (r) { admin = !r.error && !!(r.data && r.data.length); });
  }

  function extOf(mime) { return { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mime] || 'png'; }

  /** data:-URL -> файл в хранилище, возвращает публичную ссылку. Исходник не пережимается. */
  function uploadArt(dataUrl, charId) {
    return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
      var max = (cfg.maxArtMB || 10) * 1024 * 1024;
      if (blob.size > max) fail('арт больше ' + (cfg.maxArtMB || 10) + ' МБ');
      var path = user.id + '/' + charId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.' + extOf(blob.type);
      return sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000' }).then(function (r) {
        if (r.error) fail(r.error);
        return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      });
    });
  }

  function toRow(c) {
    var data = clone(c);
    delete data.id; delete data.ownerId; delete data.ownerName; delete data.createdAt; delete data.updatedAt;
    return data;
  }
  function fromRow(r) {
    return Object.assign({}, r.data, { id: r.id, ownerId: r.owner_id, ownerName: r.owner_name || '', createdAt: Date.parse(r.created_at) || 0 });
  }

  window.RPRemote = {
    enabled: true,
    maxCharacters: cfg.maxCharactersPerUser || 5,
    init: function () {
      return sb.auth.getSession().then(function (r) { return setSession(r.data && r.data.session); });
    },
    user: function () { return user; },
    isAdmin: function () { return admin; },
    name: function () { return user ? displayName(user) : ''; },
    avatar: function () { return user && user.user_metadata ? user.user_metadata.avatar_url || '' : ''; },

    signIn: function () {
      try { sessionStorage.setItem(RETURN_KEY, location.hash); } catch (e) { /* ок */ }
      return sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: location.origin + location.pathname } }).then(function (r) { if (r.error) fail(r.error); });
    },
    signOut: function () { return sb.auth.signOut(); },
    returnHash: function () {
      try { var h = sessionStorage.getItem(RETURN_KEY); sessionStorage.removeItem(RETURN_KEY); return h || ''; } catch (e) { return ''; }
    },

    all: function () {
      return sb.from('characters').select('id,owner_id,owner_name,data,created_at').order('created_at', { ascending: true }).then(function (r) {
        if (r.error) fail(r.error);
        return r.data.map(fromRow);
      });
    },

    /** Новый персонаж (нет ownerId) — insert, иначе update. Арт из data:-URL уходит в хранилище. */
    put: function (c) {
      if (!user) return Promise.reject(new Error('нужно войти через Discord'));
      var art = typeof c.art === 'string' && c.art.indexOf('data:') === 0 ? uploadArt(c.art, c.id) : Promise.resolve(c.art);
      var imgJobs = [];
      (c.abilities || []).forEach(function (a) {
        (a.images || []).forEach(function (u, k) { if (typeof u === 'string' && u.indexOf('data:') === 0) imgJobs.push(uploadArt(u, c.id).then(function (url) { a.images[k] = url; })); });
      });
      return Promise.all(imgJobs).then(function () { return art; }).then(function (url) {
        c.art = url;
        var data = toRow(c);
        if (c.ownerId) {
          return sb.from('characters').update({ name: c.name, data: data }).eq('id', c.id).select('id').then(function (r) {
            if (r.error) fail(r.error);
            if (!r.data.length) fail('нет прав на изменение этого персонажа');
          });
        }
        return sb.from('characters').insert({ id: c.id, owner_id: user.id, owner_name: displayName(user), name: c.name, data: data }).then(function (r) {
          if (r.error) fail(/policy|violates/i.test(r.error.message) ? 'лимит персонажей (' + (cfg.maxCharactersPerUser || 5) + ') или нет прав' : r.error);
          c.ownerId = user.id; c.ownerName = displayName(user);
        });
      });
    },

    remove: function (id) {
      if (!user) return Promise.reject(new Error('нужно войти через Discord'));
      return sb.from('characters').delete().eq('id', id).select('id').then(function (r) {
        if (r.error) fail(r.error);
        if (!r.data.length) fail('нет прав на удаление');
      });
    }
  };
})();
