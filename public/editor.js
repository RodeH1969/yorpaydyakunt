(function () {
  'use strict';

  var loginSec = document.getElementById('login');
  var dashSec = document.getElementById('dash');
  var loginForm = document.getElementById('login-form');
  var loginMsg = document.getElementById('login-msg');
  var publishForm = document.getElementById('publish');
  var publishMsg = document.getElementById('publish-msg');
  var list = document.getElementById('list');

  function api(method, url, body) {
    var opts = { method: method, headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        return { ok: r.ok, status: r.status, data: data };
      });
    });
  }

  function today() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });
  }

  function fmtDate(iso) {
    var p = iso.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]))
      .toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function show(loggedIn) {
    loginSec.hidden = loggedIn;
    dashSec.hidden = !loggedIn;
    if (loggedIn) {
      document.getElementById('date').value = today();
      loadList();
    } else {
      document.getElementById('password').focus();
    }
  }

  function loadList() {
    api('GET', '/api/whispers').then(function (res) {
      list.textContent = '';
      if (!res.ok) return;
      res.data.forEach(function (w) {
        var li = document.createElement('li');
        var what = document.createElement('span');
        what.className = 'what';
        what.appendChild(document.createTextNode(w.title));
        var small = document.createElement('small');
        small.textContent = w.suburb + ', ' + w.state + ' · ' + fmtDate(w.published_at) +
          ' · ' + Number(w.open_count).toLocaleString('en-AU');
        what.appendChild(small);
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'del';
        del.textContent = 'Delete';
        del.addEventListener('click', function () {
          if (!window.confirm('Delete ' + w.title + '?')) return;
          api('DELETE', '/api/editor/whispers/' + encodeURIComponent(w.slug)).then(function (r) {
            if (r.status === 401) return show(false);
            loadList();
          });
        });
        li.appendChild(what);
        li.appendChild(del);
        list.appendChild(li);
      });
    });
  }

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    loginMsg.textContent = '';
    api('POST', '/api/editor/login', { password: document.getElementById('password').value }).then(function (r) {
      if (r.ok) {
        document.getElementById('password').value = '';
        show(true);
      } else {
        loginMsg.textContent = r.status === 429 ? 'Too many tries. Wait a bit.' : 'Wrong password.';
      }
    });
  });

  publishForm.addEventListener('submit', function (e) {
    e.preventDefault();
    publishMsg.textContent = '';
    api('POST', '/api/editor/whispers', {
      title: document.getElementById('title').value,
      suburb: document.getElementById('suburb').value,
      state: document.getElementById('state').value,
      published_at: document.getElementById('date').value,
      teaser: document.getElementById('teaser').value,
      body: document.getElementById('body').value,
    }).then(function (r) {
      if (r.status === 401) return show(false);
      if (!r.ok) {
        publishMsg.textContent = r.data.error || 'Could not publish.';
        return;
      }
      publishForm.reset();
      document.getElementById('date').value = today();
      publishMsg.textContent = 'Published.';
      loadList();
    });
  });

  document.getElementById('logout').addEventListener('click', function () {
    api('POST', '/api/editor/logout').then(function () { show(false); });
  });

  api('GET', '/api/editor/session').then(function (r) { show(!!(r.data && r.data.editor)); });
})();
