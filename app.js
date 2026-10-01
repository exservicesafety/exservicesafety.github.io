/* 「고속도로 영업소 TBM」 휴대폰 화면
 * - 서버: 구글 시트 Apps Script 웹 앱 (config.js의 API_URL)
 * - 로그인: 사번만 입력 → 이름 확인 → 이 휴대폰에 기억
 * - 화면 주소: #/home, #/tbm, #/records, #/notices, #/report ...
 */
(function () {
  'use strict';
  var CFG = window.TBM_CONFIG || {};
  var app = document.getElementById('app');
  var KEY = 'tbm_emp_no';
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
  function loading(on, text) {
    $('#loading').hidden = !on;
    $('#loadingText').textContent = text || '잠시만 기다려 주세요';
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
    var body = JSON.stringify(Object.assign({ action: action, empNo: empNo() }, data || {}));
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
  };
  function route() {
    var h = (location.hash || '#/home').slice(1);
    var parts = h.split('/'); var path = '/' + (parts[1] || 'home'); var arg = decodeURIComponent(parts.slice(2).join('/'));
    if (!CFG.API_URL || /여기에/.test(CFG.API_URL)) {
      return view('<div class="card"><h1>설정 필요</h1><p>config.js에 웹 앱 주소(API_URL)를 넣어 주세요.</p></div>');
    }
    if (path !== '/login' && !empNo()) return go('/login');
    if (path !== '/login' && path !== '/consent' && state.user && !state.user.consented) return go('/consent');
    if (state.flow && path !== '/check' && path !== '/done') state.flow = null;
    (routes[path] || screenHome)(arg);
  }
  window.addEventListener('hashchange', route);

  // ---------------- 로그인 (사번) ----------------
  function screenLogin() {
    state.user = null; setWho();
    view('<div class="card"><h1>사번 입력</h1>' +
      '<p class="hint" style="margin-top:-6px">처음 한 번만 입력하면 이 휴대폰에 기억됩니다.</p>' +
      '<form id="f"><label class="lb" for="emp">사번</label>' +
      '<input id="emp" class="big-input" type="text" inputmode="numeric" autocomplete="off" required>' +
      '<button class="btn">다음</button></form></div>' +
      '<p class="hint" style="text-align:center">사번이 등록되어 있지 않으면 안전관리자에게 문의해 주세요.</p>');
    $('#emp').focus();
    $('#f').onsubmit = function (e) {
      e.preventDefault();
      var v = $('#emp').value.trim();
      if (!v) return;
      setEmpNo(v);
      api('login', null, { keepError: true }).then(function (res) {
        if (!res.ok && notOpen(res)) return screenNotOpen(res.error);
        if (!res.ok) { toast(res.error || '오류가 났습니다.'); setEmpNo(''); return; }
        view('<div class="card" style="text-align:center"><h1>본인이 맞나요?</h1>' +
          '<p style="font-size:22px;margin:8px 0"><b>' + esc(res.user.name) + '</b>님</p>' +
          '<p class="muted" style="margin:0">' + esc(res.user.office) + ' · 사번 ' + esc(res.user.empNo) + '</p>' +
          '<div class="row2"><button class="btn ghost" id="no">아니요</button><button class="btn" id="yes">예, 맞습니다</button></div></div>');
        $('#no').onclick = function () { setEmpNo(''); screenLogin(); };
        $('#yes').onclick = function () {
          state.user = res.user; setWho();
          go(res.user.consented ? '/home' : '/consent');
        };
      });
    };
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
      '<button class="btn ghost" id="other">다른 사번으로 바꾸기</button></div>');
    $('#ok').onclick = function () {
      if (!$('#agree').checked) return toast('동의에 체크해 주세요.');
      api('consent').then(function (res) { if (res.ok) { state.user = res.user; setWho(); go('/home'); } });
    };
    $('#other').onclick = function () { setEmpNo(''); go('/login'); };
  }

  // ---------------- 홈 ----------------
  function screenHome() {
    api('home', null, { keepError: true }).then(function (res) {
      if (!res.ok) return handleAuthError(res);
      state.user = res.user; state.home = res; setWho();
      if (!res.user.consented) return go('/consent');
      // TBM은 주 1회: 이번 주에 냈으면 완료 표시, 아니면 참여 버튼
      var main, wd = res.weekDone;
      if (wd) {
        main = '<a class="home-btn done" href="#/record/' + esc(wd.no) + '"><span class="ico">✔️</span><span>이번 주 TBM 완료<small>' +
          esc(fmtDate(wd.workDate)) + ' ' + esc(wd.shift) + ' · ' + esc(wd.submittedAt.slice(11, 16)) + ' 제출 · 눌러서 내용 보기</small></span></a>' +
          '<p class="hint" style="text-align:center;margin:-4px 0 0">이번 주 ' + esc(res.weekLabel) + ' · 다음 주 월요일부터 다시 참여합니다</p>';
      } else {
        main = '<a class="home-btn main" href="#/tbm"><span class="ico">✅</span><span>이번 주 TBM 참여<small>' +
          esc(res.weekLabel) + ' · 아직 참여하지 않았습니다</small></span></a>';
      }
      var recent = res.recent.length ? '<div class="card" style="margin:0;padding:14px 18px"><b style="font-size:16px">최근 제출</b><ul class="recent">' +
        res.recent.map(function (r) { return '<li>' + esc(fmtDate(r.workDate)) + ' ' + esc(r.shift) + ' · ' + esc(r.submittedAt.slice(11, 16)) + (r.late ? ' (지연)' : '') + '</li>'; }).join('') +
        '</ul></div>' : '';
      view('<div class="home-grid">' + main + recent +
        '<a class="home-btn" href="#/notices"><span class="ico">📢</span><span>공지사항<small>안전수칙·전달사항</small></span>' +
        (res.unreadNotices ? '<span class="count">' + res.unreadNotices + '</span>' : '') + '</a>' +
        '<a class="home-btn" href="#/report"><span class="ico">⚠️</span><span>위험·아차사고 보고<small>사진과 함께 바로 알리기</small></span></a>' +
        '<a class="home-btn" href="#/records"><span class="ico">🗂️</span><span>내 TBM 기록<small>최근 30일</small></span></a>' +
        '<a class="home-btn" href="#/reports"><span class="ico">📋</span><span>내 보고 처리 현황<small>보고한 내용과 조치 결과</small></span></a>' +
        '</div><p style="text-align:center;margin-top:22px"><a href="#" id="switch" class="muted">다른 사번으로 바꾸기</a></p>');
      $('#switch').onclick = function (e) { e.preventDefault(); if (confirm('이 휴대폰에 저장된 사번을 지울까요?')) { setEmpNo(''); state.user = null; go('/login'); } };
    });
  }

  // 운영 시작일 전: 사번은 그대로 두고 안내만 보여 준다
  function notOpen(res) { return /부터 사용할 수 있습니다/.test(res.error || ''); }
  function screenNotOpen(msg) {
    view('<div class="card" style="text-align:center"><div style="font-size:54px;line-height:1">⏳</div><h1 style="margin-top:12px">아직 시작 전입니다</h1>' +
      '<p style="font-size:20px;margin:8px 0"><b>' + esc(msg) + '</b></p>' +
      '<p class="hint">바탕화면 아이콘은 지금 미리 만들어 두셔도 됩니다.<br>시작하는 날 아이콘을 누르면 바로 들어갈 수 있습니다.</p></div>' +
      '<button class="btn ghost" id="again">다른 사번으로 바꾸기</button>');
    $('#again').onclick = function () { setEmpNo(''); screenLogin(); };
  }

  function handleAuthError(res) {
    if (notOpen(res)) return screenNotOpen(res.error);
    if (/등록되지 않은|중지된|비어 있/.test(res.error || '')) { toast(res.error); setEmpNo(''); return go('/login'); }
    if (/동의가 필요/.test(res.error || '')) return go('/consent');
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
    api('home').then(function (res) {
      if (!res.ok) return handleAuthError(res);
      state.home = res; state.user = res.user; setWho();
      if (res.weekDone) {
        return view('<div class="card" style="text-align:center"><h1>이번 주 TBM 완료</h1><p>' + esc(res.weekLabel) + ' TBM은<br>' +
          esc(fmtDate(res.weekDone.workDate)) + ' ' + esc(res.weekDone.shift) + '에 이미 제출했습니다.</p>' +
          '<p class="hint">TBM은 주 1회입니다. 다음 주 월요일부터 다시 참여할 수 있습니다.</p></div>' +
          '<a class="btn" href="#/record/' + esc(res.weekDone.no) + '">제출 내용 보기</a><a class="btn ghost" href="#/home">홈으로</a>');
      }
      var html = '<h1>어느 교대조인가요?</h1><p class="hint" style="margin-top:-4px">이번 주 ' + esc(res.weekLabel) + ' · 지금 ' + esc(res.now.slice(11, 16)) +
        '<br>가장 가까운 교대조를 골라 두었습니다.</p><form id="f">';
      res.options.forEach(function (o) {
        var tag = o.done ? '<span class="tag fin">제출 완료 ' + esc(o.done.submittedAt.slice(11, 16)) + '</span>'
          : o.name === res.recommended ? '<span class="tag rec">추천</span>' : o.late ? '<span class="tag late">마감 지남</span>' : '';
        html += '<label class="opt-card"><input type="radio" name="shift" value="' + esc(o.name) + '"' +
          (o.done ? ' disabled' : o.name === res.recommended ? ' checked' : '') + '><span class="box"><span>' + esc(o.name) +
          '<small>' + esc(fmtDate(o.workDate)) + ' ' + esc(o.start) + ' 시작</small></span>' + tag + '</span></label>';
      });
      html += '<button class="btn">TBM 참여 시작</button></form><a class="btn ghost" href="#/home">홈으로</a>';
      view(html);
      $('#f').onsubmit = function (e) {
        e.preventDefault();
        var pick = $('input[name=shift]:checked');
        if (!pick) return toast('교대조를 골라 주세요.');
        api('begin', { shift: pick.value }).then(function (b) {
          if (!b.ok) return;
          state.flow = { begin: b, step: 0, health: null, answers: b.worker.map(function () { return {}; }),
                         supAnswers: b.supervisor.map(function () { return {}; }), remarks: '', readIds: {} };
          go('/check');
        });
      };
    });
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
        api('notice', { id: st.notice.id, markRead: true }, { silent: true });
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
      state.done = res.submission; state.flow = null;
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
      '</dd><dt>제출</dt><dd>' + esc(String(s.submittedAt).slice(11, 16)) + (s.late ? ' <span class="badge b-warn">지연 제출</span>' : '') +
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
            : r.late ? '<span class="badge b-warn">지연</span>' : '<span class="badge b-ok">완료</span>';
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
  function screenNotices() {
    api('notices').then(function (res) {
      if (!res.ok) return handleAuthError(res);
      view('<h1>공지사항</h1><div class="card" style="padding:4px 18px">' + (res.items.length ? res.items.map(function (n) {
        return '<a class="list-row" href="#/notice/' + esc(n.id) + '"><span>' + (n.mustRead ? '<span class="badge b-bad">필독</span> ' : '') +
          (n.read ? esc(n.title) : '<b>' + esc(n.title) + '</b>') + '<br><span class="muted" style="font-size:14px">' + esc(n.posted) + '</span></span>' +
          (n.read ? '<span class="badge b-gray">확인</span>' : '<span class="badge b-blue">새 글</span>') + '</a>';
      }).join('') : '<p class="muted">공지가 없습니다.</p>') + '</div><a class="btn" href="#/home">홈으로</a>');
    });
  }

  function screenNotice(id) {
    api('notice', { id: id, markRead: true }).then(function (res) {
      if (!res.ok) return go('/notices');
      var n = res.notice;
      view('<div class="card">' + (n.mustRead ? '<span class="badge b-bad">필독</span>' : '') + '<h1 style="margin-top:8px">' + esc(n.title) + '</h1>' +
        '<p class="muted" style="margin-top:-6px;font-size:14px">' + esc(n.posted) + '</p><div class="notice-body">' + richText(n.body) + '</div>' +
        n.images.map(function (fid) { return '<img class="notice-img" data-img="' + esc(fid) + '" alt="공지 이미지">'; }).join('') +
        '</div><a class="btn" href="#/notices">목록으로</a>');
      loadImages(app);
    });
  }

  function loadImages(root) {
    $all('img[data-img]', root).forEach(function (img) {
      api('noticeImage', { fileId: img.getAttribute('data-img') }, { silent: true, keepError: true }).then(function (res) {
        if (res.ok) img.src = 'data:' + res.mime + ';base64,' + res.data; else img.alt = '이미지를 불러오지 못했습니다';
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

  // ---------------- 시작 ----------------
  if (CFG.APP_NAME) { document.title = CFG.APP_NAME; $('#appname').textContent = CFG.APP_NAME; }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  route();
})();
