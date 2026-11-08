(function () {
  'use strict';

  var loginSec = document.getElementById('login');
  var dashSec = document.getElementById('dash');
  var loginForm = document.getElementById('login-form');
  var loginMsg = document.getElementById('login-msg');
  var publishForm = document.getElementById('publish');
  var publishMsg = document.getElementById('publish-msg');
  var list = document.getElementById('list');
  var saveBtn = document.getElementById('save');
  var cancelBtn = document.getElementById('cancel');
  var editing = null; // slug of the whisper being edited, or null when writing a new one

  function field(id) { return document.getElementById(id); }

  function setEditing(w) {
    editing = w ? w.slug : null;
    if (w) {
      field('title').value = w.title;
      field('suburb').value = w.suburb;
      field('state').value = w.state;
      field('date').value = w.published_at;
      field('teaser').value = w.teaser;
      field('body').value = w.body;
      saveBtn.textContent = 'Save changes';
      cancelBtn.hidden = false;
      publishMsg.textContent = 'Editing ' + w.title;
      publishForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      field('title').focus();
    } else {
      publishForm.reset();
      field('date').value = today();
      saveBtn.textContent = 'Publish';
      cancelBtn.hidden = true;
    }
  }

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
    if (!loggedIn) setEditing(null);
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
        var edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'del';
        edit.textContent = 'Edit';
        edit.addEventListener('click', function () {
          // plain GET, so looking at a post here never adds to its open count
          api('GET', '/api/whispers/' + encodeURIComponent(w.slug)).then(function (r) {
            if (r.ok) setEditing(r.data);
          });
        });
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'del';
        del.textContent = 'Delete';
        del.addEventListener('click', function () {
          if (!window.confirm('Delete ' + w.title + '?')) return;
          api('DELETE', '/api/editor/whispers/' + encodeURIComponent(w.slug)).then(function (r) {
            if (r.status === 401) return show(false);
            if (editing === w.slug) setEditing(null);
            loadList();
          });
        });
        var acts = document.createElement('span');
        acts.className = 'acts';
        acts.appendChild(edit);
        acts.appendChild(del);
        li.appendChild(what);
        li.appendChild(acts);
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
    var wasEditing = editing;
    var payload = {
      title: field('title').value,
      suburb: field('suburb').value,
      state: field('state').value,
      published_at: field('date').value,
      teaser: field('teaser').value,
      body: field('body').value,
    };
    var req = wasEditing
      ? api('PUT', '/api/editor/whispers/' + encodeURIComponent(wasEditing), payload)
      : api('POST', '/api/editor/whispers', payload);
    req.then(function (r) {
      if (r.status === 401) return show(false);
      if (!r.ok) {
        publishMsg.textContent = r.data.error || (wasEditing ? 'Could not save.' : 'Could not publish.');
        return;
      }
      setEditing(null);
      publishMsg.textContent = wasEditing ? 'Saved.' : 'Published.';
      loadList();
    });
  });

  cancelBtn.addEventListener('click', function () {
    setEditing(null);
    publishMsg.textContent = '';
  });

  document.getElementById('logout').addEventListener('click', function () {
    api('POST', '/api/editor/logout').then(function () { show(false); });
  });

  api('GET', '/api/editor/session').then(function (r) { show(!!(r.data && r.data.editor)); });
})();
