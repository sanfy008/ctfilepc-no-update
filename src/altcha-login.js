/*
 * 城通网盘旧版客户端 - 密码登录安全验证补丁
 *
 * 服务端要求 3.6+ 客户端在密码登录时附带 altcha_token（PBKDF2 工作量证明）。
 * 本脚本在密码登录前自动获取挑战、求解并把 token 一并提交，不修改客户端其它逻辑。
 */
(function () {
  'use strict';

  var crypto = require('crypto');
  var https = require('https');
  var os = require('os');

  var CHALLENGE_URL = 'https://rest.ctfile.com/p8/public/captcha/altcha?act=login';
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

  function getToken(cb) {
    httpGetJson(CHALLENGE_URL + '&_=' + Date.now(), function (err, ch) {
      if (err || !ch || !ch.parameters || !ch.parameters.keyPrefix) {
        return cb(err || new Error('invalid challenge'));
      }
      solveChallenge(ch, cb);
    });
  }

  function setBusy(busy) {
    var btn = document.getElementById('user-login-act');
    if (!btn) return;
    if (busy) {
      if (!btn.getAttribute('data-orig-html')) {
        btn.setAttribute('data-orig-html', btn.innerHTML);
      }
      btn.disabled = true;
      btn.innerHTML = '安全验证中…';
    } else {
      btn.disabled = false;
      var orig = btn.getAttribute('data-orig-html');
      if (orig) btn.innerHTML = orig;
    }
  }

  function install() {
    if (typeof user === 'undefined' || !user || typeof user.apiCall !== 'function') {
      return false;
    }
    var origApiCall = user.apiCall;

    user.apiCall = function (item, action, data, callback) {
      if (item !== 'user_act' || action !== 'login' || !data || typeof data !== 'object') {
        return origApiCall.apply(this, arguments);
      }
      if (solving) return;
      solving = true;
      setBusy(true);

      var self = this;
      getToken(function (err, token) {
        solving = false;
        setBusy(false);
        if (token) data.altcha_token = token;
        origApiCall.call(self, item, action, data, function (resp) {
          if (token || !resp || resp.error_code !== 'LOGIN_CAPTCHA_REQUIRED') {
            return callback(resp);
          }
          // token 过期或已被使用：换一个再试一次
          solving = true;
          setBusy(true);
          getToken(function (err2, token2) {
            solving = false;
            setBusy(false);
            if (token2) data.altcha_token = token2;
            origApiCall.call(self, item, action, data, callback);
          });
        });
      });
    };
    return true;
  }

  if (!install()) {
    // login.js 尚未执行完时兜底
    var tries = 0;
    var timer = setInterval(function () {
      if (install() || ++tries > 100) clearInterval(timer);
    }, 50);
  }
})();
