/* ------------------------------------------------------------------
 * Tetris Wiki CN · editor palette
 *
 * 这是唯一需要手改的配色文件。`editors` 中按「编辑者名 → 颜色」填写，
 * 颜色使用 6 位十六进制；未列出的编辑者使用 `other` 灰色。
 * `top15` 决定工具条与「编辑者配色」面板里的快捷顺序。
 *
 * 当前为占位配色（flore 粉、Xb2002b 浅蓝，其余为可读性优先的区分色），
 * 等最终调色板确定后直接替换即可，无需改 js/app.js。
 * 计数来自 2026-10-18 数据快照，仅作注释参考。
 * ------------------------------------------------------------------ */
(function () {
  var TOP15 = [
    ['風洛霊flore', '#ff9ec7', 11894], // 粉
    ['Xb2002b', '#8ecdf7', 7670],       // 浅蓝
    ['Aqua6623', '#5ce1e6', 5525],
    ['某G先生', '#ffa657', 2939],
    ['Teatube', '#7ee787', 1375],
    ['SundayLee', '#d2a8ff', 613],
    ['铁桶', '#f2cc60', 346],
    ['Farter', '#ff938a', 302],
    ['Bigcowhh', '#56d4dd', 144],
    ['Notypey', '#b3e05a', 143],
    ['PPPxcy', '#a5a6ff', 138],
    ['蓝绿', '#4ec9b0', 107],
    ['是我阿恒哒', '#ffb3c1', 100],
    ['Opj', '#9ecbff', 88],
    ['Norca0721', '#ffd479', 52]
  ];

  var editors = {};
  var counts = {};
  var names = [];
  TOP15.forEach(function (item) {
    names.push(item[0]);
    editors[item[0]] = item[1];
    counts[item[0]] = item[2];
  });

  window.TETRISWIKI_PALETTE = {
    version: 1,
    note: '占位配色。替换 editors 即可；未列出的编辑者使用 other。',
    other: '#6e7681',
    otherLabel: '其他编辑者',
    /** 个人视图强度 0 / 1 / 2 / 3 / 4 的不透明度；0 为无编辑。3、4 档同色，4 档仅靠金色外框区分。 */
    levelAlpha: [0, 0.2, 0.44, 0.7, 0.7],
    /** 总览视图强度 0 / 3 的不透明度（1、2、4 仅个人视图使用）；3、4 档同色。 */
    overviewAlpha: [0, 0.18, 0.34, 0.54, 0.54],
    top15: names,
    counts: counts,
    editors: editors
  };
})();
