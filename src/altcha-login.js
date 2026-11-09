/*
 * 城通网盘旧版客户端 - 密码登录安全验证补丁（加固版）
 *
 * 服务端要求 3.6+ 客户端在密码登录时附带 altcha_token。本脚本：
 *   1. 优先嵌入官方验证页 h5.ctfile.com/captcha/<type>.html 取 token，
 *      验证算法升级由官方页面自行处理；
 *   2. 官方页面不可用时回退到本地 PBKDF2 求解；
 *   3. 若服务端以“版本过低”拦截，自动读取官方最新版本号并重试；
 *   4. 验证令牌过期时自动换新重试一次。
 * 不修改客户端其它逻辑。
 */
(function () {
  'use strict';

  var crypto = require('crypto');
  var https = require('https');
  var os = require('os');

  var REST = 'https://rest.ctfile.com';
  var CHALLENGE_URL = REST + '/p8/public/captcha/altcha?act=login';
  var TYPE_URL = REST + '/p8/public/captcha/type';
  var VERSIONS_URL = REST + '/p8/public/app_versions/all';
  var WIDGET_BASE = 'https://h5.ctfile.com/captcha/';
  var DEFAULT_VERSION = '3.60.0';
  var WIDGET_TIMEOUT = 25000;
  var WORKERS = Math.min(8, Math.max(2, (os.cpus() || []).length || 2));
  var MAX_COUNTER = 4000000;
  var solving = false;

  function httpGetJson(url, cb) {
    var req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 15000
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try {
          cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          cb(e);
        }
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', cb);
  }

  function getLatestVersion(cb) {
    httpGetJson(VERSIONS_URL + '?_=' + Date.now(), function (err, data) {
      var v = data && data.data && data.data.windows && data.data.windows.version;
      if (v) return cb(null, String(v).replace(/^v/i, ''));
      cb(err || new Error('version not found'));
    });
  }

  function getCaptchaType(cb) {
    httpGetJson(TYPE_URL + '?_=' + Date.now(), function (err, data) {
      var t = data && data.captcha_type;
      cb(null, (typeof t === 'string' && t) ? t : 'altcha');
    });
  }

  /* ------------------------------------------------------------------ *
   * 官方验证页：隐藏（altcha）或可见（图片 / turnstile）iframe 取 token
   * ------------------------------------------------------------------ */
  function createWidget(type, visible, cb) {
    var old = document.getElementById('ctfile-captcha-wrap');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var wrap = document.createElement('div');
    wrap.id = 'ctfile-captcha-wrap';
    wrap.style.cssText = visible
      ? 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;'
      : 'position:fixed;left:-9999px;top:0;width:420px;height:90px;overflow:hidden;';

    var frame = document.createElement('iframe');
    frame.id = 'ctfile-captcha-frame';
    frame.setAttribute('allow', 'clipboard-write');
    frame.style.cssText = visible
      ? 'width:420px;height:340px;border:0;background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);'
      : 'width:400px;height:80px;border:0;';
    frame.src = WIDGET_BASE + encodeURIComponent(type) + '.html?source=p8&action=login&lang=zh-cn&theme=light&_=' + Date.now();
    wrap.appendChild(frame);

    var finished = false;

    function done(err, token) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      cb(err, token);
    }

    function onMessage(e) {
      if (e.source !== frame.contentWindow) return;
      if (String(e.origin).indexOf('https://h5.ctfile.com') !== 0) return;
      var d = e.data || {};
      if (d.source !== 'ctfile-captcha' || d.type !== type) return;
      if (d.event === 'success' && d.token) return done(null, String(d.token));
      if (d.event === 'error' && (d.error === 'script_load_failed' || d.error === 'invalid_action')) {
        done(new Error(d.error));
      }
      // 其它错误由官方页面自动重试，这里继续等待
    }

    window.addEventListener('message', onMessage);
    var timer = setTimeout(function () { done(new Error('timeout')); }, WIDGET_TIMEOUT);

    if (visible) {
      var bar = document.createElement('div');
      bar.style.cssText = 'width:420px;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;color:#fff;font:13px/1.5 sans-serif;';
      var title = document.createElement('span');
      title.textContent = '请完成安全验证';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '取消';
      cancel.style.cssText = 'border:0;border-radius:6px;padding:4px 12px;background:#fff;color:#333;cursor:pointer;';
      cancel.onclick = function () { done(new Error('cancelled')); };
      bar.appendChild(title);
      bar.appendChild(cancel);
      wrap.insertBefore(bar, frame);
    }

    document.body.appendChild(wrap);
  }

  /* ------------------------------------------------------------------ *
   * 本地 PBKDF2 求解（官方验证页不可用时的回退方案）
   * ------------------------------------------------------------------ */
  function derive(password, salt, iterations, keylen) {
    return new Promise(function (resolve, reject) {
      crypto.pbkdf2(password, salt, iterations, keylen, 'sha256', function (err, dk) {
        if (err) reject(err); else resolve(dk);
      });
    });
  }

  function solveChallenge(ch, cb) {
    var p = ch.parameters;
    var nonce = Buffer.from(p.nonce, 'hex');
    var salt = Buffer.from(p.salt, 'hex');
    var prefix = Buffer.from(p.keyPrefix, 'hex');
    var found = null;
    var started = Date.now();
    var chains = [];

    function chain(start) {
      return (async function () {
        for (var counter = start; !found && counter < MAX_COUNTER; counter += WORKERS) {
          var block = Buffer.alloc(nonce.length + 4);
          nonce.copy(block);
          block.writeUInt32BE(counter, nonce.length);
          var dk = await derive(block, salt, p.cost, p.keyLength);
          if (dk.subarray(0, prefix.length).equals(prefix)) {
            found = { counter: counter, derivedKey: dk.toString('hex') };
            return;
          }
        }
      })();
    }

    for (var w = 0; w < WORKERS; w++) chains.push(chain(w));

    Promise.all(chains).then(function () {
      if (!found) return cb(new Error('no solution'));
      var token = Buffer.from(JSON.stringify({
        challenge: { parameters: p, signature: ch.signature },
        solution: { counter: found.counter, derivedKey: found.derivedKey, time: Date.now() - started }
      })).toString('base64');
      cb(null, token);
    }, cb);
  }

  function solveLocally(cb) {
    httpGetJson(CHALLENGE_URL + '?_=' + Date.now(), function (err, ch) {
      if (err || !ch || !ch.parameters || !ch.parameters.keyPrefix) {
        return cb(err || new Error('invalid challenge'));
      }
      solveChallenge(ch, function (e2, token) {
        if (token) cb(null, token, 'solver');
        else cb(e2 || new Error('no solution'));
      });
    });
  }

  function getToken(cb) {
    getCaptchaType(function (err, type) {
      if (type === 'altcha') {
        createWidget('altcha', false, function (werr, token) {
          if (token) return cb(null, token, 'widget');
          solveLocally(cb);
        });
      } else {
        // 图片 / turnstile 等需要人工操作的验证：直接显示官方页面
        createWidget(type, true, function (werr, token) {
          if (token) return cb(null, token, 'widget:' + type);
          cb(werr || new Error('captcha failed'));
        });
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 登录包装
   * ------------------------------------------------------------------ */
  function isVersionGate(resp) {
    return !!resp && resp.code === 403 && !resp.error_code && /扫码|升级|版本/.test(String(resp.message || ''));
  }

  function setBusy(busy) {
    var btn = document.getElementById('user-login-act');
    if (!btn) return;
    if (busy) {
      if (!btn.getAttribute('data-orig-html')) btn.setAttribute('data-orig-html', btn.innerHTML);
      btn.disabled = true;
      btn.innerHTML = '安全验证中…';
    } else {
      btn.disabled = false;
      var orig = btn.getAttribute('data-orig-html');
      if (orig) btn.innerHTML = orig;
    }
  }

  function install() {
    if (typeof user === 'undefined' || !user || typeof user.apiCall !== 'function') return false;
    var origApiCall = user.apiCall;

    user.apiCall = function (item, action, data, callback) {
      if (item !== 'user_act' || action !== 'login' || !data || typeof data !== 'object' ||
          data.qr || typeof data.username === 'undefined' || typeof data.password === 'undefined') {
        return origApiCall.apply(this, arguments);
      }
      if (solving) return;
      solving = true;
      setBusy(true);

      var self = this;
      var captchaRetried = false;
      var versionRetried = false;
      var debug = window.__ctfileCaptchaDebug = { startedAt: Date.now() };

      function finish(resp) {
        solving = false;
        setBusy(false);
        callback(resp);
      }

      function attempt() {
        getToken(function (err, token, method) {
          if (!token) {
            solving = false;
            setBusy(false);
            return origApiCall.call(self, item, action, data, callback);
          }
          data.altcha_token = token;
          debug.method = method;
          debug.tokenAt = Date.now();
          origApiCall.call(self, item, action, data, function (resp) {
            debug.response = resp && { code: resp.code, error_code: resp.error_code, message: resp.message };
            if (isVersionGate(resp) && !versionRetried) {
              versionRetried = true;
              return getLatestVersion(function (e2, latest) {
                if (!latest) return finish(resp);
                window.__ctfileClientVersion = latest;
                data.version = latest;
                debug.versionBumped = latest;
                attempt();
              });
            }
            if (resp && resp.error_code === 'LOGIN_CAPTCHA_REQUIRED' && !captchaRetried) {
              captchaRetried = true;
              return attempt();
            }
            finish(resp);
          });
        });
      }

      attempt();
    };
    return true;
  }

  if (!install()) {
    var tries = 0;
    var timer = setInterval(function () {
      if (install() || ++tries > 100) clearInterval(timer);
    }, 50);
  }
})();
