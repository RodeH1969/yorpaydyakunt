(function () {
  'use strict';

  var feed = document.getElementById('feed');
  var tabsEl = document.getElementById('tabs');
  var overlay = document.getElementById('overlay');
  var closeBtn = document.getElementById('close');
  var popupTitle = document.getElementById('popup-title');
  var popupPlace = document.getElementById('popup-place');
  var popupDate = document.getElementById('popup-date');
  var popupBody = document.getElementById('popup-body');
  var popupCount = document.getElementById('popup-count');
  var popupShare = document.getElementById('popup-share');

  var NS = 'http://www.w3.org/2000/svg';
  var STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
  var whispers = {};
  var allList = [];
  var activeTab = 'ALL';
  var current = null;
  var lastFocus = null;

  /* ---------- helpers ---------- */

  function fmtDate(iso) {
    var p = iso.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function fmtNum(n) {
    return Number(n).toLocaleString('en-AU');
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function eyeIcon() {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'eye');
    svg.setAttribute('aria-hidden', 'true');
    var lid = document.createElementNS(NS, 'path');
    lid.setAttribute('d', 'M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z');
    lid.setAttribute('class', 'lid');
    var pupil = document.createElementNS(NS, 'circle');
    pupil.setAttribute('cx', '12'); pupil.setAttribute('cy', '12'); pupil.setAttribute('r', '3.2');
    pupil.setAttribute('class', 'pupil');
    svg.appendChild(lid);
    svg.appendChild(pupil);
    return svg;
  }

  function storeGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  function api(method, url) {
    return fetch(url, { method: method, headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }

  /* ---------- feed ---------- */

  function renderPost(w) {
    var post = el('article', 'post');
    post.setAttribute('data-slug', w.slug);

    var titleBtn = el('button', 'title open', w.title);
    titleBtn.type = 'button';
    post.appendChild(titleBtn);

    var meta = el('p', 'meta');
    meta.appendChild(document.createTextNode(w.suburb + ', ' + w.state));
    meta.appendChild(document.createElement('br'));
    meta.appendChild(document.createTextNode(fmtDate(w.published_at)));
    post.appendChild(meta);

    post.appendChild(el('p', 'teaser', w.teaser));

    var row = el('div', 'row');
    var count = el('span', 'count');
    count.appendChild(eyeIcon());
    count.appendChild(el('span', 'num', fmtNum(w.open_count)));
    count.appendChild(el('span', 'lbl', 'opened'));
    row.appendChild(count);

    var arrow = el('button', 'arrow', '↗ SHARE');
    arrow.type = 'button';
    arrow.setAttribute('aria-label', 'Share ' + w.title);
    row.appendChild(arrow);
    post.appendChild(row);

    post.addEventListener('click', function (e) {
      if (e.target.closest('.arrow')) return;
      openWhisper(w.slug, { auto: false });
    });
    arrow.addEventListener('click', function (e) {
      e.stopPropagation();
      shareWhisper(w, arrow, '↗ SHARE');
    });

    return post;
  }

  function renderFeed() {
    feed.textContent = '';
    allList.forEach(function (w) {
      if (activeTab === 'ALL' || w.state === activeTab) feed.appendChild(renderPost(w));
    });
  }

  function renderTabs() {
    tabsEl.textContent = '';
    ['ALL'].concat(STATES).forEach(function (name) {
      var b = el('button', 'tab', name);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', name === activeTab ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (activeTab === name) return;
        activeTab = name;
        renderTabs();
        renderFeed();
      });
      tabsEl.appendChild(b);
    });
  }

  function updateFeedCount(slug, n) {
    if (whispers[slug]) whispers[slug].open_count = n;
    var post = feed.querySelector('[data-slug="' + slug + '"] .num');
    if (post) post.textContent = fmtNum(n);
  }

  /* ---------- popup ---------- */

  function showPopup(w) {
    current = w;
    popupTitle.textContent = w.title;
    popupPlace.textContent = w.suburb + ', ' + w.state;
    popupDate.textContent = fmtDate(w.published_at);
    popupBody.textContent = '';
    w.body.split(/\n\s*\n/).forEach(function (para) {
      var t = para.trim();
      if (t) popupBody.appendChild(el('p', null, t));
    });
    popupCount.textContent = '';
    popupCount.appendChild(eyeIcon());
    popupCount.appendChild(document.createTextNode(
      ' ' + fmtNum(w.open_count) + (Number(w.open_count) === 1 ? ' time opened' : ' times opened')
    ));
    if (overlay.hidden) {
      lastFocus = document.activeElement;
      overlay.hidden = false;
      document.body.classList.add('locked');
    }
    overlay.scrollTop = 0;
    document.getElementById('popup').focus();
  }

  function hidePopup() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('locked');
    current = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // auto = opened by a link or the back button, not by a tap. Those only
  // count once per browser session, so a refresh never adds to the counter.
  function openWhisper(slug, opts) {
    var auto = !!(opts && opts.auto);
    var flag = 'o:' + slug;
    var shouldCount = !auto || !storeGet(flag);
    var req = shouldCount
      ? api('POST', '/api/whispers/' + encodeURIComponent(slug) + '/open')
      : api('GET', '/api/whispers/' + encodeURIComponent(slug));

    return req.then(function (w) {
      if (shouldCount) storeSet(flag, '1');
      showPopup(w);
      updateFeedCount(w.slug, w.open_count);
      var url = '/w/' + w.slug;
      if (location.pathname !== url) history.pushState({ w: w.slug }, '', url);
    }).catch(function () { /* leave the feed as it is */ });
  }

  function closePopup() {
    if (history.state && history.state.w) {
      history.back();
    } else {
      history.replaceState({}, '', '/');
      hidePopup();
    }
  }

  window.addEventListener('popstate', function () {
    var m = location.pathname.match(/^\/w\/([a-z0-9-]+)$/);
    if (m) {
      api('GET', '/api/whispers/' + encodeURIComponent(m[1])).then(showPopup).catch(hidePopup);
    } else {
      hidePopup();
    }
  });

  closeBtn.addEventListener('click', closePopup);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closePopup(); });

  document.addEventListener('keydown', function (e) {
    if (overlay.hidden) return;
    if (e.key === 'Escape') { closePopup(); return; }
    if (e.key === 'Tab') {
      var items = [closeBtn, popupShare];
      var i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  });

  /* ---------- share ---------- */

  // The shared message: title, place and date, the teaser, then the link
  // (which opens that whisper's popup).
  function shareText(w) {
    return w.title.toUpperCase() + '\n' +
      w.suburb + ', ' + w.state + ' · ' + fmtDate(w.published_at) + '\n\n' +
      w.teaser + '\n\n' +
      location.origin + '/w/' + w.slug;
  }

  function shareWhisper(w, button, restLabel) {
    var text = shareText(w);
    var done = function (label) {
      button.textContent = label;
      setTimeout(function () { button.textContent = restLabel; }, 1600);
    };
    // Everything goes in one block of text, link last, so no app drops the content.
    if (navigator.share) {
      navigator.share({ text: text }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        copyText(text, done);
      });
    } else {
      copyText(text, done);
    }
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done('COPIED'); }, function () { window.prompt('Copy this', text); });
    } else {
      window.prompt('Copy this', text);
    }
  }

  popupShare.addEventListener('click', function () {
    if (current) shareWhisper(current, popupShare, '↗ SHARE');
  });

  /* ---------- start ---------- */

  renderTabs();

  api('GET', '/api/whispers').then(function (list) {
    allList = list;
    list.forEach(function (w) { whispers[w.slug] = w; });
    renderFeed();
  }).catch(function () {
    feed.textContent = '';
    feed.appendChild(el('p', 'note', 'Couldn’t load. Refresh.'));
  });

  var start = location.pathname.match(/^\/w\/([a-z0-9-]+)$/);
  if (start) openWhisper(start[1], { auto: true });
})();
