/* ------------------------------------------------------------------
 * Tetris Wiki CN · historical edit heatmap
 * Vanilla JS, no build step. Reads window.TETRISWIKI_DATA / _META and
 * window.TETRISWIKI_PALETTE; never calls the MediaWiki API at load time.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  var D = window.TETRISWIKI_DATA;
  var M = window.TETRISWIKI_META;
  var P = window.TETRISWIKI_PALETTE || {};

  var FLAG = {
    MINOR: 1,
    BOT: 2,
    ANON: 4,
    IMPORTED: 8,
    SYSTEM: 16,
    REVERTED: 32,
    HIDDEN: 64,
    DELETED: 128
  };
  var FLAG_LABELS = [
    [FLAG.MINOR, '小编辑', 'is-minor'],
    [FLAG.BOT, '机器人', 'is-bot'],
    [FLAG.ANON, '匿名', ''],
    [FLAG.IMPORTED, '导入', 'is-imported'],
    [FLAG.SYSTEM, '系统', ''],
    [FLAG.REVERTED, '被回退', ''],
    [FLAG.HIDDEN, '隐藏', ''],
    [FLAG.DELETED, '已删除', 'is-deleted']
  ];

  var DAY_MS = 86400000;
  var CST_SECONDS = 8 * 3600;
  var BIG_DELTA = 500;
  var WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  var NS_OPTIONS = ['0', '2', '4', '6', '8', '10', '14', '828'];
  var NS_LABELS = {
    0: '条目', 1: 'Talk', 2: '用户', 3: '用户讨论', 4: '项目', 5: '项目讨论',
    6: '文件', 7: '文件讨论', 8: 'MediaWiki', 9: 'MediaWiki讨论',
    10: '模板', 11: '模板讨论', 12: '帮助', 13: '帮助讨论', 14: '分类',
    15: '分类讨论', 828: '模块', 829: '模块讨论'
  };

  var state = {
    min: '',
    max: '',
    start: '',
    end: '',
    preset: 'recent',
    editor: null,
    overviewRange: null,
    ns: 'all',
    toggles: {
      bot: false, imported: false, anon: false, system: false,
      minor: true, reverted: true, deleted: true
    }
  };

  var el = {};
  var userByName = new Map();
  var revSize = new Map();
  var firstRevByPage = new Map();
  var humanUsers = [];
  var top15 = [];
  var allTimeTop4 = 0;
  var allTimeTop15 = 0;
  var allTimeHuman = 0;
  var view = null;
  var scrollToEnd = false;
  var lastFocus = null;

  function $(id) { return document.getElementById(id); }

  function init() {
    if (!D || !D.edits || !D.users || !D.pages || !M) {
      showFatal();
      return;
    }
    cacheEls();
    indexData();
    initState();
    buildControls();
    bindEvents();
    renderNotes();
    scrollToEnd = true;
    render();
  }

  function cacheEls() {
    el.generatedAt = $('generated-at');
    el.footerMeta = $('footer-meta');
    el.presets = Array.prototype.slice.call(document.querySelectorAll('.preset'));
    el.dateStart = $('date-start');
    el.dateEnd = $('date-end');
    el.nsSelect = $('ns-select');
    el.reset = $('reset-filters');
    el.chips = $('editor-chips');
    el.editorSelect = $('editor-select');
    el.toggles = $('toggles');
    el.filterNote = $('filter-note');
    el.statTotal = $('stat-total');
    el.statTotalSub = $('stat-total-sub');
    el.statTotalBig = $('stat-total-big');
    el.statActive = $('stat-active');
    el.statActiveSub = $('stat-active-sub');
    el.statActiveLead = $('stat-active-lead');
    el.statAvg = $('stat-avg');
    el.statAvgSub = $('stat-avg-sub');
    el.statTop = $('stat-top');
    el.statTopSub = $('stat-top-sub');
    el.heatmapSub = $('heatmap-sub');
    el.legend = $('legend');
    el.legendTitle = $('legend-title');
    el.legendHint = $('legend-hint');
    el.infoTip = $('info-tip');
    el.scroll = $('heatmap-scroll');
    el.months = $('heatmap-months');
    el.weeks = $('heatmap-weeks');
    el.tooltip = $('tooltip');
    el.foot = $('heatmap-foot');
    el.paletteSub = $('palette-sub');
    el.paletteList = $('palette-list');
    el.paletteOther = $('palette-other');
    el.notes = $('notes-content');
    el.dialog = $('day-dialog');
    el.dayTitle = $('day-title');
    el.daySub = $('day-sub');
    el.dayToolbar = $('day-toolbar');
    el.daySummary = $('day-summary');
    el.dayList = $('day-list');
    el.dayClose = $('day-close');
  }

  function indexData() {
    D.users.forEach(function (u) {
      userByName.set(u[0], u);
      if ((u[3] & (FLAG.BOT | FLAG.ANON | FLAG.SYSTEM | FLAG.IMPORTED)) === 0) {
        humanUsers.push(u);
      }
    });
    humanUsers.sort(function (a, b) { return b[4] - a[4]; });

    for (var i = 0; i < D.edits.length; i++) {
      var e = D.edits[i];
      revSize.set(e[0], e[5]);
      var first = firstRevByPage.get(e[3]);
      if (!first || e[2] < first[2] || (e[2] === first[2] && e[0] < first[0])) {
        firstRevByPage.set(e[3], e);
      }
    }

    allTimeHuman = (M.counts && M.counts.human) || humanUsers.reduce(function (s, u) { return s + u[4]; }, 0);
    top15 = (P.top15 && P.top15.length ? P.top15 : humanUsers.slice(0, 15).map(function (u) { return u[0]; })).slice();
    allTimeTop4 = top15.slice(0, 4).reduce(function (s, n) {
      var u = userByName.get(n); return s + (u ? u[4] : 0);
    }, 0);
    allTimeTop15 = top15.reduce(function (s, n) {
      var u = userByName.get(n); return s + (u ? u[4] : 0);
    }, 0);
  }

  function initState() {
    state.min = (M.timeline && M.timeline.created && M.timeline.created.local)
      ? M.timeline.created.local.slice(0, 10) : '2020-07-17';
    // 静态快照不跟随浏览器日期漂移：默认上界取数据生成日，缺失时退回最后编辑日。
    var snapshot = '';
    if (M.generatedAt) {
      var generatedTs = Math.floor(Date.parse(M.generatedAt) / 1000);
      if (!isNaN(generatedTs)) snapshot = dayOf(generatedTs);
    }
    if (!snapshot && M.timeline && M.timeline.last && M.timeline.last.local) {
      snapshot = M.timeline.last.local.slice(0, 10);
    }
    state.max = snapshot || todayCST();
    var def = M.defaultFilters || {};
    state.toggles = {
      bot: !def.excludeBots,
      imported: !def.excludeImports,
      anon: !def.excludeAnon,
      system: !def.excludeSystem,
      minor: def.includeMinor !== false,
      reverted: def.includeReverted !== false,
      deleted: def.includeDeleted !== false
    };
    state.ns = def.namespace || 'all';
    applyPreset('recent', true);
  }

  /* ----------------------------- date utils ----------------------------- */
  function dayOf(ts) {
    return new Date((ts + CST_SECONDS) * 1000).toISOString().slice(0, 10);
  }
  function timeOf(ts) {
    return new Date((ts + CST_SECONDS) * 1000).toISOString().slice(11, 19);
  }
  function todayCST() {
    return dayOf(Math.floor(Date.now() / 1000));
  }
  function addDays(day, n) {
    return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
  }
  function weekdayOf(day) {
    return new Date(day + 'T00:00:00Z').getUTCDay();
  }
  function startOfWeek(day) {
    return addDays(day, -weekdayOf(day));
  }
  function formatDay(day) {
    return day + '（周' + WEEKDAYS[weekdayOf(day)] + '）';
  }
  function formatInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(part, whole) {
    if (!whole) return '0%';
    return (part / whole * 100).toFixed(1) + '%';
  }
  function formatSigned(n) {
    if (!n) return '0';
    return n > 0 ? '+' + formatInt(n) : '−' + formatInt(-n);
  }
  function compareNames(a, b) {
    return a < b ? -1 : (a > b ? 1 : 0);
  }

  /* ----------------------------- revision delta ----------------------------- */
  function deltaOf(e) {
    var parent = e[4];
    var size = e[5];
    if (parent && revSize.has(parent)) return size - revSize.get(parent);
    if (!parent && !(e[6] & FLAG.DELETED)) {
      var first = firstRevByPage.get(e[3]);
      if (first && first[0] === e[0]) return size;
    }
    return null;
  }

  /* ----------------------------- escaping ----------------------------- */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  /* ----------------------------- colours ----------------------------- */
  function validHex(color) {
    return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
  }
  function colorFor(name) {
    var c = P.editors && P.editors[name];
    return validHex(c) ? c : (validHex(P.other) ? P.other : '#6e7681');
  }
  function rgba(hex, alpha) {
    var h = validHex(hex) ? hex : '#6e7681';
    var r = parseInt(h.slice(1, 3), 16);
    var g = parseInt(h.slice(3, 5), 16);
    var b = parseInt(h.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }
  function levelAlpha(level, overview) {
    var arr = overview ? P.overviewAlpha : P.levelAlpha;
    var fallback = overview
      ? [0, 0.18, 0.34, 0.54, 0.54]
      : [0, 0.2, 0.44, 0.7, 0.7];
    if (!Array.isArray(arr) || arr.length < 5) return fallback[level] || 0;
    return arr[level] || 0;
  }
  function levelColor(color, level, overview) {
    if (!level) return '';
    return rgba(color, levelAlpha(level, overview));
  }
  function levelLabel(level, overview) {
    if (overview) {
      return ['无编辑', '', '', '主编辑（计数最高）', '双料领先（计数 + 字节）'][level] || '';
    }
    return [
      '无编辑',
      '有编辑',
      '高于个人日均或 ≥500 B 大修订',
      '计数或字节当日领先',
      '双料领先（计数 + 字节）'
    ][level] || '';
  }
  function levelBadge(level, overview) {
    var label = levelLabel(level, overview);
    return '<span class="level-badge is-level-' + level + '">强度 ' + level
      + (label ? ' · ' + escapeHtml(label) : '') + '</span>';
  }
  function legendDescription(level, overview) {
    var label = levelLabel(level, overview);
    if (overview && (level === 1 || level === 2 || level === 4)) {
      label = levelLabel(level, false) + '（仅个人视图）';
    }
    return '强度 ' + level + (label ? ' · ' + label : '');
  }

  /* ----------------------------- URLs ----------------------------- */
  function pageUrl(title) {
    return M.site + '/p/' + encodeURIComponent(String(title).replace(/ /g, '_'));
  }
  function diffUrl(title, revid, parentid) {
    var url = M.site + '/index.php?title=' + encodeURIComponent(title) + '&diff=' + encodeURIComponent(revid);
    if (parentid) url += '&oldid=' + encodeURIComponent(parentid);
    return url;
  }
  function contribUrl(name) {
    return M.site + '/index.php?title=Special:Contributions/' + encodeURIComponent(name);
  }
  function userUrl(name) {
    return M.site + '/index.php?title=User:' + encodeURIComponent(name);
  }
  function nsLabel(ns) {
    return NS_LABELS[ns] || ('NS ' + ns);
  }

  /* ----------------------------- controls ----------------------------- */
  function presetRange(name) {
    var start, end = state.max;
    if (name === 'all') {
      start = state.min;
    } else if (name === 'farm') {
      start = state.min;
      end = M.timeline.migrated.local.slice(0, 10);
    } else if (name === 'indep') {
      start = M.timeline.migrated.local.slice(0, 10);
      end = state.max;
    } else if (name === 'recent') {
      start = addDays(end, -364);
    } else {
      return null;
    }
    return { start: start, end: end };
  }

  function editorRange(name) {
    var user = name ? userByName.get(name) : null;
    if (!user) return null;
    var first = user[5] ? dayOf(user[5]) : '';
    var last = user[6] ? dayOf(user[6]) : '';
    var registered = '';
    if (user[7]) {
      var regTs = Math.floor(Date.parse(user[7]) / 1000);
      if (!isNaN(regTs)) registered = dayOf(regTs);
    }
    // 2024 年迁移重建了账号，旧站编辑者的注册日常被重置为迁移时间。
    // 取注册日与首次编辑日中较早者，既保留旧站历史，也不截掉新账号注册后的空白期。
    var start = first || registered || state.min;
    var usedRegistered = false;
    if (registered && (!first || registered <= first)) {
      start = registered;
      usedRegistered = true;
    }
    var end = last || state.max;
    if (start > end && first && last && first <= last) {
      // 异常数据兜底：起点晚于末次编辑时，退回实际编辑区间。
      start = first;
      end = last;
      usedRegistered = false;
    }
    if (start < state.min) start = state.min;
    if (start > state.max) start = state.max;
    if (end < state.min) end = state.min;
    if (end > state.max) end = state.max;
    if (start > end) {
      var tmp = start;
      start = end;
      end = tmp;
    }
    return {
      start: start,
      end: end,
      registered: usedRegistered,
      first: first,
      last: last
    };
  }

  function clampToEditorRange(start, end) {
    var bounds = state.editor ? editorRange(state.editor) : null;
    if (!bounds) return { start: start, end: end };
    if (start < bounds.start) start = bounds.start;
    if (end > bounds.end) end = bounds.end;
    if (start > end) {
      start = bounds.start;
      end = bounds.end;
    }
    return { start: start, end: end };
  }

  function updateDateBounds() {
    if (!el.dateStart) return;
    var bounds = state.editor ? editorRange(state.editor) : null;
    var min = bounds ? bounds.start : state.min;
    var max = bounds ? bounds.end : state.max;
    el.dateStart.min = min;
    el.dateStart.max = max;
    el.dateEnd.min = min;
    el.dateEnd.max = max;
  }

  function applyPreset(name, silent) {
    var range = presetRange(name);
    if (!range) return;
    range = clampToEditorRange(range.start, range.end);
    state.start = range.start;
    state.end = range.end;
    state.preset = name;
    updateDateBounds();
    if (el.dateStart) {
      el.dateStart.value = range.start;
      el.dateEnd.value = range.end;
    }
    updatePresetButtons();
    if (!silent) {
      scrollToEnd = true;
      render();
    }
  }

  function updatePresetButtons() {
    el.presets.forEach(function (btn) {
      var active = btn.getAttribute('data-preset') === state.preset;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function applyCustomRange() {
    var start = el.dateStart.value;
    var end = el.dateEnd.value;
    if (!start || !end) return;
    if (start > end) {
      var tmp = start; start = end; end = tmp;
    }
    var range = clampToEditorRange(start, end);
    start = range.start;
    end = range.end;
    el.dateStart.value = start;
    el.dateEnd.value = end;
    state.start = start;
    state.end = end;
    state.preset = 'custom';
    updateDateBounds();
    updatePresetButtons();
    scrollToEnd = true;
    render();
  }

  function buildControls() {
    updateDateBounds();
    el.dateStart.value = state.start;
    el.dateEnd.value = state.end;
    el.nsSelect.value = state.ns;

    Array.prototype.forEach.call(el.toggles.querySelectorAll('input[data-flag]'), function (input) {
      input.checked = !!state.toggles[input.getAttribute('data-flag')];
    });

    renderChips();
    renderEditorSelect();
    updatePresetButtons();
    renderFilterNote();

    el.generatedAt.textContent = '数据生成于 ' + formatGenerated(M.generatedAt) + ' · Asia/Shanghai';
    el.footerMeta.textContent = '可访问修订 ' + formatInt(M.counts.total)
      + '（当前 + 已删除）· 人工编辑 ' + formatInt(M.counts.human)
      + ' · 已删除 ' + formatInt(M.counts.deleted) + ' · 口径见「数据说明」。';
  }

  function formatGenerated(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Date(d.getTime() + CST_SECONDS * 1000).toISOString().slice(0, 16).replace('T', ' ');
  }

  function renderChips() {
    var allCount = allTimeHuman;
    var items = [{ name: null, label: '全部编辑者', count: allCount }];
    top15.forEach(function (name) {
      var u = userByName.get(name);
      items.push({ name: name, label: name, count: u ? u[4] : 0 });
    });
    el.chips.innerHTML = items.map(function (item) {
      var color = item.name ? colorFor(item.name) : '#58a6ff';
      var active = state.editor === item.name;
      return '<button type="button" class="chip' + (active ? ' is-active' : '') + '"'
        + ' data-editor="' + escapeAttr(item.name || '') + '"'
        + ' style="--chip-color:' + escapeAttr(color) + '"'
        + ' aria-pressed="' + (active ? 'true' : 'false') + '">'
        + '<span class="chip-dot"></span>'
        + '<span>' + escapeHtml(item.label) + '</span>'
        + '<span class="chip-count">' + formatInt(item.count) + '</span>'
        + '</button>';
    }).join('');
  }

  function renderEditorSelect() {
    var options = ['<option value="">全部活跃编辑</option>'];
    humanUsers.forEach(function (u) {
      options.push('<option value="' + escapeAttr(u[0]) + '">'
        + escapeHtml(u[0]) + ' · ' + formatInt(u[4]) + '</option>');
    });
    el.editorSelect.innerHTML = options.join('');
    el.editorSelect.value = state.editor || '';
  }

  function setEditor(name) {
    var next = name || null;
    if (next === state.editor) {
      el.editorSelect.value = next || '';
      renderChips();
      return;
    }
    if (next && !state.editor) {
      state.overviewRange = {
        start: state.start,
        end: state.end,
        preset: state.preset
      };
    }
    state.editor = next;
    el.editorSelect.value = state.editor || '';
    if (state.editor) {
      var bounds = editorRange(state.editor);
      if (bounds) {
        state.start = bounds.start;
        state.end = bounds.end;
        state.preset = 'custom';
        el.dateStart.value = bounds.start;
        el.dateEnd.value = bounds.end;
      }
    } else if (state.overviewRange) {
      state.start = state.overviewRange.start;
      state.end = state.overviewRange.end;
      state.preset = state.overviewRange.preset;
      state.overviewRange = null;
      el.dateStart.value = state.start;
      el.dateEnd.value = state.end;
    }
    updateDateBounds();
    updatePresetButtons();
    renderChips();
    render();
  }

  function renderFilterNote() {
    var def = M.defaultFilters || {};
    var isDefault = state.editor === null
      && state.ns === (def.namespace || 'all')
      && state.toggles.bot === !def.excludeBots
      && state.toggles.imported === !def.excludeImports
      && state.toggles.anon === !def.excludeAnon
      && state.toggles.system === !def.excludeSystem
      && state.toggles.minor === (def.includeMinor !== false)
      && state.toggles.reverted === (def.includeReverted !== false)
      && state.toggles.deleted === (def.includeDeleted !== false);
    el.filterNote.textContent = isDefault
      ? '默认：仅注册用户人工编辑'
      : '自定义筛选（可含机器人 / 导入 / 匿名 / 系统编辑）';
  }

  /* ----------------------------- events ----------------------------- */
  function bindEvents() {
    el.presets.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-preset');
        if (name === 'custom') {
          state.preset = 'custom';
          updatePresetButtons();
          el.dateStart.focus();
        } else {
          applyPreset(name);
        }
      });
    });

    el.dateStart.addEventListener('change', applyCustomRange);
    el.dateEnd.addEventListener('change', applyCustomRange);

    el.nsSelect.addEventListener('change', function () {
      state.ns = el.nsSelect.value;
      renderFilterNote();
      render();
    });

    el.toggles.addEventListener('change', function (event) {
      var input = event.target.closest('input[data-flag]');
      if (!input) return;
      state.toggles[input.getAttribute('data-flag')] = input.checked;
      renderFilterNote();
      render();
    });

    el.chips.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-editor]');
      if (!btn) return;
      setEditor(btn.getAttribute('data-editor') || null);
    });

    el.editorSelect.addEventListener('change', function () {
      setEditor(el.editorSelect.value || null);
    });

    el.reset.addEventListener('click', resetFilters);

    el.paletteList.addEventListener('click', function (event) {
      var item = event.target.closest('[data-editor]');
      if (item) setEditor(item.getAttribute('data-editor') || null);
    });

    el.legend.addEventListener('mouseover', function (event) {
      var item = event.target.closest('.legend-item');
      if (item) setLegendHint(item);
    });
    el.legend.addEventListener('mouseout', function (event) {
      var item = event.target.closest('.legend-item');
      if (!item) return;
      if (event.relatedTarget && item.contains(event.relatedTarget)) return;
      setLegendHint(null);
    });
    el.legend.addEventListener('focusin', function (event) {
      var item = event.target.closest('.legend-item');
      if (item) setLegendHint(item);
    });
    el.legend.addEventListener('focusout', function (event) {
      var item = event.target.closest('.legend-item');
      if (!item) return;
      if (event.relatedTarget && item.contains(event.relatedTarget)) return;
      setLegendHint(null);
    });

    document.addEventListener('mouseover', function (event) {
      var target = event.target.closest('[data-tip]');
      if (target) showInfoTip(target);
    });
    document.addEventListener('mouseout', function (event) {
      var target = event.target.closest('[data-tip]');
      if (!target) return;
      if (event.relatedTarget && target.contains(event.relatedTarget)) return;
      hideInfoTip();
    });
    document.addEventListener('focusin', function (event) {
      var target = event.target.closest('[data-tip]');
      if (target) showInfoTip(target);
    });
    document.addEventListener('focusout', function (event) {
      var target = event.target.closest('[data-tip]');
      if (!target) return;
      if (event.relatedTarget && target.contains(event.relatedTarget)) return;
      hideInfoTip();
    });

    el.weeks.addEventListener('click', function (event) {
      var cell = event.target.closest('.cell[data-day]');
      if (cell) openDay(cell.getAttribute('data-day'));
    });

    el.weeks.addEventListener('mouseover', function (event) {
      var cell = event.target.closest('.cell[data-day]');
      if (cell) showTooltip(cell);
    });
    el.weeks.addEventListener('mouseout', function (event) {
      var cell = event.target.closest('.cell[data-day]');
      if (cell && !cell.contains(event.relatedTarget)) hideTooltip();
    });
    el.weeks.addEventListener('focusin', function (event) {
      var cell = event.target.closest('.cell[data-day]');
      if (cell) showTooltip(cell);
    });
    el.weeks.addEventListener('focusout', function (event) {
      var cell = event.target.closest('.cell[data-day]');
      if (cell) hideTooltip();
    });
    el.weeks.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var cell = event.target.closest('.cell[data-day]');
      if (cell) {
        event.preventDefault();
        openDay(cell.getAttribute('data-day'));
      }
    });

    el.scroll.addEventListener('scroll', hideTooltip, { passive: true });
    window.addEventListener('scroll', hideInfoTip, { passive: true });
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('resize', hideInfoTip);

    el.dayClose.addEventListener('click', function () { el.dialog.close(); });
    el.dialog.addEventListener('close', function () {
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      lastFocus = null;
    });
    el.dialog.addEventListener('click', function (event) {
      if (event.target === el.dialog) el.dialog.close();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && el.tooltip.classList.contains('is-visible')) {
        hideTooltip();
      }
    });
  }

  function applyDefaults() {
    var def = M.defaultFilters || {};
    state.editor = null;
    state.overviewRange = null;
    state.ns = def.namespace || 'all';
    state.toggles = {
      bot: !def.excludeBots,
      imported: !def.excludeImports,
      anon: !def.excludeAnon,
      system: !def.excludeSystem,
      minor: def.includeMinor !== false,
      reverted: def.includeReverted !== false,
      deleted: def.includeDeleted !== false
    };
  }

  function resetFilters() {
    applyDefaults();
    el.nsSelect.value = state.ns;
    el.editorSelect.value = '';
    Array.prototype.forEach.call(el.toggles.querySelectorAll('input[data-flag]'), function (input) {
      input.checked = !!state.toggles[input.getAttribute('data-flag')];
    });
    renderChips();
    renderFilterNote();
    applyPreset('recent');
  }

  /* ----------------------------- filtering ----------------------------- */
  function passesCore(e) {
    var f = e[6];
    if (!state.toggles.bot && (f & FLAG.BOT)) return false;
    if (!state.toggles.imported && (f & FLAG.IMPORTED)) return false;
    if (!state.toggles.anon && (f & FLAG.ANON)) return false;
    if (!state.toggles.system && (f & FLAG.SYSTEM)) return false;
    if (!state.toggles.minor && (f & FLAG.MINOR)) return false;
    if (!state.toggles.reverted && (f & FLAG.REVERTED)) return false;
    if (!state.toggles.deleted && (f & FLAG.DELETED)) return false;

    var ns = String(D.pages[e[3]][1]);
    if (state.ns === 'other') {
      if (NS_OPTIONS.indexOf(ns) !== -1) return false;
    } else if (state.ns !== 'all' && ns !== state.ns) {
      return false;
    }
    return true;
  }

  function levelForDay(user, rec, avg) {
    if (!user || !user.count) return 0;
    var topC = user.count === rec.topCount;
    var topB = rec.topBytes > 0 && user.bytes === rec.topBytes;
    if (topC && topB) return 4;
    if (topC || topB) return 3;
    if (user.big > 0 || user.count > avg) return 2;
    return 1;
  }

  function computeView() {
    var station = new Map();
    var stationUsers = new Map();
    var stationTotal = 0;
    var edits = D.edits;

    for (var i = 0; i < edits.length; i++) {
      var e = edits[i];
      if (!passesCore(e)) continue;
      var day = dayOf(e[2]);
      if (day < state.start || day > state.end) continue;

      var user = D.users[e[1]][0];
      var delta = deltaOf(e);
      var abs = delta === null ? 0 : Math.abs(delta);
      var rec = station.get(day);
      if (!rec) {
        rec = {
          day: day,
          count: 0,
          byUser: new Map(),
          totalBytes: 0,
          totalNet: 0,
          known: 0,
          bigCount: 0,
          maxDelta: 0,
          topCount: 0,
          topBytes: 0,
          topCountUsers: [],
          topBytesUsers: [],
          mainEditor: '',
          main: null,
          level: 0,
          color: ''
        };
        station.set(day, rec);
      }
      rec.count++;

      var mine = rec.byUser.get(user);
      if (!mine) {
        mine = { name: user, count: 0, bytes: 0, net: 0, big: 0, maxAbs: 0, known: 0 };
        rec.byUser.set(user, mine);
      }
      mine.count++;
      if (delta !== null) {
        mine.bytes += abs;
        mine.net += delta;
        mine.known++;
        if (abs >= BIG_DELTA) mine.big++;
        if (abs > mine.maxAbs) mine.maxAbs = abs;
        rec.totalBytes += abs;
        rec.totalNet += delta;
        rec.known++;
        if (abs >= BIG_DELTA) rec.bigCount++;
        if (abs > rec.maxDelta) rec.maxDelta = abs;
      }

      var su = stationUsers.get(user);
      if (!su) {
        su = { name: user, count: 0, days: new Set(), bytes: 0, net: 0, big: 0 };
        stationUsers.set(user, su);
      }
      su.count++;
      su.days.add(day);
      if (delta !== null) {
        su.bytes += abs;
        su.net += delta;
        if (abs >= BIG_DELTA) su.big++;
      }
      stationTotal++;
    }

    station.forEach(function (rec) {
      var users = Array.from(rec.byUser.values());
      var maxCount = 0;
      var maxBytes = 0;
      users.forEach(function (user) {
        if (user.count > maxCount) maxCount = user.count;
        if (user.bytes > maxBytes) maxBytes = user.bytes;
      });
      rec.topCount = maxCount;
      rec.topBytes = maxBytes;
      rec.topCountUsers = users.filter(function (user) { return user.count === maxCount; });
      rec.topBytesUsers = maxBytes > 0 ? users.filter(function (user) {
        return user.bytes === maxBytes;
      }) : [];
      rec.byUserList = users.slice().sort(function (a, b) {
        return b.count - a.count || b.bytes - a.bytes || compareNames(a.name, b.name);
      });
      rec.main = rec.topCountUsers.slice().sort(function (a, b) {
        return b.bytes - a.bytes || compareNames(a.name, b.name);
      })[0] || null;
      rec.mainEditor = rec.main ? rec.main.name : '';
      rec.top = rec.mainEditor;
    });

    var viewDays = new Map();
    var viewTotal = 0;
    if (state.editor) {
      station.forEach(function (rec, day) {
        var mine = rec.byUser.get(state.editor);
        var c = mine ? mine.count : 0;
        if (c > 0) {
          viewDays.set(day, c);
          viewTotal += c;
        }
      });
    } else {
      station.forEach(function (rec, day) {
        viewDays.set(day, rec.count);
        viewTotal += rec.count;
      });
    }
    var viewActive = viewDays.size;
    var avg = viewActive ? viewTotal / viewActive : 0;

    var ranked = Array.from(stationUsers.values()).sort(function (a, b) {
      return b.count - a.count || b.bytes - a.bytes || compareNames(a.name, b.name);
    });
    var topName = ranked.length ? ranked[0].name : '';
    var topCount = ranked.length ? ranked[0].count : 0;
    var topDays = ranked.length ? ranked[0].days.size : 0;
    var stationTop4 = ranked.slice(0, 4).reduce(function (s, u) { return s + u.count; }, 0);
    var stationTop15 = ranked.slice(0, 15).reduce(function (s, u) { return s + u.count; }, 0);

    var sel = state.editor ? stationUsers.get(state.editor) : null;
    var selRank = 0;
    if (sel) {
      for (var r = 0; r < ranked.length; r++) {
        if (ranked[r].name === state.editor) { selRank = r + 1; break; }
      }
    }

    var leadSingle = 0;
    var leadDouble = 0;
    station.forEach(function (rec) {
      var level;
      if (state.editor) {
        var mine = rec.byUser.get(state.editor);
        rec.viewCount = mine ? mine.count : 0;
        rec.viewBytes = mine ? mine.bytes : 0;
        rec.viewNet = mine ? mine.net : 0;
        level = levelForDay(mine, rec, avg);
        rec.color = colorFor(state.editor);
      } else {
        rec.viewCount = rec.count;
        rec.viewBytes = rec.totalBytes;
        rec.viewNet = rec.totalNet;
        level = levelForDay(rec.main, rec, avg);
        rec.color = colorFor(rec.mainEditor);
      }
      rec.leadLevel = level;
      if (level === 3) leadSingle++;
      if (level === 4) leadDouble++;
      // 总览只保留 0 / 3 两档；4 档及金边仅在个人视图呈现。
      rec.level = !state.editor && level === 4 ? 3 : level;
    });

    var rangeDays = Math.round((Date.parse(state.end) - Date.parse(state.start)) / DAY_MS) + 1;
    return {
      station: station,
      stationUsers: stationUsers,
      viewDays: viewDays,
      viewTotal: viewTotal,
      viewActive: viewActive,
      avg: avg,
      stationTotal: stationTotal,
      stationActive: station.size,
      rangeDays: rangeDays,
      leadSingle: leadSingle,
      leadDouble: leadDouble,
      ranked: ranked,
      topName: topName,
      topCount: topCount,
      topDays: topDays,
      stationTop4: stationTop4,
      stationTop15: stationTop15,
      selected: sel,
      selRank: selRank
    };
  }

  /* ----------------------------- bars ----------------------------- */
  function barWidth(value, max) {
    if (!max || !value) return 0;
    return Math.max(0, Math.min(100, value / max * 100));
  }
  function countBar(value, max, color, label) {
    var width = barWidth(value, max).toFixed(2);
    return '<span class="bar-track" role="img" aria-label="' + escapeAttr(label || '') + '">'
      + '<span class="bar-fill" style="width:' + width + '%;background:'
      + escapeAttr(color) + '"></span></span>';
  }
  function deltaBar(value, maxAbs, label) {
    var width = maxAbs ? Math.min(50, Math.abs(value || 0) / maxAbs * 50) : 0;
    var cls = value < 0 ? 'is-minus' : 'is-plus';
    return '<span class="delta-track" role="img" aria-label="' + escapeAttr(label || '') + '">'
      + (width ? '<span class="delta-fill ' + cls + '" style="width:' + width.toFixed(2)
        + '%"></span>' : '')
      + '</span>';
  }
  function leaderList(rec, limit) {
    if (!rec || !rec.byUserList) return [];
    return rec.byUserList.slice(0, limit || 3);
  }

  /* ----------------------------- rendering ----------------------------- */
  function render() {
    view = computeView();
    renderStats();
    renderHeatmap();
    renderLegend();
    renderPalette();
    hideTooltip();
  }

  function viewBigCount() {
    var total = 0;
    view.station.forEach(function (rec) {
      if (state.editor) {
        var mine = rec.byUser.get(state.editor);
        if (mine) total += mine.big;
      } else {
        total += rec.bigCount;
      }
    });
    return total;
  }

  function renderStats() {
    var v = view;
    el.statTotal.textContent = formatInt(v.viewTotal);
    el.statTotalSub.textContent = state.editor
      ? '占本期 ' + pct(v.viewTotal, v.stationTotal) + ' · 全站人工 ' + formatInt(M.counts.human)
      : '占全站人工编辑 ' + pct(v.viewTotal, M.counts.human);
    el.statTotalBig.innerHTML = '≥' + BIG_DELTA + ' B 大修订 <b>'
      + formatInt(viewBigCount()) + '</b> 次';

    el.statActive.textContent = formatInt(v.viewActive);
    el.statActiveSub.textContent = formatInt(v.rangeDays) + ' 天 · '
      + pct(v.viewActive, v.rangeDays) + ' 有编辑';
    el.statActiveLead.innerHTML = '<span class="stat-lead-item">单领先 <b>'
      + formatInt(v.leadSingle) + '</b> 天</span>'
      + '<span class="stat-lead-sep">·</span>'
      + '<span class="stat-lead-item">双领先 <b>'
      + formatInt(v.leadDouble) + '</b> 天</span>';

    el.statAvg.textContent = v.avg.toFixed(1);
    el.statAvgSub.textContent = state.editor
      ? '个人活跃日均（仅计有编辑的日）'
      : '全站活跃日均（仅计有编辑的日）';

    if (state.editor && v.selected) {
      el.statTop.textContent = state.editor;
      el.statTopSub.textContent = formatInt(v.selected.count) + ' 次 · 本期排名 #' + v.selRank;
    } else if (v.topName) {
      el.statTop.textContent = v.topName;
      el.statTopSub.textContent = formatInt(v.topCount) + ' 次 · 活跃 ' + v.topDays + ' 天';
    } else {
      el.statTop.textContent = '—';
      el.statTopSub.textContent = '当前筛选下无编辑';
    }
  }

  /* ----------------------------- heatmap ----------------------------- */
  var CELL_SIZE = 11;
  var GAP_SIZE = 3;
  var WEEKDAY_GAP = 7;

  function renderHeatmap() {
    var firstWeek = startOfWeek(state.start);
    var lastDay = state.end;
    var lastWeek = addDays(lastDay, 6 - weekdayOf(lastDay));
    var weeks = Math.round((Date.parse(lastWeek) - Date.parse(firstWeek)) / DAY_MS / 7) + 1;
    var overview = !state.editor;
    var today = todayCST();

    var html = [];
    var grid = [];
    for (var w = 0; w < weeks; w++) {
      var weekStart = addDays(firstWeek, w * 7);
      var cells = [];
      var col = [];
      for (var d = 0; d < 7; d++) {
        var day = addDays(weekStart, d);
        if (day < state.start || day > state.end) {
          cells.push('<span class="cell is-out" aria-hidden="true"></span>');
          col.push(null);
          continue;
        }
        var rec = view.station.get(day);
        var count = rec ? rec.viewCount : 0;
        var level = rec ? rec.level : 0;
        var color = rec ? rec.color : colorFor(null);
        var style = level ? 'background:' + levelColor(color, level, overview) + ';' : '';
        var cls = 'cell'
          + (count ? '' : ' is-empty')
          + (day === today ? ' is-today' : '');
        var aria = formatDay(day) + '：' + (count
          ? count + ' 次编辑' + (state.editor ? '（' + state.editor + '）' : '')
            + '，强度 ' + level + '，' + levelLabel(level, overview)
          : '无编辑');
        cells.push('<button type="button" class="' + cls + '" data-day="' + day + '"'
          + ' data-level="' + level + '"'
          + ' style="' + style + '" aria-label="' + escapeAttr(aria) + '"></button>');

        var leaderName = count && level === 4
          ? (state.editor || (rec ? rec.mainEditor : ''))
          : '';
        col.push(leaderName || null);
      }
      grid.push(col);
      html.push('<div class="week">' + cells.join('') + '</div>');
    }

    var outline = buildLeaderOutline(grid, weeks);
    if (outline) html.push(outline);
    el.weeks.innerHTML = html.join('');

    renderMonthLabels(firstWeek, weeks);

    var bounds = state.editor ? editorRange(state.editor) : null;
    el.heatmapSub.textContent = state.editor
      ? (state.start + ' 至 ' + state.end + ' · 仅显示 ' + state.editor
        + ' 的编辑；强度 1–4 按当日全站排名与个人活跃日均计算；3、4 档同色，4 档带 1px 金色外框'
        + (bounds
          ? '；范围按' + (bounds.registered ? '注册' : '首次编辑') + '至末次编辑限定'
          : ''))
      : (state.start + ' 至 ' + state.end
        + ' · 每格 1 天，颜色 = 当日主编辑；总览仅显示 0 / 3 两档，1 / 2 / 4 仅个人视图');

    var v = view;
    var foot = [];
    if (state.editor && v.selected) {
      foot.push('<strong>' + escapeHtml(state.editor) + '</strong> 占本期 '
        + pct(v.selected.count, v.stationTotal) + ' · 本期排名 #' + v.selRank
        + ' · 活跃 ' + v.selected.days.size + ' 天');
    } else if (!state.editor && v.topName) {
      foot.push('本期主编辑 <strong>' + escapeHtml(v.topName) + '</strong>（'
        + formatInt(v.topCount) + ' 次）· 前 4 占 ' + pct(v.stationTop4, v.stationTotal)
        + ' · 前 15 占 ' + pct(v.stationTop15, v.stationTotal));
    }
    el.foot.innerHTML = foot.join('<br>');

    if (scrollToEnd) {
      scrollToEnd = false;
      requestAnimationFrame(function () {
        el.scroll.scrollLeft = el.scroll.scrollWidth;
      });
    }
  }

  function buildLeaderOutline(grid, weeks) {
    var segments = [];
    var seen = new Set();
    var step = CELL_SIZE + GAP_SIZE;
    var half = GAP_SIZE / 2;

    function sameLeader(w, d, leader) {
      return !!(grid[w] && grid[w][d] === leader);
    }

    // 相邻的两个 4 档格若属于不同编辑者，会各自要求同一条边；
    // 用端点集合去重，避免边界被重复描边。
    function addSegment(x1, y1, x2, y2) {
      var ax = Math.min(x1, x2);
      var ay = Math.min(y1, y2);
      var bx = Math.max(x1, x2);
      var by = Math.max(y1, y2);
      var key = ax + ',' + ay + ',' + bx + ',' + by;
      if (seen.has(key)) return;
      seen.add(key);
      segments.push([ax, ay, bx, by]);
    }

    for (var w = 0; w < weeks; w++) {
      for (var d = 0; d < 7; d++) {
        var leader = grid[w] && grid[w][d];
        if (!leader) continue;
        var x0 = w * step - half;
        var y0 = d * step - half;
        var x1 = x0 + step;
        var y1 = y0 + step;
        if (!sameLeader(w, d - 1, leader)) addSegment(x0, y0, x1, y0);
        if (!sameLeader(w + 1, d, leader)) addSegment(x1, y0, x1, y1);
        if (!sameLeader(w, d + 1, leader)) addSegment(x0, y1, x1, y1);
        if (!sameLeader(w - 1, d, leader)) addSegment(x0, y0, x0, y1);
      }
    }
    if (!segments.length) return '';

    var path = segments.map(function (seg) {
      return 'M' + seg[0] + ' ' + seg[1] + 'L' + seg[2] + ' ' + seg[3];
    }).join('');
    var width = weeks * step + 1;
    var height = 7 * step - GAP_SIZE + 4;

    return '<svg class="leader-outline" aria-hidden="true" viewBox="-2 -2 '
      + width + ' ' + height + '" preserveAspectRatio="none">'
      + '<path d="' + path + '" fill="none" stroke="#ffd166" stroke-width="1"'
      + ' stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  }

  function renderMonthLabels(firstWeek, weeks) {
    var labels = [];
    var seenMonths = {};
    var lastWeekIndex = -1;
    var isFirst = true;
    for (var day = state.start; day <= state.end; day = addDays(day, 1)) {
      var monthKey = day.slice(0, 7);
      if (seenMonths[monthKey]) continue;
      seenMonths[monthKey] = true;
      var weekIndex = Math.round(
        (Date.parse(startOfWeek(day)) - Date.parse(firstWeek)) / DAY_MS / 7
      );
      if (weekIndex === lastWeekIndex) continue;
      var lastLabel = labels[labels.length - 1];
      if (lastLabel && weekIndex - lastLabel.week < 2) continue;
      lastWeekIndex = weekIndex;
      var isYear = isFirst || day.slice(5, 7) === '01';
      labels.push({
        week: weekIndex,
        year: isYear,
        text: isYear ? day.slice(0, 4) : (parseInt(day.slice(5, 7), 10) + '月')
      });
      isFirst = false;
    }
    el.months.innerHTML = labels.map(function (label) {
      var left = WEEKDAY_GAP + label.week * (CELL_SIZE + GAP_SIZE);
      return '<span class="' + (label.year ? 'year-label' : 'month-label')
        + '" style="left:' + left + 'px">' + escapeHtml(label.text) + '</span>';
    }).join('');
    el.months.setAttribute('data-weeks', String(weeks));
  }

  function renderLegend() {
    var editorMode = !!state.editor;
    var overview = !editorMode;
    var color = editorMode ? colorFor(state.editor) : '#8b949e';
    var html = [0, 1, 2, 3, 4].map(function (level) {
      var tip = legendDescription(level, overview);
      var background = level ? levelColor(color, level, overview) : 'var(--bg-empty)';
      return '<span class="legend-item" role="img" tabindex="0"'
        + ' data-level="' + level + '" aria-label="' + escapeAttr(tip) + '">'
        + '<span class="legend-swatch' + (editorMode && level === 4 ? ' is-gold' : '')
        + (level === 0 ? ' is-level-0' : '') + '" style="background:' + background + '">'
        + level + '</span></span>';
    });
    el.legend.innerHTML = html.join('');
    setLegendHint(null);
    if (el.legendTitle) {
      el.legendTitle.textContent = '强度';
    }
  }

  function setLegendHint(item) {
    if (!el.legendHint) return;
    el.legendHint.textContent = item ? (item.getAttribute('aria-label') || '') : '';
  }

  /* ----------------------------- palette ----------------------------- */
  function renderPalette() {
    el.paletteSub.textContent = '全站人工 ' + formatInt(allTimeHuman)
      + ' 次 · 前 4 占 ' + pct(allTimeTop4, allTimeHuman)
      + ' · 前 15 占 ' + pct(allTimeTop15, allTimeHuman);

    var maxTopCount = top15.reduce(function (max, name) {
      var u = userByName.get(name);
      return Math.max(max, u ? u[4] : 0);
    }, 0);

    var rows = top15.map(function (name, index) {
      var u = userByName.get(name);
      var count = u ? u[4] : 0;
      var active = state.editor === name;
      var color = colorFor(name);
      return '<button type="button" class="palette-item' + (active ? ' is-active' : '') + '"'
        + ' data-editor="' + escapeAttr(name) + '"'
        + ' aria-pressed="' + (active ? 'true' : 'false') + '">'
        + '<span class="palette-row">'
        + '<span class="palette-swatch" style="background:' + escapeAttr(color) + '"></span>'
        + '<span class="palette-name">' + (index + 1) + '. ' + escapeHtml(name) + '</span>'
        + '<span class="palette-share">' + formatInt(count) + ' · '
        + pct(count, allTimeHuman) + '</span>'
        + '</span>'
        + countBar(count, maxTopCount, color, name + '：' + formatInt(count) + ' 次')
        + '</button>';
    });
    el.paletteList.innerHTML = rows.join('');

    var otherCount = Math.max(0, allTimeHuman - allTimeTop15);
    var otherColor = validHex(P.other) ? P.other : '#6e7681';
    el.paletteOther.innerHTML = '<span class="palette-row">'
      + '<span class="palette-swatch" style="background:' + escapeAttr(otherColor) + '"></span>'
      + '<span class="palette-name">其他人工编辑者</span>'
      + '<span class="palette-share">' + formatInt(otherCount) + ' · '
      + pct(otherCount, allTimeHuman) + '</span></span>'
      + countBar(otherCount, maxTopCount, otherColor,
        '其他人工编辑者：' + formatInt(otherCount) + ' 次');
  }

  /* ----------------------------- data notes ----------------------------- */
  function kv(label, value) {
    return '<span>' + escapeHtml(label) + '</span><b>' + value + '</b>';
  }

  function countRow(label, value, tip, options) {
    options = options || {};
    var display = options.display != null ? options.display : formatInt(value || 0);
    return '<div class="notes-count-row' + (options.total ? ' is-total' : '') + ' has-tip"'
      + ' tabindex="0" data-tip="' + escapeAttr(tip || '') + '">'
      + '<span class="notes-count-label">' + escapeHtml(label) + '</span>'
      + '<b>' + display + '</b></div>';
  }

  function diffTable(rows) {
    if (!rows || !rows.length) return '';
    return '<table class="notes-diff-table">'
      + '<caption class="sr-only">计数有差异的账号：allusers 编辑数与本次抓取修订数</caption>'
      + '<thead><tr><th scope="col">账号</th><th scope="col">API</th>'
      + '<th scope="col">抓取</th><th scope="col">差值</th></tr></thead><tbody>'
      + rows.map(function (row) {
        var diff = row.diff || 0;
        return '<tr>'
          + '<td class="notes-diff-name">' + escapeHtml(row.name || '') + '</td>'
          + '<td class="notes-diff-num">' + formatInt(row.api || 0) + '</td>'
          + '<td class="notes-diff-num">' + formatInt(row.fetched || 0) + '</td>'
          + '<td class="notes-diff-num ' + (diff > 0 ? 'is-up' : (diff < 0 ? 'is-down' : ''))
          + '">' + formatSigned(diff) + '</td></tr>';
      }).join('')
      + '</tbody></table>';
  }

  function renderNotes() {
    var c = M.counts || {};
    var v = M.verification || {};
    var t = M.timeline || {};
    var p = M.periods || {};
    var missing = Math.max(0, (v.expectedTotal || 0) - (c.total || 0));
    var preCreation = 0;
    var migDay = t.migrated ? String(t.migrated.local).slice(0, 10) : '';
    var migCount = 0;
    var excludedBits = FLAG.BOT | FLAG.ANON | FLAG.IMPORTED | FLAG.SYSTEM;
    for (var i = 0; i < D.edits.length; i++) {
      var e = D.edits[i];
      if (e[6] & excludedBits) continue;
      var day = dayOf(e[2]);
      if (day < state.min) preCreation++;
      if (migDay && day === migDay) migCount++;
    }
    var visibleHuman = Math.max(0, (c.human || 0) - preCreation);
    var importPrefix = 0;
    var importGreater = 0;
    (M.importUsers || []).forEach(function (user) {
      if (!user || !user.name) return;
      var count = typeof user.count === 'number' ? user.count : 0;
      if (user.name.indexOf('imported>') === 0) importPrefix += count;
      else if (user.name.charAt(0) === '>') importGreater += count;
    });
    var importSplitOk = importPrefix + importGreater === (c.imported || 0);
    var parts = [];

    parts.push('<div><h3>时间线</h3><ul>'
      + '<li>建站：<b>' + escapeHtml(t.created ? t.created.local : '—') + '</b> CST</li>'
      + (t.firstOrganic ? '<li>首个真人编辑：<b>' + escapeHtml(t.firstOrganic.local)
        + '</b>，' + escapeHtml(t.firstOrganic.user) + ' 创建「'
        + escapeHtml(t.firstOrganic.title) + '」</li>' : '')
      + (t.migrated ? '<li>迁移到独立站：<b>' + escapeHtml(t.migrated.local)
        + '</b>，' + escapeHtml(t.migrated.user) + ' 编辑「'
        + escapeHtml(t.migrated.title) + '」</li>' : '')
      + (t.last ? '<li>数据中最近一次编辑：<b>' + escapeHtml(t.last.local) + '</b> CST</li>' : '')
      + '</ul></div>');

    parts.push('<div><h3>两段时期</h3><div class="notes-kv">'
      + kv('托管时期', p.farm ? formatInt(p.farm.human) + ' 人工 / ' + formatInt(p.farm.total) + ' 修订' : '—')
      + kv('独立时期', p.independent ? formatInt(p.independent.human) + ' 人工 / ' + formatInt(p.independent.total) + ' 修订' : '—')
      + kv('农场起止', p.farm ? escapeHtml(p.farm.startLocal.slice(0, 10)) + ' → ' + escapeHtml(p.farm.endLocal.slice(0, 10)) : '—')
      + kv('独立起止', p.independent ? escapeHtml(p.independent.startLocal.slice(0, 10)) + ' → ' + escapeHtml(p.independent.endLocal.slice(0, 10)) : '—')
      + '</div></div>');

    var countsBlock = '<div><h3>计数（全部可访问修订）</h3>'
      + '<div class="notes-count-tree">'
      + countRow('可访问修订', c.total,
        '本次通过 allrevisions 抓取到的全部修订，含已删除；'
        + '等于注册用户修订 + 匿名修订 + 导入历史。', { total: true })
      + '<div class="notes-count-children">'
      + countRow('注册用户修订', c.registered,
        'userid > 0 的修订；等于人工编辑 + 系统导入 + 机器人。')
      + '<div class="notes-count-children">'
      + countRow('人工编辑', c.human,
        '注册用户中排除机器人、系统账号、导入历史和匿名后的编辑，'
        + '即默认热力图口径；其中 ' + formatInt(preCreation) + ' 次早于建站日。')
      + countRow('系统导入', c.system,
        'Maintenance script 等系统账号的导入、维护编辑；默认不在热力图中显示。')
      + countRow('机器人', c.bot,
        '账号属于 bot 组的编辑；默认不在热力图中显示。')
      + '</div>'
      + countRow('匿名修订', c.anonymous,
        'userid = 0 且不属于导入历史的修订；默认不在热力图中显示。')
      + countRow('导入历史', c.imported,
        '用户名以 imported> 或 > 开头的旧 wiki 导入修订；'
        + '时间戳为导入时间，默认不在热力图中显示。')
      + (importSplitOk
        ? '<div class="notes-count-children">'
          + countRow('imported> 用户名', importPrefix,
            'MediaWiki 导入时保留的旧账号前缀；计入导入历史。')
          + countRow('> 用户名', importGreater,
            '另一类导入账号前缀；计入导入历史。')
          + '</div>'
        : '')
      + '</div></div>'
      + '<div class="notes-count-subtitle">可重叠标记（可能已计入上方分类）</div>'
      + '<div class="notes-count-tree">'
      + countRow('已删除修订', c.deleted,
        '标记为已删除的修订；已包含在可访问修订中，'
        + '同时可能属于任一用户类型。')
      + countRow('小编辑', c.minor,
        '带小编辑标记的修订；可与上方任一分类重叠。')
      + countRow('被回退', c.reverted,
        '带 mw-reverted 标签的修订；可与上方任一分类重叠。')
      + countRow('隐藏', c.hidden,
        '用户或编辑摘要被隐藏的修订；当前为 ' + formatInt(c.hidden || 0) + '。')
      + '</div>'
      + '<p class="notes-count-note">同级缩进项目可直接相加；'
      + '带虚线的项目可悬浮或聚焦查看说明；'
      + '可重叠标记彼此及与上方分类可能重叠，请勿重复相加。</p></div>';

    var allusersSum = v.allusersEditSum || v.expectedRegistered || 0;
    var registeredDiff = (v.fetchedRegistered || 0) - allusersSum;
    var humanDiff = (v.human || 0) - (v.expectedHuman || 0);
    function compareDisplay(base, actual, diff) {
      return formatInt(base || 0) + ' → ' + formatInt(actual || 0)
        + ' <span class="notes-diff' + (diff > 0 ? ' is-up' : (diff < 0 ? ' is-down' : ''))
        + '">' + formatSigned(diff) + '</span>';
    }
    var apiBlock = '<div><h3>与统计 API 的差异</h3>'
      + '<div class="notes-count-tree">'
      + countRow('statistics 总编辑数', v.expectedTotal,
        'MediaWiki statistics API 返回的全站编辑总数，含不可访问或已删除修订。',
        { total: true })
      + '<div class="notes-count-children">'
      + countRow('可访问修订', c.total,
        '本次 allrevisions 实际抓取到的修订数。')
      + countRow('差值（隐藏 / 无权限）', missing,
        'statistics 总编辑数 − 可访问修订；可能来自隐藏、'
        + '删除后不可见或权限不可读。')
      + '</div>'
      + countRow('allusers 注册编辑合计 → 抓取注册修订', v.fetchedRegistered,
        '箭头左侧为 allusers 的 editcount 合计，右侧为本次抓取的注册修订；'
        + '差值为右减左，受缓存、删除修订和计数口径影响。',
        { display: compareDisplay(allusersSum, v.fetchedRegistered, registeredDiff) })
      + countRow('人工编辑（规划基准）→ 当前', v.human,
        '箭头左侧为早期规划分析的人工编辑基准，右侧为本次抓取；'
        + '差值为右减左。',
        { display: compareDisplay(v.expectedHuman, v.human, humanDiff) })
      + countRow('计数有差异的账号', v.usersWithDiff,
        '抓取修订数与 allusers editcount 不一致的账号数量。',
        { display: formatInt(v.usersWithDiff || 0) + ' 个' })
      + '</div>'
      + diffTable(v.topDiffs || [])
      + '<p class="notes-count-note">箭头左侧为基准或 API 合计，'
      + '右侧为本次抓取，差值为右减左。差异账号按差值绝对值降序；'
      + 'API 为 allusers 的 editcount，抓取为本次 allrevisions 实测。</p></div>';
    parts.push('<div class="notes-columns">' + countsBlock + apiBlock + '</div>');

    parts.push('<div><h3>热力强度与当日要点</h3><ul>'
      + '<li><b>0</b> 无编辑；<b>1</b> 有编辑，且没有 ≥' + BIG_DELTA
      + ' B 的大修订、编辑数不超过活跃日均；<b>2</b> 满足前两项之一；'
      + '<b>3</b> 当日编辑数最高或修订字节数最高（均可并列）；<b>4</b> 两项都最高。</li>'
      + '<li>总览视图每格显示当日主编辑：先比编辑数，再比修订字节数，最后按用户名排序。'
      + '总览只呈现 0 / 3 两档；1、2、4 只在选中编辑者的个人视图出现。</li>'
      + '<li>个人视图中 3、4 档使用相同填色，4 档仅通过 1px 金色外框区分；'
      + '上下左右相邻的同一位编辑者 4 档日连成同一圈，换人或不相邻时自动断开。</li>'
      + '<li>选中编辑者时，日期范围默认限定为「注册日与首次编辑日中较早者至末次编辑」；2024 年迁移重建账号后，旧站编辑者的注册日常被重置，取较早者可保留旧站历史。'
      + '注册日缺失时使用首次编辑日；手动调整日期不能超出该范围。</li>'
      + '<li>修订字节数按 |新大小 − 父修订大小| 求和，净字节保留正负；页面创建按新页面大小计算。'
      + '页面移动、父修订不可读或已删除等无法确定差值的情况显示「—」，不计入大修订。</li>'
      + '<li>日详情中的横向条形图：计数条按当日最高编辑数缩放，差异条以中线为零点、按当日最大 |Δ| 缩放。'
      + '「计数」与「与统计 API 的差异」按可加关系缩进展示；可重叠标记请勿重复相加。</li>'
      + '</ul></div>');

    parts.push('<div class="notes-warn"><h3>已知限制</h3><ul>'
      + '<li>statistics 的 ' + formatInt(v.expectedTotal) + ' 次与可访问的 '
      + formatInt(c.total) + ' 次相差 <b>' + formatInt(missing)
      + '</b> 次：差额来自被监督隐藏、删除后不可见或权限不可读的修订，热力图中无法呈现。</li>'
      + '<li>「规划基准」' + formatInt(v.expectedHuman) + ' 来自建站统计 + allusers 口径的早期分析，与当前全站人工 '
      + formatInt(c.human) + ' 的差异主要来自已删除修订、allusers 缓存计数与实时抓取的不同步。</li>'
      + '<li>热力图从建站日 <b>' + escapeHtml(state.min) + '</b> 起；全站人工 '
      + formatInt(c.human) + ' 次中有 <b>' + formatInt(preCreation) + '</b> 次早于建站日（导入历史），'
      + '因此「建站至今」合计为 <b>' + formatInt(visibleHuman) + '</b> 次，与「全部编辑者」的 '
      + formatInt(c.human) + ' 次相差这 ' + formatInt(preCreation) + ' 次。</li>'
      + '<li>「农场 / 独立时期」预设按自然日切分；迁移日 <b>' + escapeHtml(migDay) + '</b> 的 '
      + formatInt(migCount) + ' 次人工编辑在两个预设中都会整日计入，而上方的两段时期计数按迁移时刻切分、互不重叠。</li>'
      + '<li>已删除修订的编辑摘要无法读取，日详情中只保留时间、页面、大小变化与标记。</li>'
      + '<li>颜色按编辑者固定；未进入前 15 的编辑者统一使用「其他」灰色。</li>'
      + '</ul></div>');

    if (M.caveats && M.caveats.length) {
      parts.push('<div><h3>生成器备注</h3><ul>'
        + M.caveats.map(function (text) {
          return '<li>' + escapeHtml(text) + '</li>';
        }).join('')
        + '</ul></div>');
    }

    parts.push('<div><h3>数据来源</h3><p>'
      + '<a href="' + escapeAttr(M.site) + '" target="_blank" rel="noopener">tetriswiki.cn</a>'
      + ' MediaWiki API · 生成于 ' + escapeHtml(formatGenerated(M.generatedAt))
      + ' CST · 时区 ' + escapeHtml(M.timezone || 'Asia/Shanghai')
      + ' · 页面加载时不请求 API。</p></div>');

    el.notes.innerHTML = parts.join('');
  }

  /* ----------------------------- tooltip ----------------------------- */
  function showTooltip(cell) {
    var day = cell.getAttribute('data-day');
    var rec = view.station.get(day);
    var viewCount = rec ? rec.viewCount : 0;
    var rows = ['<div class="tooltip-title"><span>' + escapeHtml(formatDay(day)) + '</span>'
      + (rec && rec.level ? '<span class="level-badge is-level-' + rec.level + '">强度 '
        + rec.level + '</span>' : '') + '</div>'];

    if (rec) {
      rows.push('<div class="tooltip-row"><span>本站编辑</span><strong>'
        + formatInt(rec.count) + ' 次</strong></div>');
      if (state.editor) {
        var mine = rec.byUser.get(state.editor);
        rows.push('<div class="tooltip-row"><span>' + escapeHtml(state.editor)
          + '</span><strong>' + formatInt(viewCount) + ' 次</strong></div>');
        rows.push('<div class="tooltip-row"><span>本人净字节</span><strong class="'
          + (!mine || !mine.known ? 'is-unknown' : (mine.net > 0 ? 'plus' : (mine.net < 0 ? 'minus' : '')))
          + '">' + (mine && mine.known ? formatSigned(mine.net) : '—') + '</strong></div>');
      } else {
        rows.push('<div class="tooltip-row"><span>主编辑</span><strong>'
          + escapeHtml(rec.mainEditor || '—') + '</strong></div>');
        rows.push('<div class="tooltip-row"><span>净字节</span><strong class="'
          + (rec.known ? (rec.totalNet > 0 ? 'plus' : (rec.totalNet < 0 ? 'minus' : '')) : 'is-unknown')
          + '">' + (rec.known ? formatSigned(rec.totalNet) : '—') + '</strong></div>');
      }
      rows.push('<div class="tooltip-row"><span>≥' + BIG_DELTA + ' B 大修订</span><strong>'
        + formatInt(state.editor
          ? (rec.byUser.get(state.editor) ? rec.byUser.get(state.editor).big : 0)
          : rec.bigCount) + ' 次</strong></div>');
      if (state.editor && rec.mainEditor && rec.mainEditor !== state.editor) {
        rows.push('<div class="tooltip-hint">当日主编辑：' + escapeHtml(rec.mainEditor)
          + '（' + formatInt(rec.topCount) + ' 次，' + formatInt(rec.topBytes) + ' B）</div>');
      }
      if (rec.level) {
        rows.push('<div class="tooltip-hint">强度 ' + rec.level + '：'
          + escapeHtml(levelLabel(rec.level, !state.editor)) + '</div>');
      }

      rows.push('<div class="tooltip-section-title">编辑数前 3</div>');
      leaderList(rec, 3).forEach(function (user) {
        var color = colorFor(user.name);
        rows.push('<div class="tooltip-leader">'
          + '<div class="tooltip-row"><span class="tooltip-editor">'
          + '<span class="tooltip-dot" style="background:' + escapeAttr(color) + '"></span>'
          + escapeHtml(user.name) + '</span><strong>' + formatInt(user.count) + '</strong></div>'
          + countBar(user.count, rec.topCount, color,
            user.name + '：' + formatInt(user.count) + ' 次')
          + '</div>');
      });

      if (state.editor && !leaderList(rec, 3).some(function (u) { return u.name === state.editor; })) {
        var selected = rec.byUser.get(state.editor);
        if (selected) {
          rows.push('<div class="tooltip-leader is-selected">'
            + '<div class="tooltip-row"><span class="tooltip-editor">'
            + '<span class="tooltip-dot" style="background:'
            + escapeAttr(colorFor(state.editor)) + '"></span>'
            + escapeHtml(state.editor) + '</span><strong>'
            + formatInt(selected.count) + '</strong></div>'
            + countBar(selected.count, rec.topCount, colorFor(state.editor),
              state.editor + '：' + formatInt(selected.count) + ' 次')
            + '</div>');
        }
      }
    } else {
      rows.push('<div class="tooltip-hint">当日无编辑</div>');
    }
    rows.push('<div class="tooltip-hint">点击查看当日明细</div>');

    el.tooltip.innerHTML = rows.join('');
    el.tooltip.hidden = false;
    el.tooltip.classList.add('is-visible');

    var wrap = cell.closest('.heatmap-wrap');
    if (!wrap) return;
    var wrapRect = wrap.getBoundingClientRect();
    var rect = cell.getBoundingClientRect();
    var centerX = rect.left - wrapRect.left + rect.width / 2;
    var top = rect.top - wrapRect.top;
    var half = Math.min(150, Math.max(98, wrapRect.width / 2 - 8));
    el.tooltip.style.left = Math.max(half, Math.min(wrapRect.width - half, centerX)) + 'px';
    el.tooltip.style.top = top + 'px';
    el.tooltip.classList.toggle('is-below', top < (el.tooltip.offsetHeight || 96) + 12);
  }

  function hideTooltip() {
    if (!el.tooltip) return;
    el.tooltip.hidden = true;
    el.tooltip.classList.remove('is-visible', 'is-below');
    el.tooltip.innerHTML = '';
  }

  function showInfoTip(target) {
    if (!el.infoTip) return;
    var text = target.getAttribute('data-tip');
    if (!text) return;
    el.infoTip.textContent = text;
    el.infoTip.hidden = false;
    var anchor = target.querySelector('.notes-count-label') || target;
    var rect = anchor.getBoundingClientRect();
    var tipRect = el.infoTip.getBoundingClientRect();
    var left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, rect.left));
    var top = rect.top - tipRect.height - 8;
    if (top < 8) top = rect.bottom + 8;
    el.infoTip.style.left = left + 'px';
    el.infoTip.style.top = top + 'px';
  }

  function hideInfoTip() {
    if (!el.infoTip) return;
    el.infoTip.hidden = true;
    el.infoTip.textContent = '';
  }

  /* ----------------------------- day dialog ----------------------------- */
  function openDay(day) {
    lastFocus = document.activeElement;
    hideTooltip();

    var rec = view.station.get(day);
    var viewCount = rec ? rec.viewCount : 0;
    var edits = [];
    var dayMaxDelta = 0;
    for (var i = 0; i < D.edits.length; i++) {
      var e = D.edits[i];
      if (dayOf(e[2]) !== day) continue;
      if (!passesCore(e)) continue;
      if (state.editor && D.users[e[1]][0] !== state.editor) continue;
      edits.push(e);
      var delta = deltaOf(e);
      if (delta !== null && Math.abs(delta) > dayMaxDelta) dayMaxDelta = Math.abs(delta);
    }
    edits.sort(function (a, b) { return a[2] - b[2]; });

    el.dayTitle.textContent = formatDay(day);
    el.daySub.textContent = rec
      ? (state.editor
        ? state.editor + ' 当日 ' + formatInt(viewCount) + ' 次 · 本站 '
          + formatInt(rec.count) + ' 次 · 强度 ' + rec.level + ' · '
          + levelLabel(rec.level, false)
        : '本站当日 ' + formatInt(rec.count) + ' 次编辑 · 主编辑 ' + rec.mainEditor
          + '（' + formatInt(rec.topCount) + ' 次）· 强度 ' + rec.level + ' · '
          + levelLabel(rec.level, true))
      : '当日无编辑';

    var toolbar = [
      '<span>当前视图 <strong>' + formatInt(viewCount) + '</strong> 次</span>',
      '<span>本站 <strong>' + formatInt(rec ? rec.count : 0) + '</strong> 次</span>'
    ];
    if (state.editor) {
      toolbar.push('<span class="badge">编辑者：' + escapeHtml(state.editor) + '</span>');
    }
    if (state.ns !== 'all') {
      toolbar.push('<span class="badge">命名空间：'
        + escapeHtml(state.ns === 'other' ? '讨论 / 其他' : nsLabel(Number(state.ns))) + '</span>');
    }
    toolbar.push('<span class="muted">' + escapeHtml(state.start + ' — ' + state.end) + '</span>');
    toolbar.push('<span class="muted">点击差异 / 贡献在新标签页打开 wiki</span>');
    el.dayToolbar.innerHTML = toolbar.join('');

    el.daySummary.innerHTML = renderDaySummary(rec, viewCount, dayMaxDelta);
    el.dayList.innerHTML = edits.length
      ? edits.map(function (edit) { return renderDayEdit(edit, dayMaxDelta); }).join('')
      : '<div class="day-empty">当前筛选下这一天没有编辑。</div>';
    el.dayList.scrollTop = 0;

    if (typeof el.dialog.showModal === 'function') {
      if (!el.dialog.open) el.dialog.showModal();
    } else {
      el.dialog.setAttribute('open', '');
    }
  }

  function renderDaySummary(rec, viewCount, dayMaxDelta) {
    if (!rec) return '<div class="day-summary-empty">当日无编辑</div>';

    var overview = !state.editor;
    var users = leaderList(rec, 3);
    if (state.editor) {
      var mine = rec.byUser.get(state.editor);
      if (mine && !users.some(function (user) { return user.name === state.editor; })) {
        users = users.concat([mine]);
      }
    }
    var maxNet = 0;
    users.forEach(function (user) {
      maxNet = Math.max(maxNet, Math.abs(user.net));
    });

    var parts = ['<div class="day-summary-head"><h3>当日要点</h3>'
      + levelBadge(rec.level, overview) + '</div>'
      + '<div class="day-summary-kpis">'
      + '<span><b>' + formatInt(rec.count) + '</b> 次本站编辑</span>'
      + '<span><b>' + formatInt(rec.byUser.size) + '</b> 位编辑者</span>'
      + '<span><b>' + formatInt(rec.bigCount) + '</b> 次 ≥' + BIG_DELTA + ' B 大修订</span>'
      + '<span>净字节 <b class="' + (!rec.known ? 'is-unknown'
        : (rec.totalNet > 0 ? 'plus' : (rec.totalNet < 0 ? 'minus' : ''))) + '">'
      + (rec.known ? formatSigned(rec.totalNet) : '—') + '</b></span>'
      + (state.editor ? '<span>本人 <b>' + formatInt(viewCount) + '</b> 次</span>' : '')
      + '</div>'];

    parts.push('<div class="day-summary-bars">');
    users.forEach(function (user) {
      var color = colorFor(user.name);
      var bytes = user.known ? formatSigned(user.net) : '—';
      var bytesCls = !user.known ? 'is-unknown'
        : (user.net > 0 ? 'plus' : (user.net < 0 ? 'minus' : ''));
      parts.push('<div class="summary-person">'
        + '<div class="summary-person-head">'
        + '<span class="tooltip-editor"><span class="tooltip-dot" style="background:'
        + escapeAttr(color) + '"></span>' + escapeHtml(user.name) + '</span>'
        + '<span class="summary-person-value">' + formatInt(user.count) + ' 次 · '
        + bytes + (user.known ? ' B' : '') + '</span></div>'
        + '<div class="summary-bar-line"><span class="summary-bar-label">计数</span>'
        + countBar(user.count, rec.topCount, color,
          user.name + '：' + formatInt(user.count) + ' 次')
        + '<span class="summary-bar-value">' + formatInt(user.count) + '</span></div>'
        + '<div class="summary-bar-line"><span class="summary-bar-label">净字节</span>'
        + (user.known ? deltaBar(user.net, maxNet,
          user.name + '：' + formatSigned(user.net) + ' B')
          : '<span class="delta-track"></span>')
        + '<span class="summary-bar-value ' + bytesCls + '">' + bytes + '</span></div>'
        + '</div>');
    });
    parts.push('</div>');
    if (dayMaxDelta > 0) {
      parts.push('<p class="day-summary-note">差异条以中线为零点，按当日最大 |Δ| '
        + formatInt(dayMaxDelta) + ' B 缩放；计数条按当日最高 '
        + formatInt(rec.topCount) + ' 次缩放。</p>');
    }
    return parts.join('');
  }

  function renderDayEdit(e, dayMaxDelta) {
    var revid = e[0];
    var user = D.users[e[1]][0];
    var ts = e[2];
    var page = D.pages[e[3]];
    var parent = e[4];
    var size = e[5];
    var flags = e[6];
    var comment = e[7] || '';

    var delta = deltaOf(e);
    var deltaHtml = delta === null
      ? '<span class="is-unknown">—</span>'
      : '<span class="' + (delta > 0 ? 'plus' : (delta < 0 ? 'minus' : '')) + '">'
        + formatSigned(delta) + '</span>';

    var badges = FLAG_LABELS.filter(function (item) {
      return (flags & item[0]) !== 0;
    }).map(function (item) {
      return '<span class="badge ' + item[2] + '">' + item[1] + '</span>';
    }).join('');

    var iso = new Date((ts + CST_SECONDS) * 1000).toISOString().slice(0, 19) + '+08:00';

    return '<article class="day-edit">'
      + '<time class="day-time" datetime="' + iso + '">' + timeOf(ts) + '</time>'
      + '<div class="day-main">'
      + '<div class="day-top">'
      + '<a class="day-user" href="' + escapeAttr(userUrl(user)) + '" target="_blank" rel="noopener"'
      + ' style="color:' + escapeAttr(colorFor(user)) + '">' + escapeHtml(user) + '</a>'
      + '<a class="day-page" href="' + escapeAttr(pageUrl(page[0])) + '" target="_blank" rel="noopener">'
      + escapeHtml(page[0]) + '</a>'
      + '<span class="badge">' + escapeHtml(nsLabel(page[1])) + '</span>'
      + (badges ? '<span class="badges">' + badges + '</span>' : '')
      + '</div>'
      + '<p class="day-comment' + (comment ? '' : ' is-empty') + '">'
      + (comment ? escapeHtml(comment) : '（无编辑摘要）') + '</p>'
      + '</div>'
      + '<div class="day-side">'
      + '<span class="day-size">' + formatInt(size) + ' B · ' + deltaHtml + '</span>'
      + (delta === null ? '' : deltaBar(delta, dayMaxDelta,
        formatSigned(delta) + ' B'))
      + '<span class="day-links">'
      + '<a href="' + escapeAttr(diffUrl(page[0], revid, parent)) + '" target="_blank" rel="noopener">差异</a>'
      + '<a href="' + escapeAttr(contribUrl(user)) + '" target="_blank" rel="noopener">贡献</a>'
      + '</span>'
      + '</div>'
      + '</article>';
  }

  function showFatal() {
    var main = document.querySelector('main');
    if (!main) return;
    main.innerHTML = '<section class="panel" style="padding:28px">'
      + '<h2>数据未加载</h2>'
      + '<p class="muted" style="margin-top:8px">请先运行 '
      + '<code>python scripts/fetch_edits.py --build-only</code> 生成 '
      + '<code>data/meta.js</code> 与 <code>data/edits.js</code>，并通过 '
      + '<code>index.html</code> 访问。</p></section>';
  }

  document.addEventListener('DOMContentLoaded', init);
})();

