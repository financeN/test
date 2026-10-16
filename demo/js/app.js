(function () {
  'use strict';

  var STORAGE_KEY = 'teacher-rollcall-demo-v1';
  var ROLL_INTERVAL = 5000;

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    clock: $('clock'),
    addForm: $('addForm'),
    nameInput: $('nameInput'),
    snoInput: $('snoInput'),
    formHint: $('formHint'),
    rollBtn: $('rollBtn'),
    nextBtn: $('nextBtn'),
    clearStudentsBtn: $('clearStudentsBtn'),
    callout: $('callout'),
    studentList: $('studentList'),
    studentEmpty: $('studentEmpty'),
    presentBody: $('presentTable').tBodies[0],
    presentEmpty: $('presentEmpty'),
    absentBody: $('absentTable').tBodies[0],
    absentEmpty: $('absentEmpty'),
    absentCount: $('absentCount'),
    exportBtn: $('exportBtn'),
    clearRecordsBtn: $('clearRecordsBtn'),
    statTotal: $('statTotal'),
    statPresent: $('statPresent'),
    statAbsent: $('statAbsent'),
    statRate: $('statRate'),
    rollStatus: $('rollStatus'),
    toast: $('toast')
  };

  var state = {
    students: [],
    presentRecords: [],
    absentRecords: [],
    rolling: false,
    pointer: -1,
    seq: 0,
    timer: null,
    toastTimer: null
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function nowTime() {
    var d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        students: state.students,
        presentRecords: state.presentRecords,
        absentRecords: state.absentRecords,
        seq: state.seq
      }));
    } catch (err) {
      /* 本地存储不可用时静默降级 */
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (Array.isArray(data.students)) state.students = data.students;
      if (Array.isArray(data.presentRecords)) state.presentRecords = data.presentRecords;
      if (Array.isArray(data.absentRecords)) state.absentRecords = data.absentRecords;
      if (typeof data.seq === 'number') state.seq = data.seq;
      state.rolling = false;
      state.pointer = -1;
    } catch (err) {
      /* 数据损坏时忽略 */
    }
  }

  function toast(message, type) {
    els.toast.textContent = message;
    els.toast.className = 'toast is-show' + (type ? ' is-' + type : '');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      els.toast.className = 'toast';
    }, 2200);
  }

  function setHint(text, isError) {
    els.formHint.textContent = text;
    els.formHint.className = 'hint' + (isError ? ' hint--error' : '');
  }

  function renderStudents() {
    if (!state.students.length) {
      els.studentList.innerHTML = '';
      els.studentEmpty.classList.remove('is-hidden');
      return;
    }
    els.studentEmpty.classList.add('is-hidden');

    els.studentList.innerHTML = state.students.map(function (s, idx) {
      var cls = ['student'];
      var isCurrent = state.rolling && idx === state.pointer;
      if (isCurrent) cls.push('is-current');
      if (s.status === 'present') cls.push('is-present');
      if (s.status === 'absent') cls.push('is-absent');

      var action;
      if (s.status === 'present') {
        action = '<span class="student__time">' + escapeHtml(s.checkinTime) + '</span>';
      } else {
        var dis = state.rolling ? '' : ' disabled title="请先点击「开始点名」"';
        action = '<button class="btn-checkin" data-action="checkin" data-id="' + s.id + '"' + dis + '>签到</button>';
      }

      var liveTag = isCurrent ? '<em class="student__role student__role--live">点名中</em>' : '';

      return '<li class="' + cls.join(' ') + '" data-id="' + s.id + '">' +
        '<div class="student__avatar">' + escapeHtml(s.name.slice(0, 1)) + '</div>' +
        '<div class="student__info">' +
          '<div class="student__name"><span>' + escapeHtml(s.name) + '</span>' +
          '<em class="student__role">' + escapeHtml(s.role) + '</em>' + liveTag + '</div>' +
          '<div class="student__meta">学号 ' + escapeHtml(s.sno) + '</div>' +
        '</div>' +
        '<div class="student__right">' + action +
          '<button class="icon-btn" data-action="remove" data-id="' + s.id + '" title="移除该学生">×</button>' +
        '</div>' +
      '</li>';
    }).join('');
  }

  function renderRecords() {
    var present = state.presentRecords;
    els.presentBody.innerHTML = present.map(function (r) {
      return '<tr><td>' + escapeHtml(r.name) + '</td><td>' + escapeHtml(r.role) + '</td>' +
        '<td>' + escapeHtml(r.sno) + '</td><td class="td-time">' + escapeHtml(r.time) + '</td></tr>';
    }).join('');
    els.presentEmpty.classList.toggle('is-hidden', present.length > 0);

    var absent = state.absentRecords;
    els.absentBody.innerHTML = absent.map(function (r) {
      return '<tr><td>' + escapeHtml(r.name) + '</td><td>' + escapeHtml(r.role) + '</td>' +
        '<td>' + escapeHtml(r.sno) + '</td><td><span class="badge-absent">缺勤</span></td></tr>';
    }).join('');
    els.absentEmpty.classList.toggle('is-hidden', absent.length > 0);
    els.absentCount.textContent = absent.length + ' 人';
  }

  function renderStats() {
    var total = state.students.length;
    var present = state.students.filter(function (s) { return s.status === 'present'; }).length;
    var absent = state.students.filter(function (s) { return s.status === 'absent'; }).length;
    els.statTotal.textContent = total;
    els.statPresent.textContent = present;
    els.statAbsent.textContent = absent;
    els.statRate.textContent = total ? Math.round((present / total) * 100) + '%' : '--';
  }

  function renderControls() {
    els.rollBtn.textContent = state.rolling ? '点名结束' : '开始点名';
    els.rollBtn.classList.toggle('is-rolling', state.rolling);
    els.rollBtn.disabled = state.students.length === 0;
    els.nextBtn.disabled = !state.rolling;

    els.rollStatus.textContent = state.rolling ? '点名中' : '未开始';
    els.rollStatus.className = state.rolling ? 'chip chip--live' : 'chip';
  }

  function updateCallout() {
    if (state.rolling) {
      els.callout.className = 'callout callout--live';
      if (state.pointer >= 0 && state.students[state.pointer]) {
        var s = state.students[state.pointer];
        els.callout.innerHTML = '正在点名：<strong>' + escapeHtml(s.name) + '</strong>（学号 ' +
          escapeHtml(s.sno) + '），请点击「签到」完成打卡。';
      } else {
        els.callout.textContent = '本轮点名已到名单末尾，点击「点名结束」统计缺勤名单。';
      }
    } else {
      els.callout.className = 'callout';
      els.callout.textContent = state.students.length
        ? '等待开始点名…'
        : '请先添加学生，然后点击「开始点名」。';
    }
  }

  function renderAll() {
    renderStudents();
    renderRecords();
    renderStats();
    renderControls();
    updateCallout();
  }

  function scrollToCurrent() {
    var node = els.studentList.querySelector('.is-current');
    if (node && node.scrollIntoView) {
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function clearTimer() {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function startTimer() {
    clearTimer();
    state.timer = setTimeout(function () {
      advance();
    }, ROLL_INTERVAL);
  }

  function advance() {
    if (!state.rolling) return;
    clearTimer();

    var next = -1;
    for (var i = state.pointer + 1; i < state.students.length; i += 1) {
      if (state.students[i].status !== 'present') {
        next = i;
        break;
      }
    }

    state.pointer = next;
    renderStudents();
    renderStats();
    updateCallout();

    if (next === -1) return;

    scrollToCurrent();
    startTimer();
  }

  function addStudent() {
    var name = els.nameInput.value.trim();
    if (!name) {
      setHint('请输入学生姓名后再添加。', true);
      els.nameInput.focus();
      toast('请先输入学生姓名', 'warn');
      return;
    }
    if (state.students.some(function (s) { return s.name === name; })) {
      setHint('名单中已存在「' + name + '」，请勿重复添加。', true);
      toast('该学生已在名单中', 'warn');
      return;
    }

    var sno = els.snoInput.value.trim();
    if (!sno) {
      state.seq += 1;
      sno = String(new Date().getFullYear()) + String(state.seq).padStart(3, '0');
    }

    state.students.push({
      id: uid(),
      name: name,
      sno: sno,
      role: '学生',
      status: 'pending',
      checkinTime: ''
    });

    els.nameInput.value = '';
    els.snoInput.value = '';
    els.nameInput.focus();
    setHint('已添加「' + name + '」，当前共 ' + state.students.length + ' 名学生。', false);

    save();
    renderAll();
    toast('已添加学生「' + name + '」', 'ok');
  }

  function removeStudent(id) {
    var idx = -1;
    for (var i = 0; i < state.students.length; i += 1) {
      if (state.students[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return;

    var removed = state.students.splice(idx, 1)[0];

    if (state.rolling) {
      if (idx === state.pointer) {
        state.pointer = idx - 1;
        save();
        renderAll();
        advance();
        toast('已移除「' + removed.name + '」');
        return;
      }
      if (idx < state.pointer) state.pointer -= 1;
    }

    save();
    renderAll();
    toast('已移除「' + removed.name + '」');
  }

  function checkIn(id) {
    if (!state.rolling) {
      toast('请先点击「开始点名」', 'warn');
      return;
    }

    var student = null;
    for (var i = 0; i < state.students.length; i += 1) {
      if (state.students[i].id === id) { student = state.students[i]; break; }
    }
    if (!student || student.status === 'present') return;

    student.status = 'present';
    student.checkinTime = nowTime();

    state.presentRecords.push({
      id: student.id,
      name: student.name,
      role: student.role,
      sno: student.sno,
      time: student.checkinTime
    });

    save();
    renderAll();
    toast('「' + student.name + '」签到成功', 'ok');

    if (state.students[state.pointer] === student) {
      advance();
    }
  }

  function startRoll() {
    if (!state.students.length) {
      toast('请先添加学生', 'warn');
      return;
    }

    state.rolling = true;
    state.pointer = -1;
    state.students.forEach(function (s) {
      if (s.status === 'absent') s.status = 'pending';
    });

    renderAll();
    advance();
    toast('开始点名', 'ok');
  }

  function endRoll() {
    clearTimer();

    var absentees = state.students.filter(function (s) { return s.status !== 'present'; });
    absentees.forEach(function (s) { s.status = 'absent'; });

    var ids = state.students.map(function (s) { return s.id; });
    state.absentRecords = state.absentRecords.filter(function (r) {
      return ids.indexOf(r.id) === -1;
    });
    absentees.forEach(function (s) {
      state.absentRecords.push({
        id: s.id,
        name: s.name,
        role: s.role,
        sno: s.sno,
        time: ''
      });
    });

    state.rolling = false;
    state.pointer = -1;

    save();
    renderAll();

    if (absentees.length) {
      els.callout.className = 'callout callout--done';
      els.callout.textContent = '点名结束：本次共有 ' + absentees.length + ' 名学生缺勤，已记入缺勤记录。';
      toast('点名结束，' + absentees.length + ' 人缺勤', 'warn');
    } else {
      els.callout.className = 'callout callout--done';
      els.callout.textContent = '点名结束：全员已签到，太棒了！';
      toast('点名结束，全员已签到', 'ok');
    }
  }

  function toggleRoll() {
    if (state.rolling) endRoll();
    else startRoll();
  }

  function clearStudents() {
    if (!state.students.length) {
      toast('当前名单已经是空的');
      return;
    }
    if (!window.confirm('确定清空当前学生名单吗？签到与缺勤记录将保留。')) return;

    clearTimer();
    state.students = [];
    state.rolling = false;
    state.pointer = -1;

    save();
    renderAll();
    setHint('未填写学号时，系统会自动分配一个学号。', false);
    toast('已清空学生名单');
  }

  function clearRecords() {
    if (!state.presentRecords.length && !state.absentRecords.length) {
      toast('暂无可清空的记录');
      return;
    }
    if (!window.confirm('确定清空所有签到与缺勤记录吗？此操作不可撤销。')) return;

    state.presentRecords = [];
    state.absentRecords = [];

    save();
    renderRecords();
    renderStats();
    toast('已清空所有记录');
  }

  function exportCsv() {
    var rows = [['姓名', '角色', '学号', '签到时间', '状态']];
    state.presentRecords.forEach(function (r) {
      rows.push([r.name, r.role, r.sno, r.time, '已签到']);
    });
    state.absentRecords.forEach(function (r) {
      rows.push([r.name, r.role, r.sno, '--', '缺勤']);
    });

    if (rows.length === 1) {
      toast('暂无可导出的记录', 'warn');
      return;
    }

    var csv = '\ufeff' + rows.map(function (row) {
      return row.map(function (cell) {
        return '"' + String(cell).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\r\n');

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = '签到记录_' + today() + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

    toast('已导出 CSV 文件', 'ok');
  }

  function tickClock() {
    var d = new Date();
    els.clock.textContent = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function bindEvents() {
    els.addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      addStudent();
    });

    els.rollBtn.addEventListener('click', toggleRoll);
    els.nextBtn.addEventListener('click', advance);
    els.clearStudentsBtn.addEventListener('click', clearStudents);
    els.clearRecordsBtn.addEventListener('click', clearRecords);
    els.exportBtn.addEventListener('click', exportCsv);

    els.studentList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      if (btn.getAttribute('data-action') === 'checkin') checkIn(id);
      if (btn.getAttribute('data-action') === 'remove') removeStudent(id);
    });

    els.nameInput.addEventListener('input', function () {
      if (els.formHint.classList.contains('hint--error')) {
        setHint('未填写学号时，系统会自动分配一个学号。', false);
      }
    });
  }

  function init() {
    load();
    bindEvents();
    renderAll();
    tickClock();
    setInterval(tickClock, 1000);
  }

  init();
})();