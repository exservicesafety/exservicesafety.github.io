/* 「고속도로 영업소 TBM」 휴대폰 화면
 * - 서버: 구글 시트 Apps Script 웹 앱 (config.js의 API_URL)
 * - 로그인: 사번 + 비밀번호(처음엔 사번과 같음 → 첫 로그인 때 변경) → 이 휴대폰에 로그인 유지
 * - 관리자([근무자] 탭 권한=관리자): TBM 대신 권역 현황 화면
 * - 화면 주소: #/home, #/tbm, #/records, #/notices, #/report ...
 */
(function () {
  'use strict';
  var CFG = window.TBM_CONFIG || {};
  var app = document.getElementById('app');
  var KEY = 'tbm_emp_no', TKEY = 'tbm_token';
  var state = { user: null, home: null, flow: null };

  // ---------------- 공통 도구 ----------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function go(path) { if (location.hash === '#' + path) route(); else location.hash = path; }
  function empNo() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return state.empNo || ''; } }
  function setEmpNo(v) { state.empNo = v; try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) {} }
  function token() { try { return localStorage.getItem(TKEY) || state.token || ''; } catch (e) { return state.token || ''; } }
  function setToken(v) { state.token = v; try { if (v) localStorage.setItem(TKEY, v); else localStorage.removeItem(TKEY); } catch (e) {} }
  function logout() { setToken(''); state.user = null; state.home = null; state.notices = null; go('/login'); }
  var loadTimer;
  function loading(on, text) {   // 금방 끝나는 요청에는 '잠시만 기다려 주세요'를 띄우지 않는다
    clearTimeout(loadTimer);
    $('#loadingText').textContent = text || '잠시만 기다려 주세요';
    if (on) loadTimer = setTimeout(function () { $('#loading').hidden = false; }, 350);
    else $('#loading').hidden = true;
  }
  function curPath() { return '/' + (((location.hash || '#/home').slice(1).split('/'))[1] || 'home'); }
  var FRESH = 10 * 60 * 1000;     // 홈·공지 내용을 다시 받기 전에 먼저 보여 줄 수 있는 시간
  function fresh(at, ms) { return at && Date.now() - at < (ms || FRESH); }
  function keepHome(res) {
    state.home = res; state.homeAt = Date.now();
    if (res.notices) keepNotices(res.notices);
  }
  // 이 휴대폰에서 방금 읽은 공지는 서버 답이 늦게 와도 '확인'으로 유지
  function keepNotices(items) {
    state.readIds = state.readIds || {};
    items.forEach(function (x) { if (state.readIds[x.id]) x.read = true; });
    state.notices = items; state.noticesAt = Date.now();
  }
  var toastTimer;
  function toast(msg, ok) {
    var t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (ok ? ' ok' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function view(html) { app.innerHTML = html; window.scrollTo(0, 0); }
  function setWho() {
    var u = state.user;
    $('#who').innerHTML = u ? esc(u.office) + '<br><b>' + esc(u.name) + '</b>님' : '';
  }

  // 서버 호출: 동시 접속이 몰려 실패하면 최대 3번까지 다시 시도
  function api(action, data, opts) {
    opts = opts || {};
    var body = JSON.stringify(Object.assign({ action: action, token: token() }, data || {}));
    if (!opts.silent) loading(true, opts.text);
    var tries = 0;
    function attempt() {
      tries++;
      return fetch(CFG.API_URL, { method: 'POST', body: body, redirect: 'follow' })   // text/plain → 사전 확인 요청 없음
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.ok && /too many|동시|Service invoked|잠시 뒤/i.test(res.error || '') && tries < 3) return retry();
          return res;
        }, function () {
          if (tries < 3) return retry();
          return { ok: false, error: '인터넷 연결을 확인하고 다시 시도해 주세요.' };
        });
    }
    function retry() { return new Promise(function (ok) { setTimeout(ok, 1200 * tries); }).then(attempt); }
    return attempt().then(function (res) {
      if (!opts.silent) loading(false);
      if (!res.ok && !opts.keepError) toast(res.error || '오류가 났습니다.');
      return res;
    });
  }

  // ---------------- 화면 이동 ----------------
  var routes = {
    '/login': screenLogin, '/consent': screenConsent, '/home': screenHome, '/tbm': screenSelect,
    '/check': screenCheck, '/done': screenDone, '/records': screenRecords, '/record': screenRecord,
    '/notices': screenNotices, '/notice': screenNotice, '/report': screenReport, '/reports': screenMyReports,
    '/password': screenPassword, '/me': screenMe,
    '/status': screenStatus, '/office': screenOffice, '/risks': screenRisks,
    '/off': screenOff,
    '/manage': screenManage, '/periods': screenPeriods, '/staff': screenStaff, '/staffadd': screenStaffAdd, '/staffone': screenStaffOne,
  };
  function route() {
    var h = (location.hash || '#/home').slice(1);
    var parts = h.split('/'); var path = '/' + (parts[1] || 'home'); var arg = decodeURIComponent(parts.slice(2).join('/'));
    if (!CFG.API_URL || /여기에/.test(CFG.API_URL)) {
      return view('<div class="card"><h1>설정 필요</h1><p>config.js에 웹 앱 주소(API_URL)를 넣어 주세요.</p></div>');
    }
    if (path !== '/login' && !token()) return go('/login');
    if (path !== '/login' && path !== '/password' && state.user && state.user.needChange) return go('/password');
    if (path !== '/login' && path !== '/consent' && path !== '/password' && state.user && !state.user.consented) return go('/consent');
    if (state.flow && path !== '/check' && path !== '/done') state.flow = null;
    (routes[path] || screenHome)(arg);
  }
  window.addEventListener('hashchange', route);

  // ---------------- 로그인 (사번 + 비밀번호) ----------------
  function screenLogin() {
    state.user = null; state.home = null; state.homeAt = 0; state.notices = null; state.noticesAt = 0; state.readIds = {}; state.history = null; setWho();
    view('<div class="card"><h1>로그인</h1>' +
      '<p class="hint" style="margin-top:-6px">한 번 로그인하면 이 휴대폰에 기억됩니다.</p>' +
      '<form id="f"><label class="lb" for="emp">사번</label>' +
      '<input id="emp" class="big-input" type="text" inputmode="numeric" autocomplete="username" required value="' + esc(empNo()) + '">' +
      '<label class="lb" for="pw">비밀번호</label>' +
      '<input id="pw" class="big-input" type="password" inputmode="numeric" autocomplete="current-password" required>' +
      '<p class="hint">처음에는 비밀번호가 <b>사번과 같습니다.</b></p>' +
      '<button class="btn">로그인</button></form></div>' +
      '<p class="hint" style="text-align:center">사번이 없거나 비밀번호를 잊었으면 안전관리자에게 문의해 주세요.</p>');
    $(empNo() ? '#pw' : '#emp').focus();
    $('#f').onsubmit = function (e) {
      e.preventDefault();
      var v = $('#emp').value.trim(), pw = $('#pw').value.trim();
      if (!v || !pw) return;
      api('login', { empNo: v, password: pw }, { keepError: true }).then(function (res) {
        if (!res.ok && notOpen(res)) { setEmpNo(v); return screenNotOpen(res.error); }
        if (!res.ok) { toast(res.error || '오류가 났습니다.'); $('#pw').value = ''; return; }
        setEmpNo(v); setToken(res.token);
        state.user = res.user; setWho();
        afterLogin();
      });
    };
  }

  function afterLogin() {
    var u = state.user;
    if (u.needChange) return go('/password');
    if (!u.consented) return go('/consent');
    go('/home');
  }

  // 비밀번호 바꾸기 (첫 로그인 때는 반드시)
  function screenPassword() {
    var first = !state.user || state.user.needChange;
    view('<div class="card"><h1>' + (first ? '비밀번호를 새로 정해 주세요' : '비밀번호 바꾸기') + '</h1>' +
      (first && state.user ? '<p style="font-size:20px;margin:4px 0 0"><b>' + esc(state.user.name) + '</b>님 (' + esc(state.user.office) + ')</p>' +
        '<p class="hint">처음 비밀번호(사번)는 다른 사람도 알 수 있어서, 바꿔야 TBM을 할 수 있습니다.</p>' : '') +
      '<form id="f">' + (first ? '' : '<label class="lb" for="cur">지금 비밀번호</label><input id="cur" class="big-input" type="password" inputmode="numeric" autocomplete="current-password" required>') +
      '<label class="lb" for="n1">새 비밀번호 (숫자 4~6자리)</label><input id="n1" class="big-input" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" required>' +
      '<label class="lb" for="n2">한 번 더 입력</label><input id="n2" class="big-input" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" required>' +
      '<p class="hint">0000, 1234처럼 쉬운 숫자는 쓸 수 없습니다. 잊어버리면 안전관리자에게 초기화를 요청하세요.</p>' +
      '<button class="btn">' + (first ? '저장하고 시작' : '바꾸기') + '</button></form></div>' +
      (first ? '<button class="btn ghost" id="out">다른 사번으로 로그인</button>' : '<a class="btn ghost" href="#/me">뒤로</a>'));
    if ($('#out')) $('#out').onclick = logout;
    $('#f').onsubmit = function (e) {
      e.preventDefault();
      var n1 = $('#n1').value.trim(), n2 = $('#n2').value.trim();
      if (!/^\d{4,6}$/.test(n1)) return toast('새 비밀번호는 숫자 4~6자리로 정해 주세요.');
      if (n1 !== n2) { $('#n2').value = ''; return toast('두 번 입력한 비밀번호가 다릅니다.'); }
      api('changePassword', { newPassword: n1, currentPassword: $('#cur') ? $('#cur').value.trim() : '' }, { keepError: true }).then(function (res) {
        if (!res.ok) return handleAuthError(res, true);
        setToken(res.token); state.user = res.user; setWho();
        toast('비밀번호를 바꿨습니다.', true);
        first ? afterLogin() : go('/me');
      });
    };
  }

  // 내 정보: 비밀번호 바꾸기, 로그아웃
  function screenMe() {
    var u = state.user;
    if (!u) return api('home', null, { keepError: true }).then(function (res) { if (!res.ok) return handleAuthError(res); state.user = res.user; setWho(); screenMe(); });
    view('<div class="card"><h1>내 정보</h1><dl class="kv"><dt>성명</dt><dd>' + esc(u.name) + '</dd><dt>소속</dt><dd>' + esc(u.office) + '</dd><dt>사번</dt><dd>' + esc(u.empNo) + '</dd>' +
      (u.isAdmin ? '<dt>권한</dt><dd>관리자</dd>' : u.isManager ? '<dt>권한</dt><dd>관리감독자 (소속 관리)</dd>' : '') + '</dl></div>' +
      '<a class="btn" href="#/password">비밀번호 바꾸기</a><button class="btn ghost" id="out">이 휴대폰에서 로그아웃</button><a class="btn ghost" href="#/home">홈으로</a>');
    $('#out').onclick = function () { if (confirm('로그아웃할까요? 다음에 사번과 비밀번호를 다시 넣어야 합니다.')) logout(); };
  }

  function screenConsent() {
    view('<div class="card"><h1>처음 오셨군요</h1>' +
      '<p class="hint" style="margin-top:-6px">앱을 사용하기 전에 동의가 필요합니다.</p>' +
      '<div class="privacy">[개인정보 수집·이용 동의]\n' +
      '1. 수집 항목: 사번, 성명, 소속 영업소, TBM 참여 기록(교대조, 제출 시각, 체크리스트 응답, 근무 적합 여부(음주·발열·약물 복용) 자가 확인 결과), 위험·아차사고 보고 내용\n' +
      '2. 수집·이용 목적: 작업 전 안전점검회의(TBM) 참여 기록 및 안전보건 관리\n' +
      '3. 보유·이용 기간: 5년 (안전보건 확보의무 이행 증빙) 후 파기\n' +
      '4. 동의를 거부할 수 있으며, 거부 시 기존 방식(서면)으로 TBM에 참여합니다.</div>' +
      '<label class="check"><input type="checkbox" id="agree"> 위 내용에 동의합니다.</label>' +
      '<button class="btn" id="ok">동의하고 시작</button>' +
      '<button class="btn ghost" id="other">다른 사번으로 로그인</button></div>');
    $('#ok').onclick = function () {
      if (!$('#agree').checked) return toast('동의에 체크해 주세요.');
      api('consent').then(function (res) { if (res.ok) { state.user = res.user; setWho(); go('/home'); } });
    };
    $('#other').onclick = logout;
  }

  // ---------------- 홈 ----------------
  function homeKey(r) { var c = Object.assign({}, r); delete c.now; return JSON.stringify(c); }
  function screenHome() {
    var cached = fresh(state.homeAt) ? state.home : null;
    if (cached) renderHome(cached);
    api('home', null, { keepError: true, silent: !!cached }).then(function (res) {
      if (!res.ok) {
        if (cached && !/로그인|비밀번호|동의|중지|등록되지|부터 사용/.test(res.error || '')) return;   // 잠깐 끊긴 것: 보이는 화면 유지
        return handleAuthError(res);
      }
      var changed = !cached || homeKey(cached) !== homeKey(res);
      keepHome(res);
      if (changed && curPath() === '/home') renderHome(res);
    });
  }

  function renderHome(res) {
    {
      state.user = res.user; setWho();
      if (res.user.needChange) return go('/password');
      state.mgrDate = '';
      if (res.admin) return adminHome(res);
      if (!res.user.consented) return go('/consent');
      if (res.manager) return managerHome(res);
      // 매일 TBM(근무일마다 1회) 또는 주 1회: 냈으면 완료 표시, 아니면 참여 버튼
      var main, wd = res.weekDone, daily = res.mode === 'daily';
      var unit = daily ? '오늘' : '이번 주';
      if (wd) {
        main = '<a class="home-btn done" href="#/record/' + esc(wd.no) + '"><span class="ico">✔️</span><span>' + unit + ' TBM 완료<small>' +
          esc(fmtDate(wd.workDate)) + ' ' + esc(wd.shift) + ' · ' + esc(wd.submittedAt.slice(11, 16)) + ' 제출 · 눌러서 내용 보기</small></span></a>' +
          '<p class="hint" style="text-align:center;margin:-4px 0 0">' + (daily ? '내일 출근하면 다시 참여합니다'
            : '이번 주 ' + esc(res.weekLabel) + ' · 다음 주 월요일부터 다시 참여합니다') + '</p>';
      } else if (res.offToday) {
        main = '<a class="home-btn off" href="#/tbm"><span class="ico">🏖️</span><span>오늘은 ' + esc(rlabel(res.offToday.reason)) + '(으)로 등록됨' +
          '<small>' + esc(res.weekLabel) + ' · 출근했다면 눌러서 TBM 참여</small></span></a>';
      } else {
        main = '<a class="home-btn main" href="#/tbm"><span class="ico">✅</span><span>' + unit + ' TBM 참여<small>' +
          esc(res.weekLabel) + ' · 아직 참여하지 않았습니다</small></span></a>';
      }
      if (res.canOff) main += '<a class="home-btn" href="#/off"><span class="ico">🗓️</span><span>쉬는 날 등록<small>휴무·연차·휴직 (앞뒤 7일)</small></span></a>';
      if (res.user.isManager) main += '<a class="home-btn" href="#/manage"><span class="ico">📝</span><span>소속 관리 (미리 보기)<small>' +
        esc(fmtDate(res.dailyFrom || '')) + '부터 관리감독자는 TBM 대신 이 화면을 씁니다</small></span></a>';
      var recent = res.recent.length ? '<div class="card" style="margin:0;padding:14px 18px"><b style="font-size:16px">최근 제출</b><ul class="recent">' +
        res.recent.map(function (r) { return '<li>' + esc(fmtDate(r.workDate)) + ' ' + esc(r.shift) + ' · ' + esc(r.submittedAt.slice(11, 16)) + '</li>'; }).join('') +
        '</ul></div>' : '';
      view('<div class="home-grid">' + main + recent +
        '<a class="home-btn" href="#/notices"><span class="ico">📢</span><span>공지사항<small>안전수칙·전달사항</small></span>' +
        (res.unreadNotices ? '<span class="count">' + res.unreadNotices + '</span>' : '') + '</a>' +
        '<a class="home-btn" href="#/report"><span class="ico">⚠️</span><span>위험·아차사고 보고<small>사진과 함께 바로 알리기</small></span></a>' +
        '<a class="home-btn" href="#/records"><span class="ico">🗂️</span><span>내 TBM 기록<small>최근 30일</small></span></a>' +
        '<a class="home-btn" href="#/reports"><span class="ico">📋</span><span>내 보고 처리 현황<small>보고한 내용과 조치 결과</small></span></a>' +
        '</div><p style="text-align:center;margin-top:22px"><a href="#/me" class="muted">내 정보 · 비밀번호 바꾸기 · 로그아웃</a></p>');
    }
  }

  // 운영 시작일 전: 사번은 그대로 두고 안내만 보여 준다
  function notOpen(res) { return /부터 사용할 수 있습니다/.test(res.error || ''); }
  function screenNotOpen(msg) {
    view('<div class="card" style="text-align:center"><div style="font-size:54px;line-height:1">⏳</div><h1 style="margin-top:12px">아직 시작 전입니다</h1>' +
      '<p style="font-size:20px;margin:8px 0"><b>' + esc(msg) + '</b></p>' +
      '<p class="hint">바탕화면 아이콘은 지금 미리 만들어 두셔도 됩니다.<br>시작하는 날 아이콘을 누르면 바로 들어갈 수 있습니다.</p></div>' +
      '<button class="btn ghost" id="again">다른 사번으로 로그인</button>');
    $('#again').onclick = function () { setToken(''); screenLogin(); };
  }

  function handleAuthError(res, toastOnly) {
    if (notOpen(res)) return screenNotOpen(res.error);
    if (/다시 로그인|등록되지 않은|중지된|비어 있/.test(res.error || '')) { toast(res.error); setToken(''); return go('/login'); }
    if (/비밀번호를 바꿔/.test(res.error || '')) { if (state.user) state.user.needChange = true; return go('/password'); }
    if (/동의가 필요/.test(res.error || '')) return go('/consent');
    if (/관리자만|관리자 계정은|관리감독자만|관리감독자는 TBM|직원 관리는/.test(res.error || '')) { toast(res.error); return go('/home'); }
    if (toastOnly) return toast(res.error || '오류가 났습니다.');
    view('<div class="card"><h1>연결 오류</h1><p>' + esc(res.error) + '</p><button class="btn" onclick="location.reload()">다시 시도</button></div>');
  }

  // 공지 내용: 인터넷 주소는 누를 수 있는 링크로, 유튜브 주소는 화면 안에서 바로 재생되는 영상으로 보여 준다
  function youtubeId(url) {
    var m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
    return m ? m[1] : null;
  }
  function richText(text) {
    var out = '', videos = [], last = 0, re = /https?:\/\/[^\s<>"']+/g, m;
    text = String(text || '');
    while ((m = re.exec(text))) {
      var url = m[0].replace(/[).,]+$/, ''), vid = youtubeId(url);
      out += esc(text.slice(last, m.index));
      out += '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + (vid ? '▶ 영상 새 창으로 보기' : '🔗 ' + esc(url)) + '</a>';
      if (vid && videos.indexOf(vid) < 0) videos.push(vid);
      last = m.index + url.length;
    }
    out += esc(text.slice(last));
    return out + videos.map(function (v) {
      return '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/' + v + '?rel=0&playsinline=1" title="동영상" ' +
        'allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>';
    }).join('');
  }

  function fmtDate(ymd) {
    var p = String(ymd).split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return p[1] + '/' + p[2] + '(' + '일월화수목금토'[d.getUTCDay()] + ')';
  }

  // ---------------- TBM: 교대조 선택 ----------------
  function screenSelect() {
    if (fresh(state.homeAt, 2 * 60 * 1000) && state.home && state.home.options) return renderSelect(state.home);
    api('home').then(function (res) {
      if (!res.ok) return handleAuthError(res);
      keepHome(res); state.user = res.user; setWho();
      renderSelect(res);
    });
  }

  function startFlow(b) {
    state.flow = { begin: b, step: 0, health: null, answers: b.worker.map(function () { return {}; }),
                   supAnswers: b.supervisor.map(function () { return {}; }), remarks: '', readIds: {} };
    go('/check');
  }

  function renderSelect(res) {
    {
      if (res.manager || res.admin) return go('/home');
      var daily = res.mode === 'daily';
      if (res.weekDone) {
        return view('<div class="card" style="text-align:center"><h1>' + (daily ? '오늘' : '이번 주') + ' TBM 완료</h1><p>' + esc(res.weekLabel) + ' TBM은<br>' +
          esc(fmtDate(res.weekDone.workDate)) + ' ' + esc(res.weekDone.shift) + '에 이미 제출했습니다.</p>' +
          '<p class="hint">' + (daily ? 'TBM은 출근하는 날마다 1번입니다. 내일 다시 참여할 수 있습니다.' : 'TBM은 주 1회입니다. 다음 주 월요일부터 다시 참여할 수 있습니다.') + '</p></div>' +
          '<a class="btn" href="#/record/' + esc(res.weekDone.no) + '">제출 내용 보기</a><a class="btn ghost" href="#/home">홈으로</a>');
      }
      var html = '<h1>어느 교대조인가요?</h1><p class="hint" style="margin-top:-4px">' + (daily ? '' : '이번 주 ') + esc(res.weekLabel) + ' · 지금 ' + esc(res.now.slice(11, 16)) +
        '<br>가장 가까운 교대조를 골라 두었습니다.</p><form id="f">';
      res.options.forEach(function (o) {
        var tag = o.done ? '<span class="tag fin">제출 완료 ' + esc(o.done.submittedAt.slice(11, 16)) + '</span>'
          : o.name === res.recommended ? '<span class="tag rec">추천</span>' : '';
        html += '<label class="opt-card"><input type="radio" name="shift" value="' + esc(o.name) + '"' +
          (o.done ? ' disabled' : o.name === res.recommended ? ' checked' : '') + '><span class="box"><span>' + esc(o.name) +
          '<small>' + esc(fmtDate(o.workDate)) + ' ' + esc(o.start) + ' 시작</small></span>' + tag + '</span></label>';
      });
      html += '<button class="btn">TBM 참여 시작</button></form><a class="btn ghost" href="#/home">홈으로</a>';
      view(html);
      // 추천 교대조의 체크리스트를 미리 받아 둔다 → 그대로 '참여 시작'을 누르면 기다리지 않음
      var pre = null, rec = $('input[name=shift]:checked');
      if (rec) pre = { shift: rec.value, p: api('begin', { shift: rec.value }, { silent: true, keepError: true }) };
      $('#f').onsubmit = function (e) {
        e.preventDefault();
        var pick = $('input[name=shift]:checked');
        if (!pick) return toast('교대조를 골라 주세요.');
        var btn = $('#f .btn'); btn.disabled = true;
        var normal = function () { return api('begin', { shift: pick.value }).then(function (b) { btn.disabled = false; if (b.ok) startFlow(b); }); };
        if (pre && pre.shift === pick.value) {
          loading(true);
          return pre.p.then(function (b) { loading(false); if (b.ok) startFlow(b); else normal(); });
        }
        normal();
      };
    }
  }

  // ---------------- TBM: 단계별 체크 ----------------
  function steps() {
    var f = state.flow, b = f.begin, list = [];
    b.mustRead.forEach(function (n) { list.push({ kind: 'notice', notice: n }); });
    list.push({ kind: 'health' });
    list.push({ kind: 'worker' });
    if (b.supervisor.length) list.push({ kind: 'supervisor' });
    list.push({ kind: 'submit' });
    return list;
  }

  function screenCheck() {
    var f = state.flow;
    if (!f) return go('/tbm');
    var list = steps(), st = list[f.step], b = f.begin;
    var head = '<div class="step-title"><h1>' + esc(b.workDateLabel) + ' ' + esc(b.shift) + ' TBM</h1><span class="cnt">' +
      (f.step + 1) + ' / ' + list.length + ' 단계</span></div><p class="hint" style="margin-top:-6px">참여 시작 ' +
      esc(b.joinedAt.slice(11, 16)) + ' · 제출하면 수정할 수 없습니다.</p><div class="progress"><div style="width:' +
      Math.round((f.step + 1) / list.length * 100) + '%"></div></div>';
    var body = '', nextLabel = '다음';

    if (st.kind === 'notice') {
      var n = st.notice;
      body = '<h2>📢 필독 공지</h2><div class="card notice-step"><h2>' + esc(n.title) + '</h2><div class="notice-body">' + richText(n.body) + '</div>' +
        n.images.map(function (id) { return '<img class="notice-img" data-img="' + esc(id) + '" alt="공지 이미지">'; }).join('') + '</div>';
      nextLabel = '확인했습니다';
    } else if (st.kind === 'health') {
      body = '<h2>건강상태 확인</h2><div class="q" data-q="health"><div class="qt">오늘 음주·발열·약물 복용 등으로 작업에 지장이 없습니까?</div>' +
        '<div class="ans col"><button type="button" data-v="ok">예, 지장 없습니다</button><button type="button" data-v="bad">아니오, 지장이 있습니다</button></div>' +
        '<div class="alert err" id="healthWarn" style="margin:12px 0 0" hidden>⚠️ 관리감독자에게 바로 알리고 작업 투입 여부를 확인하세요.</div></div>';
    } else if (st.kind === 'worker' || st.kind === 'supervisor') {
      var items = st.kind === 'worker' ? b.worker : b.supervisor, sec = null;
      body = '<h2>' + (st.kind === 'worker' ? '실행수칙 준수 체크' : '관리감독자 체크리스트') + '</h2>';
      items.forEach(function (it, i) {
        if (it.section && it.section !== sec) { sec = it.section; body += '<div class="sec-head">[' + esc(sec) + ']</div>'; }
        body += '<div class="q" data-q="' + i + '"><div class="qt"><span class="qn">' + (i + 1) + '.</span>' + esc(it.text) + '</div>' +
          '<div class="ans"><button type="button" data-v="YES">예</button><button type="button" data-v="NO">아니오</button><button type="button" data-v="NA">해당없음</button></div>' +
          '<div class="reason" hidden><input type="text" placeholder="\'아니오\' 사유를 적어 주세요 (필수)" maxlength="200"></div></div>';
      });
    } else {
      body = '<h2>특이사항 · 제출</h2><div class="q"><div class="qt">특이사항 (선택)</div><textarea id="remarks" maxlength="500" placeholder="공유할 위험요인, 건의사항 등이 있으면 적어 주세요"></textarea></div>' +
        '<div class="alert info">제출하면 수정할 수 없습니다. 잘못 제출한 경우 안전관리자에게 정정을 요청하세요.</div>';
      nextLabel = '제출하기';
    }
    view(head + body + '<div class="row2">' + (f.step > 0 ? '<button class="btn ghost" id="prev">이전</button>' : '') +
      '<button class="btn' + (st.kind === 'submit' ? ' orange' : '') + '" id="next">' + nextLabel + '</button></div>');

    // 이전 답 복원 + 버튼 동작
    if (st.kind === 'health') {
      bindAnswer($('[data-q=health]'), f.health, function (v) { f.health = v; $('#healthWarn').hidden = v !== 'bad'; });
      $('#healthWarn').hidden = f.health !== 'bad';
    }
    if (st.kind === 'worker' || st.kind === 'supervisor') {
      var store = st.kind === 'worker' ? f.answers : f.supAnswers;
      $all('[data-q]').forEach(function (q) {
        var i = Number(q.getAttribute('data-q')), inp = $('.reason input', q);
        inp.value = store[i].reason || '';
        inp.oninput = function () { store[i].reason = inp.value; q.classList.remove('miss'); };
        bindAnswer(q, store[i].answer, function (v) { store[i].answer = v; $('.reason', q).hidden = v !== 'NO'; if (v === 'NO') inp.focus(); });
        $('.reason', q).hidden = store[i].answer !== 'NO';
      });
    }
    if (st.kind === 'notice') loadImages(app);
    if (st.kind === 'submit') { $('#remarks').value = f.remarks; $('#remarks').oninput = function () { f.remarks = this.value; }; }
    if ($('#prev')) $('#prev').onclick = function () { f.step--; screenCheck(); };
    $('#next').onclick = function () {
      if (st.kind === 'notice') {
        api('notice', { id: st.notice.id, markRead: true }, { silent: true, keepError: true });
        state.readIds = state.readIds || {}; state.readIds[st.notice.id] = true;
        (state.notices || []).forEach(function (x) { if (x.id === st.notice.id) x.read = true; });
        f.step++; return screenCheck();
      }
      if (st.kind === 'health' && !f.health) { $('[data-q=health]').classList.add('miss'); return toast('건강상태를 선택해 주세요.'); }
      if (st.kind === 'worker' || st.kind === 'supervisor') {
        var bad = validate(st.kind === 'worker' ? f.answers : f.supAnswers);
        if (bad) return;
      }
      if (st.kind === 'submit') return submit();
      f.step++; screenCheck();
    };
  }

  function bindAnswer(q, current, onPick) {
    $all('.ans button', q).forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-v') === current);
      btn.onclick = function () {
        $all('.ans button', q).forEach(function (x) { x.classList.remove('on'); });
        btn.classList.add('on'); q.classList.remove('miss');
        onPick(btn.getAttribute('data-v'));
      };
    });
  }

  function validate(store) {
    var first = null, msg = '';
    $all('[data-q]').forEach(function (q) {
      var a = store[Number(q.getAttribute('data-q'))];
      var bad = !a.answer || (a.answer === 'NO' && !String(a.reason || '').trim());
      q.classList.toggle('miss', bad);
      if (bad && !first) { first = q; msg = a.answer ? "'아니오' 사유를 적어 주세요." : '답하지 않은 문항이 있습니다.'; }
    });
    if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast(msg); return true; }
    return false;
  }

  function submit() {
    var f = state.flow;
    var btn = $('#next'); btn.disabled = true; btn.textContent = '제출 중...';
    api('submit', {
      ticket: f.begin.ticket, health: f.health, remarks: f.remarks,
      answers: f.answers, supAnswers: f.supAnswers, device: navigator.userAgent,
    }, { text: '제출하고 있습니다' }).then(function (res) {
      if (!res.ok) { btn.disabled = false; btn.textContent = '제출하기'; return; }
      if (res.duplicate) { toast(res.message, true); state.flow = null; return go('/home'); }
      state.done = res.submission; state.flow = null; state.home = null; state.history = null;
      go('/done');
    });
  }

  function submissionHtml(s, title) {
    function lines(arr, label) {
      if (!arr.length) return '';
      return '<li style="border:0;padding-top:12px"><b>' + label + '</b></li>' + arr.map(function (line) {
        var i = line.indexOf(' | '), a = line.slice(0, i), text = line.slice(i + 3);
        var cls = a === '예' ? 'YES' : a === '아니오' ? 'NO' : 'NA';
        return '<li><span class="a ' + cls + '">' + esc(a) + '</span><span>' + esc(text) + '</span></li>';
      }).join('');
    }
    return '<div class="card"><div class="done-head">' + title + '<p style="margin:0;font-size:20px"><b>' + esc(s.workDateLabel) + ' ' +
      esc(s.office) + ' ' + esc(s.shift) + '</b></p></div><dl class="kv"><dt>참여 시작</dt><dd>' + esc(String(s.joinedAt).slice(11, 16)) +
      '</dd><dt>제출</dt><dd>' + esc(String(s.submittedAt).slice(11, 16)) +
      '</dd><dt>건강상태</dt><dd>' + (s.healthOk ? '지장 없음' : '<span style="color:var(--red)">지장 있음</span>') + '</dd>' +
      (s.remarks ? '<dt>특이사항</dt><dd>' + esc(s.remarks) + '</dd>' : '') +
      (s.status && s.status !== '유효' ? '<dt>상태</dt><dd><span class="badge b-gray">' + esc(s.status) + '</span></dd>' : '') +
      '</dl></div>' + (!s.healthOk ? '<div class="alert err">건강상태 "지장 있음"을 선택했습니다. 관리감독자에게 알리고 작업 투입 여부를 확인하세요.</div>' : '') +
      '<div class="card"><h2>응답 내용</h2><ul class="ans-list">' + lines(s.worker, '실행수칙') + lines(s.supervisor, '관리감독자 체크리스트') + '</ul></div>';
  }

  function screenDone() {
    if (!state.done) return go('/home');
    view(submissionHtml(state.done, '<div class="big">✅</div><h1 style="margin-top:10px">제출 완료</h1>') + '<a class="btn" href="#/home">홈으로</a>');
  }

  // ---------------- 내 기록 ----------------
  function screenRecords() {
    api('history').then(function (res) {
      if (!res.ok) return handleAuthError(res);
      state.history = res.items;
      view('<h1>내 TBM 기록</h1><p class="hint" style="margin-top:-4px">최근 30일</p><div class="card" style="padding:4px 18px">' +
        (res.items.length ? res.items.map(function (r) {
          var badge = r.status !== '유효' ? '<span class="badge b-gray">' + esc(r.status) + '</span>' : !r.healthOk ? '<span class="badge b-bad">건강 지장</span>'
            : '<span class="badge b-ok">완료</span>';
          return '<a class="list-row" href="#/record/' + esc(r.no) + '"><span><b>' + esc(r.workDateLabel) + ' ' + esc(r.shift) + '</b><br><span class="muted" style="font-size:15px">' +
            esc(String(r.submittedAt).slice(11, 16)) + ' 제출' + (r.noCount ? ' · 아니오 ' + r.noCount + '건' : '') + '</span></span>' + badge + '</a>';
        }).join('') : '<p class="muted">아직 제출한 기록이 없습니다.</p>') + '</div><a class="btn" href="#/home">홈으로</a>');
    });
  }

  function screenRecord(no) {
    function show(list) {
      var s = list.filter(function (r) { return r.no === no; })[0];
      if (!s) return go('/records');
      view(submissionHtml(s, '<h1>TBM 제출 내용</h1>') + '<a class="btn" href="#/records">목록으로</a><a class="btn ghost" href="#/home">홈으로</a>');
    }
    if (state.history) return show(state.history);
    api('history').then(function (res) { if (res.ok) { state.history = res.items; show(res.items); } });
  }

  // ---------------- 공지 ----------------
  // 공지: 홈에서 받아 둔 목록·내용으로 바로 보여 주고, 확인 기록은 뒤에서 보낸다
  function noticesHtml(items) {
    return '<h1>공지사항</h1><div class="card" style="padding:4px 18px">' + (items.length ? items.map(function (n) {
      return '<a class="list-row" href="#/notice/' + esc(n.id) + '"><span>' + (n.mustRead ? '<span class="badge b-bad">필독</span> ' : '') +
        (n.read ? esc(n.title) : '<b>' + esc(n.title) + '</b>') + '<br><span class="muted" style="font-size:14px">' + esc(n.posted) + '</span></span>' +
        (n.read ? '<span class="badge b-gray">확인</span>' : '<span class="badge b-blue">새 글</span>') + '</a>';
    }).join('') : '<p class="muted">공지가 없습니다.</p>') + '</div><a class="btn" href="#/home">홈으로</a>';
  }
  function screenNotices() {
    var cached = fresh(state.noticesAt) ? state.notices : null;
    if (cached) view(noticesHtml(cached));
    api('notices', null, { silent: !!cached, keepError: !!cached }).then(function (res) {
      if (!res.ok) return cached ? null : handleAuthError(res);
      var changed = !cached || JSON.stringify(cached) !== JSON.stringify(res.items);
      keepNotices(res.items);
      changed = changed || JSON.stringify(cached) !== JSON.stringify(res.items);
      if (changed && curPath() === '/notices') view(noticesHtml(res.items));
    });
  }

  function showNotice(n) {
    view('<div class="card">' + (n.mustRead ? '<span class="badge b-bad">필독</span>' : '') + '<h1 style="margin-top:8px">' + esc(n.title) + '</h1>' +
      '<p class="muted" style="margin-top:-6px;font-size:14px">' + esc(n.posted) + '</p><div class="notice-body">' + richText(n.body) + '</div>' +
      n.images.map(function (fid) { return '<img class="notice-img" data-img="' + esc(fid) + '" alt="공지 이미지">'; }).join('') +
      '</div><a class="btn" href="#/notices">목록으로</a>');
    loadImages(app);
  }
  function screenNotice(id) {
    var n = (state.notices || []).filter(function (x) { return x.id === id; })[0];
    if (n) {
      showNotice(n);
      if (!n.read) {   // 화면에는 바로 '확인'으로 표시하고, 기록은 뒤에서 보낸다 (실패하면 다음 새로고침 때 바로잡힘)
        n.read = true; state.readIds = state.readIds || {}; state.readIds[id] = true;
        if (state.home && state.home.unreadNotices) state.home.unreadNotices--;
        api('notice', { id: id, markRead: true }, { silent: true, keepError: true });
      }
      return;
    }
    api('notice', { id: id, markRead: true }).then(function (res) {
      if (!res.ok) return go('/notices');
      showNotice(res.notice);
    });
  }

  function loadImages(root) {
    $all('img[data-img]', root).forEach(function (img) {
      var id = img.getAttribute('data-img');
      state.imgs = state.imgs || {};
      if (state.imgs[id]) { img.src = state.imgs[id]; return; }
      api('noticeImage', { fileId: id }, { silent: true, keepError: true }).then(function (res) {
        if (res.ok) img.src = state.imgs[id] = 'data:' + res.mime + ';base64,' + res.data; else img.alt = '이미지를 불러오지 못했습니다';
      });
    });
  }

  // ---------------- 위험·아차사고 보고 ----------------
  var TYPES = ['아차사고', '위험요인', '시설 불량', '기타'];
  function screenReport() {
    var photos = [], type = null;
    var now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    view('<h1>위험·아차사고 보고</h1><div class="card">' +
      '<label class="lb">유형</label><div class="chips">' + TYPES.map(function (t) { return '<button type="button" data-t="' + t + '">' + t + '</button>'; }).join('') + '</div>' +
      '<label class="lb" for="when">발생 일시</label><input id="when" type="datetime-local" value="' + now + '">' +
      '<label class="lb" for="where">위치</label><input id="where" type="text" maxlength="100" placeholder="예: 3번 부스 앞, 하이패스 2차로">' +
      '<label class="lb" for="what">내용</label><textarea id="what" maxlength="1000" placeholder="무슨 일이 있었는지, 어떤 위험이 있는지 적어 주세요"></textarea>' +
      '<label class="lb">사진 (선택, 최대 3장)</label><input id="pic" type="file" accept="image/*" multiple hidden>' +
      '<button type="button" class="btn ghost" id="picBtn" style="margin-top:0">📷 사진 찍기 / 고르기</button><div class="thumbs" id="thumbs"></div>' +
      '<button class="btn orange" id="send">보고하기</button></div><a class="btn ghost" href="#/home">홈으로</a>');
    $all('.chips button').forEach(function (b) {
      b.onclick = function () { $all('.chips button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); type = b.getAttribute('data-t'); };
    });
    $('#picBtn').onclick = function () { $('#pic').click(); };
    $('#pic').onchange = function () {
      var files = Array.prototype.slice.call(this.files).slice(0, 3 - photos.length);
      this.value = '';
      Promise.all(files.map(shrink)).then(function (list) { photos = photos.concat(list.filter(Boolean)).slice(0, 3); drawThumbs(); });
    };
    function drawThumbs() {
      $('#thumbs').innerHTML = photos.map(function (p, i) { return '<div><img src="' + p + '"><button type="button" data-i="' + i + '">×</button></div>'; }).join('');
      $all('#thumbs button').forEach(function (b) { b.onclick = function () { photos.splice(Number(b.getAttribute('data-i')), 1); drawThumbs(); }; });
      $('#picBtn').hidden = photos.length >= 3;
    }
    $('#send').onclick = function () {
      if (!type) return toast('유형을 골라 주세요.');
      if ($('#what').value.trim().length < 5) return toast('내용을 5자 이상 적어 주세요.');
      var btn = this; btn.disabled = true;
      api('report', { type: type, occurredAt: $('#when').value.replace('T', ' '), location: $('#where').value, content: $('#what').value, photos: photos },
          { text: photos.length ? '사진을 올리고 있습니다' : '보내고 있습니다' }).then(function (res) {
        btn.disabled = false;
        if (!res.ok) return;
        toast('보고했습니다. 처리 결과는 "내 보고 처리 현황"에서 볼 수 있습니다.', true);
        go('/reports');
      });
    };
  }

  // 사진 줄이기: 긴 변 1280px, JPEG 80% (원본은 보내지 않음)
  function shrink(file) {
    return new Promise(function (resolve) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1280, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = function () { URL.revokeObjectURL(url); toast('사진을 읽지 못했습니다.'); resolve(null); };
      img.src = url;
    });
  }

  function screenMyReports() {
    api('myReports').then(function (res) {
      if (!res.ok) return handleAuthError(res);
      var cls = { '접수': 'b-blue', '검토 중': 'b-warn', '조치 중': 'b-warn', '조치 완료': 'b-ok' };
      view('<h1>내 보고 처리 현황</h1>' + (res.items.length ? res.items.map(function (r) {
        return '<div class="card"><div style="display:flex;justify-content:space-between;gap:10px"><b>' + esc(r.type) + '</b><span class="badge ' +
          (cls[r.status] || 'b-gray') + '">' + esc(r.status) + '</span></div><p class="muted" style="margin:4px 0;font-size:14px">' + esc(r.reportedAt.slice(0, 16)) +
          (r.location ? ' · ' + esc(r.location) : '') + (r.photos ? ' · 사진 ' + r.photos + '장' : '') + '</p><div class="notice-body">' + esc(r.content) + '</div>' +
          (r.action ? '<div class="alert ok" style="margin:12px 0 0">조치: ' + esc(r.action) + (r.doneAt ? ' (' + esc(r.doneAt) + ')' : '') + '</div>' : '') + '</div>';
      }).join('') : '<div class="card"><p class="muted">보고한 내용이 없습니다.</p></div>') +
        '<a class="btn orange" href="#/report">새로 보고하기</a><a class="btn ghost" href="#/home">홈으로</a>');
    });
  }


  // ---------------- 관리자: 권역 현황 ----------------
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function bandCls(p) { return p >= 90 ? 'g' : p >= 50 ? 'y' : 'r'; }

  function adminHome(res) {
    var p = pct(res.submitted, res.total), daily = res.mode === 'daily';
    view('<div class="adm-title"><h1>' + esc(res.user.office) + '</h1><p class="muted">' + esc(res.user.name) + ' · 관리자</p></div>' +
      '<a class="card ring-card" href="#/status"><div class="ring" style="--p:' + p + '"><span>' + p + '%</span></div>' +
      '<div style="flex:1"><div class="muted" style="font-size:15px">' + (daily ? '오늘 ' + esc(res.todayLabel) + ' 권역 제출 현황' : '권역 전체 제출 현황 · ' + esc(res.week.title.split(' · ')[0])) + '</div>' +
      '<b style="font-size:21px">' + res.submitted + ' / ' + res.total + '명 제출</b><div class="muted">' +
      (daily ? '아직 ' + (res.total - res.submitted) + '명 · 사유(비번 등) ' + res.excused + '명' : '미제출 ' + (res.total - res.submitted) + '명') +
      '</div></div><span class="chev">›</span></a>' +
      '<div class="home-grid">' +
      '<a class="home-btn" href="#/status"><span class="ico">📊</span><span>권역 현황<small>영업소별 제출률 · 미제출자</small></span></a>' +
      '<a class="home-btn" href="#/risks"><span class="ico">⚠️</span><span>위험요인 응답<small>건강 지장 · \'아니오\' 응답</small></span>' +
        (res.risk ? '<span class="count">' + res.risk + '</span>' : '') + '</a>' +
      '<a class="home-btn" href="#/notices"><span class="ico">📢</span><span>공지사항<small>근무자에게 게시된 공지</small></span>' +
        (res.unreadNotices ? '<span class="count">' + res.unreadNotices + '</span>' : '') + '</a>' +
      '<a class="home-btn" href="#/me"><span class="ico">👤</span><span>내 정보<small>비밀번호 바꾸기 · 로그아웃</small></span></a>' +
      '</div>');
  }

  function screenStatus() {
    api('adminSummary', { week: state.adminWeek || '' }, { keepError: true }).then(function (res) {
      if (!res.ok) return handleAuthError(res);
      state.adminWeek = res.week.start; state.adminOffices = res.offices;
      var daily = res.mode === 'daily';
      var p = pct(res.submitted, res.total), bands = { r: 0, y: 0, g: 0 };
      var opct = function (o) { return o.total ? pct(o.submitted, o.total) : 100; };   // 아직 셀 날이 없으면 100으로 취급
      res.offices.forEach(function (o) { bands[bandCls(opct(o))]++; });
      var sort = state.adminSort || 'low';
      var list = res.offices.slice().sort(sort === 'low'
        ? function (a, b) { return opct(a) - opct(b) || (a.office < b.office ? -1 : 1); }
        : function (a, b) { return a.office < b.office ? -1 : 1; });
      view('<h1>권역 현황</h1>' +
        '<select id="wk" class="wk">' + res.weeks.map(function (w) {
          return '<option value="' + esc(w.start) + '"' + (w.start === res.week.start ? ' selected' : '') + '>' + esc(w.title) + '</option>';
        }).join('') + (res.weeks.some(function (w) { return w.start === res.week.start; }) ? '' : '<option selected>' + esc(res.week.title) + '</option>') + '</select>' +
        (daily
          ? '<div class="stat-dark"><div><div class="lbl">주간 참여율 (매일 TBM)</div><div class="big">' + p + '%</div>' +
            '<div class="sub">' + res.submitted + ' / ' + res.total + '건 제출 · 사유 ' + res.excused + '건 · ' + (res.week.closed ? '마감됨' : '진행 중') + '</div></div>' +
            '<div style="text-align:right"><div class="lbl">미실시</div><div class="mid">' + res.missing + '건</div></div></div>' +
            '<p class="hint" style="margin:-4px 2px 12px">건 = 사람 × 날. 비번·연차 등 사유를 넣은 날은 빼고, 오늘 아직 안 한 사람은 미실시로 세지 않습니다.</p>'
          : '<div class="stat-dark"><div><div class="lbl">권역 전체 제출률</div><div class="big">' + p + '%</div>' +
            '<div class="sub">' + res.submitted + ' / ' + res.total + '명 제출 · ' + (res.week.closed ? '마감됨' : '진행 중') + '</div></div>' +
            '<div style="text-align:right"><div class="lbl">미제출</div><div class="mid">' + (res.total - res.submitted) + '명</div></div></div>') +
        '<div class="bands"><span class="r">50% 미만 ' + bands.r + '곳</span><span class="y">50~89% ' + bands.y + '곳</span><span class="g">90% 이상 ' + bands.g + '곳</span></div>' +
        '<a class="card row-link" href="#/risks"><b>위험요인 응답</b><span><span class="pill">' + res.risk + '명</span><span class="chev">›</span></span></a>' +
        '<div class="list-head"><b>소속 ' + res.offices.length + '곳</b><div class="seg"><button data-s="low" class="' + (sort === 'low' ? 'on' : '') + '">낮은 순</button>' +
        '<button data-s="name" class="' + (sort === 'name' ? 'on' : '') + '">이름순</button></div></div>' +
        '<div class="card" style="padding:0 18px">' + list.map(function (o) {
          var q = opct(o);
          return '<a class="off-row" href="#/office/' + encodeURIComponent(o.office) + '"><div class="off-top"><b>' + esc(o.office) + '</b><b class="pc ' + bandCls(q) + '">' + (o.total ? q + '%' : '–') + '</b></div>' +
            '<div class="bar"><div class="' + bandCls(q) + '" style="width:' + (o.total ? q : 0) + '%"></div></div><div class="muted" style="font-size:15px">' +
            (daily ? o.submitted + ' / ' + o.total + '건 제출' + (o.missing ? ' · <b class="pc r">미실시 ' + o.missing + '</b>' : '') + (o.excused ? ' · 사유 ' + o.excused : '')
              : o.submitted + ' / ' + o.total + '명 제출') + '</div></a>';
        }).join('') + '</div><a class="btn ghost" href="#/home">홈으로</a>');
      $('#wk').onchange = function () { state.adminWeek = this.value; screenStatus(); };
      $all('.seg button').forEach(function (b) { b.onclick = function () { state.adminSort = b.getAttribute('data-s'); screenStatus(); }; });
    });
  }

  function screenOffice(office) {
    api('adminOffice', { week: state.adminWeek || '', office: office }, { keepError: true }).then(function (res) {
      if (!res.ok) return handleAuthError(res);
      if (res.mode === 'daily') return officeDaily(res);
      var p = pct(res.submitted.length, res.total);
      view('<h1>' + esc(res.office) + '</h1><p class="hint" style="margin-top:-6px">' + esc(res.week.title) + '</p>' +
        '<div class="stat-dark"><div><div class="lbl">제출률</div><div class="big">' + p + '%</div><div class="sub">' + res.submitted.length + ' / ' + res.total + '명 제출</div></div>' +
        '<div style="text-align:right"><div class="lbl">미제출</div><div class="mid">' + res.missing.length + '명</div></div></div>' +
        '<h2>미제출 ' + res.missing.length + '명</h2><div class="card" style="padding:4px 18px">' + (res.missing.length ? res.missing.map(function (m) {
          return '<div class="list-row"><span><b>' + esc(m.name) + '</b>' + (m.sup ? ' <span class="badge b-blue">관리감독자</span>' : '') + '</span>' +
            (m.firstUse ? '<span class="badge b-gray">첫 사용 전</span>' : '') + '</div>';
        }).join('') : '<p class="muted">모두 제출했습니다.</p>') + '</div>' +
        '<h2>제출 ' + res.submitted.length + '명</h2><div class="card" style="padding:4px 18px">' + (res.submitted.length ? res.submitted.map(function (m) {
          var badge = m.healthBad ? '<span class="badge b-bad">건강 지장</span>' : m.noCount ? '<span class="badge b-warn">아니오 ' + m.noCount + '</span>' : '<span class="badge b-ok">완료</span>';
          return '<div class="list-row"><span><b>' + esc(m.name) + '</b>' + (m.sup ? ' <span class="badge b-blue">관리감독자</span>' : '') +
            '<br><span class="muted" style="font-size:14px">' + esc(m.day) + ' ' + esc(m.shift) + ' · ' + esc(m.time) + '</span></span>' + badge + '</div>';
        }).join('') : '<p class="muted">아직 제출한 사람이 없습니다.</p>') + '</div>' +
        '<a class="btn ghost" href="#/staff/' + encodeURIComponent(res.office) + '">직원 관리 (입사·퇴사·전보)</a>' +
        '<a class="btn" href="#/status">권역 현황으로</a>');
    });
  }

  function screenRisks() {
    api('adminRisks', { week: state.adminWeek || '' }, { keepError: true }).then(function (res) {
      if (!res.ok) return handleAuthError(res);
      view('<h1>위험요인 응답</h1><p class="hint" style="margin-top:-6px">' + esc(res.week.title) + ' · 건강 \'지장 있음\' 또는 점검 \'아니오\'</p>' +
        (res.items.length ? res.items.map(function (r) {
          return '<div class="card"><div style="display:flex;justify-content:space-between;gap:10px"><b>' + esc(r.name) + ' · ' + esc(r.office) + '</b>' +
            (r.healthBad ? '<span class="badge b-bad">건강 지장</span>' : '<span class="badge b-warn">아니오 ' + r.noCount + '</span>') + '</div>' +
            '<p class="muted" style="margin:4px 0;font-size:14px">' + esc(r.day) + ' ' + esc(r.shift) + ' · ' + esc(r.time) + ' 제출</p>' +
            (r.noText ? '<div class="notice-body" style="font-size:15px">' + esc(r.noText) + '</div>' : '') +
            (r.remarks ? '<div class="alert info" style="margin:10px 0 0;font-size:15px">특이사항: ' + esc(r.remarks) + '</div>' : '') + '</div>';
        }).join('') : '<div class="card"><p class="muted">이 주에는 위험요인 응답이 없습니다.</p></div>') +
        '<a class="btn" href="#/status">권역 현황으로</a><a class="btn ghost" href="#/home">홈으로</a>');
    });
  }

  // 관리자: 소속 주간 표 (매일 TBM) — 사람 × 요일: ○ 제출 · 사유 · ✕ 미실시
  function officeDaily(res) {
    var p = pct(res.done, res.total);
    var head = res.days.map(function (d) { var m = d.label.match(/^(\d+)\/(\d+)\((.)\)$/); return '<th>' + (m ? m[3] + '<br><small>' + m[2] + '</small>' : esc(d.label)) + '</th>'; }).join('');
    var rows = res.people.map(function (m) {
      return '<tr><td class="nm">' + esc(m.name) + (m.firstUse ? '<br><small class="muted">첫 사용 전</small>' : '') + '</td>' + m.cells.map(function (c) {
        if (c.s === 'O') return '<td class="c o' + (c.bad ? ' bad' : '') + '" title="' + esc(c.t) + '">○</td>';
        if (c.s === 'R') return '<td class="c rs">' + esc(String(c.r).slice(0, 2)) + '</td>';
        if (c.s === 'X') return '<td class="c x">✕</td>';
        if (c.s === 'W') return '<td class="c w">·</td>';
        return '<td class="c"></td>';
      }).join('') + '</tr>';
    }).join('');
    view('<h1>' + esc(res.office) + '</h1><p class="hint" style="margin-top:-6px">' + esc(res.week.title) + '</p>' +
      '<div class="stat-dark"><div><div class="lbl">주간 참여율</div><div class="big">' + (res.total ? p + '%' : '–') + '</div><div class="sub">' + res.done + ' / ' + res.total + '건 제출 · 사유 ' + res.excused + '건</div></div>' +
      '<div style="text-align:right"><div class="lbl">미실시</div><div class="mid">' + res.missing + '건</div></div></div>' +
      '<div class="card" style="padding:12px 8px"><table class="wk-grid"><thead><tr><th class="nm">이름</th>' + head + '</tr></thead><tbody>' +
      (rows || '<tr><td colspan="8" class="muted">대상자가 없습니다.</td></tr>') + '</tbody></table>' +
      '<p class="legend"><span class="o">○</span> 제출 <span class="x">✕</span> 미실시 <span class="rs">비번</span> 사유 · 오늘 아직 · <span class="o bad">○</span> 건강 지장·아니오</p></div>' +
      '<a class="btn" href="#/manage/' + encodeURIComponent(res.office) + '">날짜별 사유 입력 (관리감독자 대신)</a>' +
      '<a class="btn ghost" href="#/periods/' + encodeURIComponent(res.office) + '">병가·휴직 기간</a>' +
      '<a class="btn ghost" href="#/staff/' + encodeURIComponent(res.office) + '">직원 관리 (입사·퇴사·전보)</a>' +
      '<a class="btn ghost" href="#/status">권역 현황으로</a>');
  }

  // ---------------- 근무자: 쉬는 날 등록 (앞뒤 7일, 등록하면 바로 인정) ----------------
  function rlabel(r) { return r === '비번·휴무' ? '휴무' : r; }

  function screenOff() {
    api('myOff', null, { keepError: true }).then(function (res) {
      if (!res.ok) return handleAuthError(res);
      var byDay = {}, picked = {}, reason = null;
      res.days.forEach(function (x) { byDay[x.d] = x; });
      // 달력: 첫 날이 속한 주 월요일 ~ 마지막 날이 속한 주 일요일
      var first = res.days[0].d, last = res.days[res.days.length - 1].d;
      var dow = function (d) { var p = d.split('-').map(Number); return (new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 6) % 7; };
      var start = addDays(first, -dow(first)), end = addDays(last, 6 - dow(last));
      var cells = '';
      for (var d = start; d <= end; d = addDays(d, 1)) {
        var x = byDay[d], num = Number(d.slice(8)), cls = 'cd', tag = '';
        if (!x || !x.open) cls += ' no';
        else if (x.done) { cls += ' done'; tag = 'TBM'; }
        else if (x.reason) { cls += ' rs'; tag = esc(rlabel(x.reason)).slice(0, 2); }
        else cls += ' free';
        if (x && x.today) cls += ' today';
        cells += '<button type="button" class="' + cls + '" data-d="' + d + '"' + (cls.indexOf('free') < 0 ? ' disabled' : '') + '>' +
          '<b>' + (num === 1 || d === start ? Number(d.slice(5, 7)) + '/' : '') + num + '</b><small>' + (x && x.today && !tag ? '오늘' : tag) + '</small></button>';
      }
      var mine = res.days.filter(function (x) { return x.reason; });
      view('<h1>쉬는 날 등록</h1><p class="hint" style="margin-top:-6px">쉬는 날을 눌러 고르고 사유를 저장하세요. ' + esc(fmtDate(res.from)) + ' ~ ' + esc(fmtDate(res.to)) +
        '까지만 됩니다.<br>병가·장기 휴직은 <b>소장님</b>께 말씀하세요.</p>' +
        '<div class="card cal-card"><div class="cal">' + ['월', '화', '수', '목', '금', '토', '일'].map(function (w) { return '<span class="wd">' + w + '</span>'; }).join('') + cells + '</div>' +
        '<p class="legend" style="margin-top:8px"><span class="o">TBM</span> 한 날 · <span class="rs">휴무</span> 등록된 날 · 회색은 등록 불가</p></div>' +
        '<div class="card"><b>사유</b><div class="chips" id="rs" style="margin-top:10px">' + res.reasons.map(function (r) {
          return '<button type="button" data-r="' + esc(r) + '">' + esc(rlabel(r)) + '</button>';
        }).join('') + '</div><button class="btn orange" id="save" disabled>날짜를 먼저 고르세요</button></div>' +
        '<h2>등록한 날 ' + mine.length + '일</h2><div class="card" style="padding:4px 18px">' + (mine.length ? mine.map(function (x) {
          return '<div class="list-row"><span><b>' + esc(x.label) + '</b> <span class="badge b-blue">' + esc(rlabel(x.reason)) + '</span>' +
            (!x.self ? '<br><span class="muted" style="font-size:14px">소장님이 넣은 사유' + (x.long ? ' (기간)' : '') + '</span>' : '') + '</span>' +
            (x.canCancel ? '<button class="mini" data-cancel="' + esc(x.id) + '" data-label="' + esc(x.label) + '">취소</button>' : '') + '</div>';
        }).join('') : '<p class="muted">없습니다.</p>') + '</div><a class="btn ghost" href="#/home">홈으로</a>');
      function refresh() {
        var n = Object.keys(picked).length, btn = $('#save');
        btn.disabled = !n;
        btn.textContent = !n ? '날짜를 먼저 고르세요' : !reason ? n + '일 · 사유를 고르세요' : n + '일을 "' + rlabel(reason) + '"(으)로 저장';
      }
      $all('.cd.free').forEach(function (b) {
        b.onclick = function () {
          var d = b.getAttribute('data-d');
          if (picked[d]) delete picked[d]; else picked[d] = true;
          b.classList.toggle('on', !!picked[d]); refresh();
        };
      });
      $all('#rs button').forEach(function (b) {
        b.onclick = function () { $all('#rs button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); reason = b.getAttribute('data-r'); refresh(); };
      });
      $('#save').onclick = function () {
        var dates = Object.keys(picked).sort();
        if (!dates.length) return toast('날짜를 골라 주세요.');
        if (!reason) return toast('사유를 골라 주세요.');
        api('myOffSet', { dates: dates, reason: reason }, { text: '저장하고 있습니다' }).then(function (r) {
          if (!r.ok) return;
          state.home = null;
          toast(r.added + '일을 등록했습니다.', true); screenOff();
        });
      };
      $all('[data-cancel]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm(b.getAttribute('data-label') + ' 쉬는 날 등록을 취소할까요?')) return;
          api('myOffCancel', { id: b.getAttribute('data-cancel') }).then(function (r) { if (r.ok) { state.home = null; toast('취소했습니다.', true); screenOff(); } });
        };
      });
    });
  }

  // ---------------- 관리감독자: 소속 관리 (매일 TBM) ----------------
  // 관리자는 주소 뒤에 소속 이름이 붙는다 (#/manage/대전영업소), 관리감독자는 자기 소속만
  function mgrOffice(arg) { return state.user && state.user.isAdmin ? arg : ''; }
  function mgrPath(path, arg) { var o = mgrOffice(arg); return '#' + path + (o ? '/' + encodeURIComponent(o) : ''); }
  function addDays(ymd, n) { var p = ymd.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }

  function managerHome(res) {
    var p = pct(res.submitted, res.total);
    view('<div class="adm-title"><h1>' + esc(res.office) + '</h1><p class="muted">' + esc(res.user.name) + ' · 관리감독자</p></div>' +
      (res.user.isDemo ? '<div class="alert warn">시연 계정입니다. 화면은 볼 수 있지만 저장되지 않습니다.</div>' : '') +
      '<a class="card ring-card" href="#/manage"><div class="ring" style="--p:' + p + '"><span>' + p + '%</span></div>' +
      '<div style="flex:1"><div class="muted" style="font-size:15px">오늘 ' + esc(res.todayLabel) + ' TBM</div>' +
      '<b style="font-size:21px">' + res.submitted + ' / ' + res.total + '명 제출</b><div class="muted">아직 ' + res.waiting + '명' +
      (res.excused ? ' · 쉬는 사람 ' + res.excused + '명' : '') + '</div></div><span class="chev">›</span></a>' +
      (res.risk ? '<a class="alert err" style="display:block;text-decoration:none" href="#/manage">⚠️ 오늘 건강 지장·\'아니오\' 응답 ' + res.risk + '건 — 눌러서 확인</a>' : '') +
      '<div class="home-grid">' +
      '<a class="home-btn main' + (res.waiting ? ' has-count' : '') + '" href="#/manage"><span class="ico">📝</span><span>오늘 현황 보기<small>TBM 안 한 사람에게 비번·연차 등 사유 넣기</small></span>' +
        (res.waiting ? '<span class="count">' + res.waiting + '</span>' : '') + '</a>' +
      '<a class="home-btn" href="#/periods"><span class="ico">🗓️</span><span>병가·휴직 기간 입력<small>며칠씩 쉬는 사람은 한 번에</small></span></a>' +
      '<a class="home-btn" href="#/staff"><span class="ico">👥</span><span>직원 관리<small>입사·퇴사·전보 · 비밀번호 초기화</small></span></a>' +
      '<a class="home-btn" href="#/notices"><span class="ico">📢</span><span>공지사항<small>안전수칙·전달사항</small></span>' +
        (res.unreadNotices ? '<span class="count">' + res.unreadNotices + '</span>' : '') + '</a>' +
      '<a class="home-btn" href="#/report"><span class="ico">⚠️</span><span>위험·아차사고 보고<small>사진과 함께 바로 알리기</small></span></a>' +
      '</div><p style="text-align:center;margin-top:22px"><a href="#/me" class="muted">내 정보 · 비밀번호 바꾸기 · 로그아웃</a></p>');
  }

  function screenManage(arg) {
    var office = mgrOffice(arg);
    if (state.user && state.user.isAdmin && !office) return go('/status');
    api('mgrDay', { office: office, date: state.mgrDate || '' }, { keepError: true }).then(function (res) {
      if (!res.ok) {
        if (state.mgrDate && /까지만|앞날|날짜/.test(res.error || '')) { toast(res.error); state.mgrDate = ''; return screenManage(arg); }
        return handleAuthError(res);
      }
      state.mgrDate = res.date;
      var ro = res.readOnly, isToday = res.date === res.today, c = res.counts;
      var waiting = res.people.filter(function (x) { return x.state === 'W' || x.state === 'X'; });
      var excused = res.people.filter(function (x) { return x.state === 'R'; });
      var done = res.people.filter(function (x) { return x.state === 'O'; });
      var canPrev = !res.minDate || addDays(res.date, -1) >= res.minDate, canNext = res.date < res.today;
      var html = '<h1>' + esc(res.office) + '</h1>' +
        '<div class="date-nav"><button id="dPrev"' + (canPrev ? '' : ' disabled') + '>‹ 전날</button><div><b>' + esc(res.dateLabel) + '</b><small>' +
        (isToday ? '오늘' : '지난 날') + '</small></div><button id="dNext"' + (canNext ? '' : ' disabled') + '>다음날 ›</button></div>' +
        (!isToday ? '<button class="btn ghost slim" id="dToday">오늘로 돌아가기</button>' : '') +
        (res.minDate ? '<p class="hint" style="text-align:center;margin:0 0 10px">' + esc(fmtDate(res.minDate)) + '까지 고칠 수 있습니다 (' + res.backDays + '일 전)</p>' : '') +
        (!res.daily ? '<div class="alert info">' + esc(fmtDate(res.dailyFrom)) + '부터 매일 TBM이 시작됩니다. 지금은 연습으로 눌러 볼 수 있습니다 (실적과 상관없음).</div>' : '') +
        (ro ? '<div class="alert warn">시연 계정: 보기만 할 수 있습니다.</div>' : '') +
        '<div class="sum4"><div><b>' + c.people + '</b>대상</div><div class="g"><b>' + c.done + '</b>제출</div><div class="b"><b>' + c.excused + '</b>사유</div>' +
        '<div class="r"><b>' + c.waiting + '</b>' + (isToday ? '아직' : '미실시') + '</div></div>';
      // 1) 아직 안 한 사람 → 골라서 사유 저장
      html += '<h2>' + (isToday ? '아직 안 한 사람' : 'TBM 안 한 사람') + ' ' + waiting.length + '명</h2>';
      if (waiting.length) {
        html += '<p class="hint" style="margin:-6px 0 10px">' + (isToday
          ? '근무자가 쉬는 날을 직접 등록하지 않았을 때만 골라서 사유를 저장하세요. 출근할 사람은 그대로 두면 됩니다.'
          : '쉬었는데 등록을 안 한 사람만 골라 사유를 저장하세요. 사유가 없으면 <b>미실시</b>로 남습니다.') + '</p>' +
          '<div class="card sel-card">' + (ro ? '' : '<label class="sel-row all"><input type="checkbox" id="selAll"><span>전체 선택</span></label>') +
          waiting.map(function (x) {
            return '<label class="sel-row"><input type="checkbox" class="pick" value="' + esc(x.empNo) + '"' + (ro ? ' disabled' : '') + '><span><b>' + esc(x.name) + '</b>' +
              (x.firstUse ? ' <span class="badge b-gray">첫 사용 전</span>' : '') + '</span>' + (x.state === 'X' ? '<span class="badge b-bad">미실시</span>' : '') + '</label>';
          }).join('') + '</div>';
        if (!ro) {
          html += '<div class="card" id="reasonBox"><b>사유 고르기</b><div class="chips" id="rs" style="margin-top:10px">' +
            res.reasons.map(function (r) { return '<button type="button" data-r="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') +
            '</div><button class="btn orange" id="saveR" disabled>사람을 먼저 고르세요</button></div>';
        }
      } else {
        html += '<div class="card"><p class="muted" style="margin:0">' + (isToday ? '모두 제출했거나 사유가 들어 있습니다. 👍' : '없습니다. 👍') + '</p></div>';
      }
      // 2) 사유 입력됨
      html += '<h2>사유 입력됨 ' + excused.length + '명</h2><div class="card" style="padding:4px 18px">' + (excused.length ? excused.map(function (x) {
        return '<div class="list-row"><span><b>' + esc(x.name) + '</b> <span class="badge b-blue">' + esc(x.reason) + '</span>' + (x.self ? ' <span class="badge b-gray">본인 등록</span>' : '') +
          (x.absFrom !== x.absTo ? '<br><span class="muted" style="font-size:14px">' + esc(fmtDate(x.absFrom)) + ' ~ ' + esc(fmtDate(x.absTo)) + ' (기간)</span>' : '') +
          (x.memo && x.memo !== '본인 등록' ? '<br><span class="muted" style="font-size:14px">' + esc(x.memo) + '</span>' : '') + '</span>' +
          (x.canCancel && !ro ? '<button class="mini" data-cancel="' + esc(x.absId) + '" data-name="' + esc(x.name) + '" data-reason="' + esc(x.reason) + '">취소</button>' : '') + '</div>';
      }).join('') : '<p class="muted">없습니다.</p>') + '</div>';
      // 3) 제출한 사람 (건강 지장·아니오는 내용까지)
      html += '<h2>제출 ' + done.length + '명</h2><div class="card" style="padding:4px 18px">' + (done.length ? done.map(function (x) {
        var badge = x.healthBad ? '<span class="badge b-bad">건강 지장</span>' : x.noCount ? '<span class="badge b-warn">아니오 ' + x.noCount + '</span>'
          : '<span class="badge b-ok">완료</span>';
        return '<div class="list-row col"><div class="lr-top"><span><b>' + esc(x.name) + '</b><br><span class="muted" style="font-size:14px">' + esc(x.shift) + ' · ' + esc(x.time) + ' 제출</span></span>' + badge + '</div>' +
          (x.healthBad ? '<div class="alert err" style="margin:8px 0 0;font-size:15px">건강상태 "지장 있음" — 본인에게 확인하고 작업 투입 여부를 정해 주세요.</div>' : '') +
          (x.noText ? '<div class="notice-body" style="font-size:15px;margin-top:6px">' + esc(x.noText) + '</div>' : '') +
          (x.remarks ? '<div class="alert info" style="margin:8px 0 0;font-size:15px">특이사항: ' + esc(x.remarks) + '</div>' : '') + '</div>';
      }).join('') : '<p class="muted">아직 없습니다.</p>') + '</div>';
      html += '<a class="btn ghost" href="' + mgrPath('/periods', arg) + '">병가·휴직 기간 입력</a>' +
        (office ? '<a class="btn ghost" href="#/office/' + encodeURIComponent(office) + '">소속 주간 현황</a>' : '') +
        '<a class="btn ghost" href="#/home">홈으로</a>';
      view(html);

      var move = function (d) { state.mgrDate = d; screenManage(arg); };
      $('#dPrev').onclick = function () { move(addDays(res.date, -1)); };
      $('#dNext').onclick = function () { move(addDays(res.date, 1)); };
      if ($('#dToday')) $('#dToday').onclick = function () { move(res.today); };
      var reason = null;
      function picked() { return $all('.pick').filter(function (x) { return x.checked; }).map(function (x) { return x.value; }); }
      function refresh() {
        var n = picked().length, btn = $('#saveR');
        $all('.sel-row').forEach(function (l) { var i = $('input', l); l.classList.toggle('on', !!(i && i.checked)); });
        if ($('#selAll')) $('#selAll').checked = n > 0 && n === $all('.pick').length;
        if (!btn) return;
        btn.disabled = !n;
        btn.textContent = !n ? '사람을 먼저 고르세요' : !reason ? n + '명 · 사유를 고르세요' : n + '명을 "' + reason + '"(으)로 저장';
      }
      $all('.pick').forEach(function (x) { x.onchange = refresh; });
      if ($('#selAll')) $('#selAll').onchange = function () { var on = this.checked; $all('.pick').forEach(function (x) { x.checked = on; }); refresh(); };
      $all('#rs button').forEach(function (b) {
        b.onclick = function () { $all('#rs button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); reason = b.getAttribute('data-r'); refresh(); };
      });
      if ($('#saveR')) $('#saveR').onclick = function () {
        var list = picked();
        if (!list.length) return toast('사람을 골라 주세요.');
        if (!reason) return toast('사유를 골라 주세요.');
        api('mgrSetReason', { office: office, date: res.date, reason: reason, empNos: list }, { text: '저장하고 있습니다' }).then(function (r) {
          if (!r.ok) return;
          toast(r.added + '명 저장했습니다.', true); screenManage(arg);
        });
      };
      $all('[data-cancel]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm(b.getAttribute('data-name') + '님의 "' + b.getAttribute('data-reason') + '" 사유를 취소할까요?')) return;
          api('mgrCancel', { office: office, id: b.getAttribute('data-cancel') }).then(function (r) { if (r.ok) { toast('취소했습니다.', true); screenManage(arg); } });
        };
      });
    });
  }

  function screenPeriods(arg) {
    var office = mgrOffice(arg);
    if (state.user && state.user.isAdmin && !office) return go('/status');
    api('mgrPeriods', { office: office }, { keepError: true }).then(function (res) {
      if (!res.ok) return handleAuthError(res);
      var ro = res.readOnly, reason = '병가';
      var html = '<h1>병가·휴직 기간</h1><p class="hint" style="margin-top:-6px">' + esc(res.office) + ' · 넣은 기간에는 TBM 대상에서 빠집니다.</p>' +
        '<h2>입력된 기간 ' + res.items.length + '건</h2><div class="card" style="padding:4px 18px">' + (res.items.length ? res.items.map(function (it) {
          return '<div class="list-row"><span><b>' + esc(it.name) + '</b> <span class="badge b-blue">' + esc(it.reason) + '</span>' +
            (it.ongoing ? ' <span class="badge b-warn">쉬는 중</span>' : '') + '<br><span class="muted" style="font-size:15px">' + esc(it.label) +
            (it.memo ? ' · ' + esc(it.memo) : '') + '</span></span><span class="btns">' +
            (!ro && it.canEnd ? '<button class="mini" data-end="' + esc(it.id) + '" data-name="' + esc(it.name) + '">복귀</button>' : '') +
            (!ro && it.canCancel ? '<button class="mini red" data-cancel="' + esc(it.id) + '" data-name="' + esc(it.name) + '">취소</button>' : '') + '</span></div>';
        }).join('') : '<p class="muted">없습니다.</p>') + '</div>';
      if (!ro) {
        html += '<h2>새로 넣기</h2><div class="card"><label class="lb" for="who" style="margin-top:0">누구</label><select id="who"><option value="">이름을 고르세요</option>' +
          res.people.map(function (x) { return '<option value="' + esc(x.empNo) + '">' + esc(x.name) + '</option>'; }).join('') + '</select>' +
          '<label class="lb">사유</label><div class="chips" id="rs">' + res.reasons.map(function (r) {
            return '<button type="button" data-r="' + esc(r) + '"' + (r === reason ? ' class="on"' : '') + '>' + esc(r) + '</button>';
          }).join('') + '</div>' +
          '<label class="lb" for="from">쉬기 시작하는 날</label><input type="date" id="from" value="' + esc(res.today) + '"' + (res.minDate ? ' min="' + esc(res.minDate) + '"' : '') + '>' +
          '<label class="lb" for="to">마지막으로 쉬는 날</label><input type="date" id="to" value="' + esc(res.today) + '">' +
          '<label class="lb" for="memo">메모 (선택)</label><input type="text" id="memo" maxlength="100" placeholder="예: 허리 치료">' +
          '<button class="btn orange" id="save">저장</button></div>';
      }
      html += '<a class="btn ghost" href="' + mgrPath('/manage', arg) + '">오늘 현황으로</a><a class="btn ghost" href="#/home">홈으로</a>';
      view(html);
      $all('#rs button').forEach(function (b) {
        b.onclick = function () { $all('#rs button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); reason = b.getAttribute('data-r'); };
      });
      if ($('#from')) $('#from').onchange = function () { if ($('#to').value < this.value) $('#to').value = this.value; };
      if ($('#save')) $('#save').onclick = function () {
        var who = $('#who').value, from = $('#from').value, to = $('#to').value;
        if (!who) return toast('이름을 골라 주세요.');
        if (!from || !to) return toast('날짜를 넣어 주세요.');
        if (to < from) return toast('마지막 날이 시작일보다 앞입니다.');
        var name = $('#who').selectedOptions[0].textContent;
        if (!confirm(name + '님\n' + reason + ' · ' + fmtDate(from) + ' ~ ' + fmtDate(to) + '\n저장할까요?')) return;
        api('mgrAbsence', { office: office, empNo: who, reason: reason, from: from, to: to, memo: $('#memo').value }, { text: '저장하고 있습니다' }).then(function (r) {
          if (!r.ok) return;
          toast(r.duplicate ? '이미 들어 있는 기간입니다.' : '저장했습니다.', true); screenPeriods(arg);
        });
      };
      $all('[data-end]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm(b.getAttribute('data-name') + '님이 오늘(' + fmtDate(res.today) + ')부터 복귀했나요?\n오늘부터 다시 TBM 대상이 됩니다.')) return;
          api('mgrCancel', { office: office, id: b.getAttribute('data-end'), mode: 'end', back: res.today }).then(function (r) { if (r.ok) { toast('복귀 처리했습니다.', true); screenPeriods(arg); } });
        };
      });
      $all('[data-cancel]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm(b.getAttribute('data-name') + '님의 기간 입력을 취소(삭제)할까요?')) return;
          api('mgrCancel', { office: office, id: b.getAttribute('data-cancel') }).then(function (r) { if (r.ok) { toast('취소했습니다.', true); screenPeriods(arg); } });
        };
      });
    });
  }

  // ---------------- 직원 관리: 입사·전입·퇴사·전출·비밀번호 초기화 ----------------
  // 관리자는 소속을 주소(#/staff/대전영업소)로 받고, 등록·상세 화면은 마지막으로 연 소속을 쓴다
  function staffOffice(arg) { var o = mgrOffice(arg); if (o) state.staffOffice = o; return state.user && state.user.isAdmin ? (o || state.staffOffice || '') : ''; }
  function staffBack() { return '#/staff' + (state.user && state.user.isAdmin && state.staffOffice ? '/' + encodeURIComponent(state.staffOffice) : ''); }

  function screenStaff(arg) {
    var office = staffOffice(arg);
    if (state.user && state.user.isAdmin && !office) return go('/status');
    api('mgrStaff', { office: office }, { keepError: true }).then(function (res) {
      if (!res.ok) return handleAuthError(res);
      state.staff = res;
      view('<h1>직원 관리</h1><p class="hint" style="margin-top:-6px">' + esc(res.office) + ' · ' + res.items.length + '명 · 이름을 누르면 이동·퇴사·비밀번호 초기화</p>' +
        (res.readOnly ? '<div class="alert warn">시연 계정: 보기만 할 수 있습니다.</div>' : '<a class="btn orange" href="#/staffadd" style="margin:0 0 14px">＋ 직원 등록 (입사·전입)</a>') +
        '<div class="card" style="padding:4px 18px">' + res.items.map(function (x) {
          var tags = (x.sup ? ' <span class="badge b-blue">관리감독자</span>' : '') + (x.job ? ' <span class="badge b-gray">' + esc(x.job) + '</span>' : '') +
            (x.until ? ' <span class="badge b-bad">퇴사 ' + esc(fmtDate(x.until)) + '</span>' : '');
          var sub = esc(x.empNo) + (x.since ? ' · ' + esc(fmtDate(x.since)) + ' 등록' : '') + (x.firstUse ? ' · 첫 사용 전' : !x.pwSet ? ' · 비밀번호 = 사번' : '');
          return x.canEdit
            ? '<a class="list-row" href="#/staffone/' + esc(x.empNo) + '"><span><b>' + esc(x.name) + '</b>' + tags + '<br><span class="muted" style="font-size:14px">' + sub + '</span></span><span class="chev">›</span></a>'
            : '<div class="list-row"><span><b>' + esc(x.name) + '</b>' + tags + '<br><span class="muted" style="font-size:14px">' + sub + '</span></span></div>';
        }).join('') + '</div>' +
        '<p class="hint">관리감독자 본인·다른 관리감독자의 변경과 관리감독자 지정은 안전관리자가 합니다.</p>' +
        '<a class="btn ghost" href="#/home">홈으로</a>');
    });
  }

  function screenStaffAdd() {
    var office = state.user && state.user.isAdmin ? state.staffOffice || '' : '';
    if (state.user && state.user.isAdmin && !office) return go('/status');
    var today = state.staff ? state.staff.today : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    var job = '';
    view('<h1>직원 등록</h1><p class="hint" style="margin-top:-6px">' + esc(state.staff ? state.staff.office : office) +
      ' · 새로 온 직원(입사·다른 소속에서 전입·재입사)</p><div class="card">' +
      '<label class="lb" for="emp" style="margin-top:0">사번</label><input id="emp" class="big-input" type="text" inputmode="numeric" maxlength="10">' +
      '<label class="lb" for="nm">성명</label><input id="nm" type="text" maxlength="20" style="font-size:22px;font-weight:700">' +
      '<label class="lb">직종</label><div class="chips" id="jb"><button type="button" data-j="" class="on">일반</button><button type="button" data-j="환경조리">환경조리</button></div>' +
      '<label class="lb" for="dt">첫 근무일</label><input type="date" id="dt" value="' + esc(today) + '">' +
      '<p class="hint">이 날부터 TBM 대상이 됩니다. 비밀번호는 처음에 사번과 같습니다.</p>' +
      '<button class="btn orange" id="save">등록</button></div><a class="btn ghost" href="' + staffBack() + '">직원 목록으로</a>');
    $all('#jb button').forEach(function (b) {
      b.onclick = function () { $all('#jb button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); job = b.getAttribute('data-j'); };
    });
    $('#save').onclick = function () {
      var data = { office: office, empNo: $('#emp').value.trim(), name: $('#nm').value.trim(), job: job, date: $('#dt').value };
      if (!/^\d{4,10}$/.test(data.empNo)) return toast('사번을 숫자로 넣어 주세요.');
      if (data.name.length < 2) return toast('성명을 넣어 주세요.');
      if (!data.date) return toast('첫 근무일을 넣어 주세요.');
      var done = function (r) {
        if (!r.ok) return;
        toast(r.name + '님을 ' + (r.done === 'moved' ? '우리 소속으로 옮겼습니다.' : r.done === 'rehired' ? '다시 등록했습니다. 사번으로 로그인하면 됩니다.' : '등록했습니다. 사번으로 로그인하면 됩니다.'), true);
        location.hash = staffBack();
      };
      api('mgrAddWorker', data, { text: '등록하고 있습니다' }).then(function (r) {
        if (!r.ok || !r.needConfirm) return done(r);
        var q = r.kind === '전입' ? r.fromOffice + '에서 근무 중인 ' + r.name + '님입니다.\n우리 소속으로 옮길까요?'
          : '퇴사 처리된 ' + r.name + '님입니다.\n다시 등록할까요? (비밀번호는 사번으로 초기화)';
        if (!confirm(q)) return;
        api('mgrAddWorker', Object.assign({ confirm: true }, data), { text: '저장하고 있습니다' }).then(done);
      });
    };
  }

  function screenStaffOne(empNo) {
    var res = state.staff, x = res && res.items.filter(function (i) { return i.empNo === empNo; })[0];
    if (!x) return location.hash = staffBack();
    var office = state.user && state.user.isAdmin ? res.office : '';
    var today = res.today;
    view('<h1>' + esc(x.name) + '</h1><p class="hint" style="margin-top:-6px">' + esc(res.office) + ' · 사번 ' + esc(x.empNo) + '</p>' +
      '<div class="card"><h2 style="margin-bottom:6px">🔀 다른 소속으로 이동 (전출)</h2>' +
      '<select id="to"><option value="">옮겨 갈 소속을 고르세요</option>' + res.offices.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select>' +
      '<label class="lb" for="tdt">이동일 (새 소속 첫 근무일)</label><input type="date" id="tdt" value="' + esc(today) + '" max="' + esc(today) + '"' + (res.minDate ? ' min="' + esc(res.minDate) + '"' : '') + '>' +
      '<button class="btn" id="move">이동</button></div>' +
      '<div class="card"><h2 style="margin-bottom:6px">👋 퇴사</h2>' +
      (x.until ? '<p style="margin:0">퇴사 예정: <b>' + esc(fmtDate(x.until)) + '</b>까지 근무</p><button class="btn ghost" id="undo">퇴사 취소</button>'
        : '<label class="lb" for="qdt" style="margin-top:4px">마지막 근무일</label><input type="date" id="qdt" value="' + esc(today) + '"' + (res.minDate ? ' min="' + esc(res.minDate) + '"' : '') + '>' +
          '<p class="hint">다음 날부터 로그인할 수 없고 TBM 대상에서 빠집니다.</p><button class="btn red" id="quit">퇴사 처리</button>') + '</div>' +
      (x.canReset ? '<div class="card"><h2 style="margin-bottom:6px">🔑 비밀번호 초기화</h2><p class="hint" style="margin:0">비밀번호가 사번으로 돌아갑니다. 5번 틀려 잠긴 경우에도 바로 풀립니다.</p>' +
        '<button class="btn ghost" id="reset">초기화</button></div>' : '') +
      '<a class="btn ghost" href="' + staffBack() + '">직원 목록으로</a>');
    var back = function (msg) { toast(msg, true); location.hash = staffBack(); };
    $('#move').onclick = function () {
      var to = $('#to').value, d = $('#tdt').value;
      if (!to) return toast('옮겨 갈 소속을 골라 주세요.');
      if (!confirm(x.name + '님을\n' + to + '(으)로 옮길까요? (' + fmtDate(d) + '부터)')) return;
      api('mgrTransfer', { office: office, empNo: x.empNo, toOffice: to, date: d }).then(function (r) { if (r.ok) back(r.name + '님을 ' + r.toOffice + '(으)로 옮겼습니다.'); });
    };
    if ($('#quit')) $('#quit').onclick = function () {
      var d = $('#qdt').value;
      if (!d) return toast('마지막 근무일을 넣어 주세요.');
      if (!confirm(x.name + '님 퇴사 처리\n마지막 근무일: ' + fmtDate(d) + '\n맞습니까?')) return;
      api('mgrRemoveWorker', { office: office, empNo: x.empNo, date: d }).then(function (r) { if (r.ok) back(r.name + '님 퇴사 처리했습니다.'); });
    };
    if ($('#undo')) $('#undo').onclick = function () {
      if (!confirm(x.name + '님 퇴사 예정을 취소할까요?')) return;
      api('mgrRemoveWorker', { office: office, empNo: x.empNo, undo: true }).then(function (r) { if (r.ok) back('퇴사 예정을 취소했습니다.'); });
    };
    if ($('#reset')) $('#reset').onclick = function () {
      if (!confirm(x.name + '님 비밀번호를 사번으로 초기화할까요?')) return;
      api('mgrResetPw', { office: office, empNo: x.empNo }).then(function (r) { if (r.ok) back(r.name + '님 비밀번호를 초기화했습니다. 사번으로 로그인하면 됩니다.'); });
    };
  }

  // ---------------- 시작 ----------------
  if (CFG.APP_NAME) { document.title = CFG.APP_NAME; $('#appname').textContent = CFG.APP_NAME; }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  route();
})();
