# ctfilepc-no-update

城通网盘旧版 Windows 客户端（NW.js 架构，如 `3.35`）的本地补丁：

1. **恢复账号密码登录**：绕过服务端“旧版本只能扫码登录”的限制，并自动完成新版客户端要求的 altcha 人机验证；
2. **禁用自动升级**：托盘菜单不再出现“点击升级”，升级函数被置空，不会启动 `xtupdate.exe`。

> 仅适用于 NW.js 旧架构客户端（目录中有 `nw.dll`、`html/com/login.js`）。官方新版 Electron 5.x 不需要本补丁。仓库不包含任何官方客户端文件。

## 原理

服务端在密码登录接口上做了两层校验：

- `version < 3.60` 直接返回 `403 当前版本只能扫码登录`；
- `version >= 3.60` 时要求附带 `altcha_token`（PBKDF2/SHA-256 工作量证明）。

补丁做了这些事：

- 版本号默认上报官方仍在维护的旧架构版本 `3.60.0`；如果服务端以“版本过低”拦截，会自动从官方版本接口读取最新版本号并重试（`login.js`、`main.js` 都会使用该值）；
- 登录时优先嵌入官方验证页 `https://h5.ctfile.com/captcha/<type>.html?source=p8&action=login`：altcha 在后台隐藏完成，换成图片/turnstile 时则弹出官方界面由用户完成，验证算法升级由官方页面自行处理；
- 官方验证页不可用时，回退到本地 PBKDF2 求解（向 `rest.ctfile.com/p8/public/captcha/altcha` 取挑战），生成 `altcha_token` 并随登录请求提交；令牌过期会自动换新重试；
- 让 `user.server_version` 始终等于本地版本，并接管 `app_upgrade()`，从而屏蔽升级入口；
- 把下载/上传列表的存储位置从“按登录 session”改为“按账号”，并在启动时合并最近 7 天因 session 变化而孤立的任务、自动续传未完成任务。

## 下载进度丢失修复

原客户端把任务列表存成 `<登录session>downfileItems.json`。每次重新登录 session 都会变，旧任务因此加载不到，表现为“强制退出后进度丢失、需要重新下载”。

补丁改为按账号固定为 `u_<username>_downfileItems.json`，并：

- 启动时合并最近 7 天内其他 session 文件中的任务（按任务 id 去重，保留进度更大的副本）；
- 自动续传保存状态为“下载中”（`pause=false` 且未完成）的任务，续传偏移以磁盘上已有文件大小为准；
- 每 5 秒保存一次列表，尽量保留最新进度。

> 副作用：最近 7 天内被中断的任务会重新出现在下载列表并自动继续；确实不再需要的任务手动删除即可。

## 安装

1. 关闭城通网盘客户端；
2. 以**管理员身份**打开 PowerShell，进入本目录；
3. 执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

客户端不在默认路径时：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ClientDir "D:\Program Files\城通网盘客户端"
```

安装脚本会备份原始文件到客户端的 `html\com\backup_orig\`，然后写入补丁。重复执行是安全的（不会重复插入脚本标签）。

4. 重新启动客户端，切到账号密码登录。点击登录后按钮会短暂显示“安全验证中…”，通常 1–3 秒完成验证。

## 恢复

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Restore
```

会从 `html\com\backup_orig\` 还原原始文件，并删除两个补丁脚本。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `src/altcha-login.js` | 登录前自动求解 altcha 工作量证明并注入 `altcha_token` |
| `src/no-upgrade.js` | 隐藏升级项并使 `app_upgrade()` 失效 |
| `install.ps1` | 安装 / 恢复脚本 |

## 注意事项

- 软件重装或手动运行官方升级包会覆盖补丁，需要重新执行 `install.ps1`；
- 登录时需要联网加载官方验证页/版本接口，首次验证通常 1–3 秒；若官方改为图片或 Turnstile 验证，会弹出验证框，需要手动完成；
- 若登录后仍提示“请完成安全验证”，再点一次登录即可（补丁只自动重试一次）；
- 版本伪装只用于通过旧版登录接口，不改变账号权限，也不会绕过服务端的其它安全校验；
- 服务端策略随时可能调整，本项目不保证长期有效。

## License

MIT
