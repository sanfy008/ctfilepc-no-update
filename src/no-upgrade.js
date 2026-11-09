/*
 * 城通网盘旧版客户端 - 禁用升级补丁
 *
 * 1. 让 user.server_version 始终等于本地版本号，托盘菜单不再出现“点击升级”项；
 * 2. 将 app_upgrade() 置为空函数，即使被其他入口调用也不会启动 xtupdate.exe。
 * 不影响正常登录、上传下载等其它功能。
 */
(function () {
  'use strict';

  function apply() {
    try {
      if (typeof user !== 'undefined' && user && !Object.getOwnPropertyDescriptor(user, 'server_version')) {
        Object.defineProperty(user, 'server_version', {
          configurable: true,
          get: function () {
            return typeof user.getClientVersion === 'function' ? user.getClientVersion() : '3.60.0';
          },
          set: function () { /* 忽略服务端下发的新版本号 */ }
        });
      }
    } catch (e) {}
    try {
      if (typeof app_upgrade === 'function') {
        window.app_upgrade = function () {
          console.log('自动升级已被本地补丁禁用');
        };
      }
    } catch (e) {}
  }

  apply();
  var tries = 0;
  var timer = setInterval(function () {
    apply();
    if (++tries > 100) clearInterval(timer);
  }, 50);
})();
