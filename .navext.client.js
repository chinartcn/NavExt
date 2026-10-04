/* ═══════════════════════════════════════════════════════════════════════════
 *  navext.client.js — NavExt客户端库
 * ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var DATA = window.__NAV_DATA__ || { files: [], config: {}, extensions: [] };
  var VERSION = DATA.version || 'unknown';

  var cardIndex = new Map();
  var events = {};
  var injectedStyles = new Map();
  var extIndex = new Map();

  function normPath(p) {
    var s = String(p || '');
    while (s.charAt(0) === '/') s = s.slice(1);
    return s.toLowerCase();
  }

  function isFn(f) { return typeof f === 'function'; }

  function getFiles() { return DATA.files.slice(); }

  function getFile(path) {
    var k = normPath(path);
    for (var i = 0; i < DATA.files.length; i++) {
      if (normPath(DATA.files[i].path) === k) return DATA.files[i];
    }
    return null;
  }

  function getConfig() { return DATA.config; }
  function getExtensions() { return DATA.extensions.slice(); }

  // ---------- 扩展作用域 ----------

  var CODE_STAR = 42;
  var CODE_QMARK = 63;

  function globMatch(s, p, si, pi) {
    while (si < s.length) {
      if (pi >= p.length) return false;
      var pc = p.charCodeAt(pi);
      if (pc === CODE_STAR) {
        for (var k = si; k <= s.length; k++) {
          if (globMatch(s, p, k, pi + 1)) return true;
        }
        return false;
      }
      if (pc === CODE_QMARK) {
        si++;
        pi++;
        continue;
      }
      if (pc === s.charCodeAt(si)) {
        si++;
        pi++;
        continue;
      }
      return false;
    }
    while (pi < p.length && p.charCodeAt(pi) === CODE_STAR) pi++;
    return pi >= p.length;
  }

  function matchGlob(str, pattern) {
    if (!pattern) return false;
    return globMatch(String(str).toLowerCase(), String(pattern).toLowerCase(), 0, 0);
  }

  function normalizeClientPath(p) {
    var x = String(p || '/');
    if (x.charCodeAt(0) !== 47) x = "/" + x;
    if (x.length > 1 && x.charCodeAt(x.length - 1) === 47) x = x.slice(0, -1);
    return x;
  }

  function currentPath() {
    if (typeof location !== 'undefined' && location && location.pathname) {
      return normalizeClientPath(location.pathname);
    }
    return "/";
  }

  function isExtActive(extId, pathname) {
    var e = extIndex.get(extId);
    if (!e) return false;
    if (!e.scope) return true;

    var p;
    if (pathname !== undefined) {
      p = normalizeClientPath(pathname);
    } else {
      p = currentPath();
    }

    var paths = [];
    if (Array.isArray(e.scope.paths)) paths = e.scope.paths;
    var exclude = [];
    if (Array.isArray(e.scope.exclude)) exclude = e.scope.exclude;
    var i;

    for (i = 0; i < exclude.length; i++) {
      if (matchGlob(p, exclude[i]) || matchGlob(p + "/", exclude[i])) return false;
    }
    if (!paths.length) return true;

    for (i = 0; i < paths.length; i++) {
      if (matchGlob(p, paths[i]) || matchGlob(p + "/", paths[i])) return true;
    }
    return false;
  }

  function getActiveExtensions(pathname) {
    var p;
    if (pathname !== undefined) {
      p = normalizeClientPath(pathname);
    } else {
      p = currentPath();
    }
    var out = [];
    for (var i = 0; i < DATA.extensions.length; i++) {
      var e = DATA.extensions[i];
      if (isExtActive(e.id, p)) out.push(e);
    }
    return out;
  }

  function getActiveExtIds(pathname) {
    return getActiveExtensions(pathname).map(function (e) { return e.id; });
  }




  function buildExtIndex() {
    extIndex = new Map();
    for (var i = 0; i < DATA.extensions.length; i++) {
      extIndex.set(DATA.extensions[i].id, DATA.extensions[i]);
    }
  }

  function getExtMeta(extId) { return extIndex.get(extId) || null; }

  function getExtConfig(extId) {
    var e = extIndex.get(extId);
    if (!e || !e.config) return {};
    return Object.assign({}, e.config);
  }

  function getExtConfigSchema(extId) {
    var e = extIndex.get(extId);
    if (!e || !Array.isArray(e.configSchema)) return [];
    return e.configSchema.slice();
  }

  function getExtStats(extId) {
    return request('/api/extensions/' + encodeURIComponent(extId) + '/stats')
      .then(function (r) { return r.stats; });
  }

  function getExtConfigField(extId, key) {
    var e = extIndex.get(extId);
    if (!e || !e.config) return undefined;
    return e.config[key];
  }

  function request(url, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined && init.method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(url, init).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      var parse = ct.indexOf('application/json') !== -1
        ? r.json()
        : r.text().then(function (t) { return { error: t }; });
      return parse.then(function (data) {
        if (!r.ok) {
          var msg = (data && data.error) || ('HTTP ' + r.status);
          var err = new Error(msg);
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function setExtConfig(extId, values) {
    return request('/api/extensions/' + encodeURIComponent(extId) + '/config', {
      method: 'POST',
      body: { values: values || {} },
    }).then(function (payload) {
      var e = extIndex.get(extId);
      if (e && payload && payload.values) e.config = payload.values;
      emit('ext-config-changed', { id: extId, values: e ? e.config : {} });
      return payload;
    });
  }

  function resetExtConfig(extId) {
    return request('/api/extensions/' + encodeURIComponent(extId) + '/config', {
      method: 'DELETE',
    }).then(function (payload) {
      var e = extIndex.get(extId);
      if (e && payload && payload.values) e.config = payload.values;
      emit('ext-config-changed', { id: extId, values: e ? e.config : {} });
      return payload;
    });
  }

  function fsQuery(base, path, extra) {
    var q = '?path=' + encodeURIComponent(path || '');
    if (extra) {
      for (var k in extra) {
        if (extra[k] !== undefined && extra[k] !== null) {
          q += '&' + k + '=' + encodeURIComponent(extra[k]);
        }
      }
    }
    return base + q;
  }

  var fsApi = {
    list: function (path, opts) { return request(fsQuery('/api/fs/list', path, opts)); },
    stat: function (path) { return request(fsQuery('/api/fs/stat', path)); },
    read: function (path, opts) { return request(fsQuery('/api/fs/read', path, opts)); },
    exists: function (path) {
      return fsApi.stat(path).then(function () { return true; })
                             .catch(function () { return false; });
    },
  };

  function extFs(extId) {
    if (!extId || typeof extId !== 'string') {
      throw new Error('[NavExt] extFs 需要一个扩展 id');
    }
    var base = '/api/extensions/' + encodeURIComponent(extId) + '/fs';

    return {
      list: function (path, opts) { return request(fsQuery(base + '/list', path, opts)); },
      stat: function (path) { return request(fsQuery(base + '/stat', path)); },
      read: function (path, opts) { return request(fsQuery(base + '/read', path, opts)); },
      exists: function (path) {
        return this.stat(path).then(function () { return true; })
                              .catch(function () { return false; });
      },
      write: function (path, content, opts) {
        opts = opts || {};
        return request(base + '/write', {
          method: 'POST',
          body: {
            path: path,
            content: content,
            encoding: opts.encoding || 'utf8',
            mkdirp: opts.mkdirp !== false,
          },
        });
      },
      mkdir: function (path, opts) {
        opts = opts || {};
        return request(base + '/mkdir', {
          method: 'POST',
          body: { path: path, recursive: opts.recursive !== false },
        });
      },
      delete: function (path, opts) {
        opts = opts || {};
        return request(fsQuery(base + '/delete', path, {
          recursive: opts.recursive ? '1' : undefined,
        }), { method: 'DELETE' });
      },
      rename: function (from, to) {
        return request(base + '/rename', {
          method: 'POST',
          body: { from: from, to: to },
        });
      },
    };
  }

  function on(name, fn) {
    if (!name || !isFn(fn)) return function () {};
    var arr = events[name] || (events[name] = []);
    arr.push(fn);
    return function off() {
      var idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }

  function once(name, fn) {
    var off = on(name, function (payload) {
      off();
      fn(payload);
    });
    return off;
  }

  function emit(name, payload) {
    var arr = events[name];
    if (!arr || !arr.length) return;
    arr.slice().forEach(function (fn) {
      try { fn(payload); }
      catch (err) {
        if (window.console) console.warn('[NavExt] 事件 ' + name + ' 处理出错:', err);
      }
    });
  }

  function collectCards() {
    cardIndex = new Map();
    var nodes = document.querySelectorAll('[data-ext-target="card"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = normPath(el.dataset.extPath || '');
      cardIndex.set(key, {
        el: el,
        icons: new Map(),
        badges: new Map(),
        classes: new Set(),
      });
    }
  }

  function getCardEl(path) {
    var entry = cardIndex.get(normPath(path));
    return entry ? entry.el : null;
  }

  function getVisibleCards() {
    var out = [];
    cardIndex.forEach(function (entry) {
      if (!entry.el.hidden) out.push(entry.el);
    });
    return out;
  }

  function ensureExtras(el) {
    var slot = el.querySelector('[data-ext-target="card-extras"]');
    if (!slot) {
      slot = document.createElement('div');
      slot.setAttribute('data-ext-target', 'card-extras');
      slot.className = 'ext-extras';
      el.appendChild(slot);
    }
    return slot;
  }

  function addCardIcon(path, iconUrl, opts) {
    opts = opts || {};
    var entry = cardIndex.get(normPath(path));
    if (!entry) return null;

    var key = opts.key || iconUrl;

    if (entry.icons.has(key)) {
      var exist = entry.icons.get(key);
      if (iconUrl && exist.src !== iconUrl) exist.src = iconUrl;
      if (opts.alt != null) exist.alt = opts.alt;
      if (opts.title != null) exist.title = opts.title;
      if (opts.size) {
        exist.style.width = opts.size + 'px';
        exist.style.height = opts.size + 'px';
      }
      return exist;
    }

    var img = document.createElement('img');
    img.setAttribute('data-ext-icon', key);
    img.className = 'ext-icon';
    img.src = iconUrl;
    img.alt = opts.alt || '';
    img.title = opts.title || '';
    img.loading = 'lazy';
    if (opts.size) {
      img.style.width = opts.size + 'px';
      img.style.height = opts.size + 'px';
    }

    ensureExtras(entry.el).appendChild(img);
    entry.icons.set(key, img);
    return img;
  }

  function contrastColor(bg) {
    if (typeof bg !== 'string') return '';
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg.trim());
    if (!m) return '';
    var hex = m[1];
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(hex.slice(0, 2), 16);
    var g = parseInt(hex.slice(2, 4), 16);
    var b = parseInt(hex.slice(4, 6), 16);
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#000' : '#fff';
  }

  function addCardBadge(path, text, color, opts) {
    opts = opts || {};
    var entry = cardIndex.get(normPath(path));
    if (!entry) return null;

    var key = opts.key || text;

    if (entry.badges.has(key)) {
      var exist = entry.badges.get(key);
      if (text != null) exist.textContent = String(text);
      if (color) {
        exist.style.background = color;
        exist.style.color = contrastColor(color);
      }
      return exist;
    }

    var span = document.createElement('span');
    span.setAttribute('data-ext-badge', key);
    span.className = 'ext-badge';
    span.textContent = String(text);
    if (color) {
      span.style.background = color;
      var fg = contrastColor(color);
      if (fg) span.style.color = fg;
    }

    ensureExtras(entry.el).appendChild(span);
    entry.badges.set(key, span);
    return span;
  }

  function addCardClass(path, className) {
    var entry = cardIndex.get(normPath(path));
    if (!entry || !className) return false;
    if (entry.classes.has(className)) return false;
    entry.el.classList.add(className);
    entry.classes.add(className);
    return true;
  }

  function removeCardClass(path, className) {
    var entry = cardIndex.get(normPath(path));
    if (!entry || !className) return false;
    if (!entry.classes.has(className)) return false;
    entry.el.classList.remove(className);
    entry.classes.delete(className);
    return true;
  }

  function setCardAttribute(path, name, value) {
    var entry = cardIndex.get(normPath(path));
    if (!entry) return false;
    if (value === null || value === undefined) entry.el.removeAttribute(name);
    else entry.el.setAttribute(name, String(value));
    return true;
  }

  function injectCSS(extId, css) {
    if (!extId || !css) return null;
    var style = document.createElement('style');
    style.setAttribute('data-ext-style', extId);
    style.textContent = String(css);
    document.head.appendChild(style);

    var arr = injectedStyles.get(extId) || [];
    arr.push(style);
    injectedStyles.set(extId, arr);
    return style;
  }

  function removeCSS(extId) {
    var arr = injectedStyles.get(extId);
    if (!arr) return;
    arr.forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    injectedStyles.delete(extId);
  }

  function notifyCardsChanged() {
    collectCards();
    var visible = getVisibleCards();
    emit('cards-updated', visible);   // 新事件名（正式）
    emit('cards-rendered', visible);  // 旧事件名（兼容）
  }

  // 外部 emit('cards-updated') 触发内部重新索引（替代直接调 _notifyCardsChanged）
  on('cards-updated', function () {
    collectCards();
    emit('cards-rendered', getVisibleCards());
  });

  window.NavExt = {
    version: VERSION,

    getFiles: getFiles,
    getFile: getFile,
    getConfig: getConfig,
    getExtensions: getExtensions,

    getExtMeta: getExtMeta,
    isExtActive: isExtActive,
    getActiveExtensions: getActiveExtensions,
    getActiveExtIds: getActiveExtIds,
    getExtConfig: getExtConfig,
    getExtConfigSchema: getExtConfigSchema,
    getExtConfigField: getExtConfigField,
    getExtStats: getExtStats,
    setExtConfig: setExtConfig,
    resetExtConfig: resetExtConfig,

    fs: fsApi,
    extFs: extFs,

    getCardEl: getCardEl,
    getVisibleCards: getVisibleCards,
    addCardIcon: addCardIcon,
    addCardBadge: addCardBadge,
    addCardClass: addCardClass,
    removeCardClass: removeCardClass,
    setCardAttribute: setCardAttribute,

    on: on,
    once: once,
    emit: emit,

    injectCSS: injectCSS,
    removeCSS: removeCSS,

    _notifyCardsChanged: notifyCardsChanged,   // 保留别名
    notifyCardsChanged: notifyCardsChanged,   // 正式名
  };

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    buildExtIndex();
    collectCards();
    emit('init', { files: getFiles(), config: getConfig() });
    setTimeout(function () {
      emit('cards-rendered', getVisibleCards());
    }, 0);
  });
})();
