/*
 * 城通网盘旧版客户端 - 下载列表跨会话保留 + 断点续传补丁
 *
 * 原客户端把下载/上传列表存成 <登录session>downfileItems.json。
 * 每次重新登录 session 都会变，旧任务因此永远加载不到，表现为“强制退出后进度丢失”。
 *
 * 本脚本：
 *   1. 把最近 7 天内、因 session 变化而孤立的任务合并到按账号固定的列表文件；
 *   2. 启动后自动续传“退出时仍在下载”的任务（保存状态 pause=false 且未完成）；
 *   3. 每 5 秒保存一次列表，尽量保留最新进度（续传本身仍以磁盘已下载字节为准）。
 *
 * 需要配合 main.js 中的路径修改：<session> 改为 "u_<username>_"。
 */
(function () {
  'use strict';

  var fs = require('fs');
  var path = require('path');
  var gui = require('nw.gui');

  var dataPath = gui.App.dataPath;
  var MIGRATE_DAYS = 7;
  var PREFIX = 'downfile';

  function readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
  }

  function writeJson(p, obj) {
    try { fs.writeFileSync(p, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }

  var userItems = readJson(path.join(dataPath, 'userItems.json')) || {};
  var key = 'u_' + (userItems.username || 'default') + '_';
  var target = path.join(dataPath, key + PREFIX + 'Items.json');

  function migrate() {
    var current = readJson(target);
    if (Array.isArray(current) && current.length) return current;

    var cutoff = Date.now() - MIGRATE_DAYS * 24 * 3600 * 1000;
    var names = [];
    try { names = fs.readdirSync(dataPath); } catch (e) { return []; }

    var merged = {};
    var order = [];

    names.forEach(function (name) {
      if (name.indexOf(PREFIX + 'Items.json') < 0) return;
      if (name.indexOf(key) === 0) return;
      if (name === PREFIX + 'Items.json') return;

      var p = path.join(dataPath, name);
      var st;
      try { st = fs.statSync(p); } catch (e) { return; }
      if (st.mtimeMs < cutoff) return;

      var arr = readJson(p);
      if (!Array.isArray(arr)) return;

      arr.forEach(function (item) {
        if (!item || !item.id) return;
        var prev = merged[item.id];
        if (!prev || (item.transSize || 0) >= (prev.transSize || 0)) merged[item.id] = item;
        if (order.indexOf(item.id) < 0) order.push(item.id);
      });
    });

    if (!order.length) return [];

    var out = order.map(function (id) { return merged[id]; });
    writeJson(target, out);
    return out;
  }

  var initial = migrate();
  var resumeIds = initial
    .filter(function (it) { return it && !it.complete && it.pause === false; })
    .map(function (it) { return it.id; });

  var resumed = false;
  function tryResume() {
    if (resumed) return;
    if (typeof downfile === 'undefined' || !downfile || !downfile.files_sessions) return;
    if (!downfile.files_sessions.length) return;

    resumed = true;
    resumeIds.forEach(function (id) {
      var item = null;
      for (var i = 0; i < downfile.files_sessions.length; i++) {
        if (downfile.files_sessions[i].id === id) { item = downfile.files_sessions[i]; break; }
      }
      if (!item || item.complete) return;
      try { downfile.start(id); } catch (e) {}
    });
  }

  setInterval(tryResume, 500);

  setInterval(function () {
    try {
      if (typeof downfile !== 'undefined' && downfile && downfile.files_sessions &&
          downfile.files_sessions.length && typeof downfile.saveSessionsToLocal === 'function') {
        downfile.saveSessionsToLocal();
      }
    } catch (e) {}
  }, 5000);
})();
