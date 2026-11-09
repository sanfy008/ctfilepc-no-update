# ctfilepc-no-update

城通网盘旧版 Windows 客户端（NW.js 架构，如 `3.35`）的本地补丁：

1. **恢复账号密码登录**：绕过服务端“旧版本只能扫码登录”的限制，并自动完成新版客户端要求的 altcha 人机验证；
2. **禁用自动升级**：托盘菜单不再出现“点击升级”，升级函数被置空，不会启动 `xtupdate.exe`。

> 仅适用于 NW.js 旧架构客户端（目录中有 `nw.dll`、`html/com/login.js`）。官方新版 Electron 5.x 不需要本补丁。仓库不包含任何官方客户端文件。

## 原理

服务端在密码登录接口上做了两层校验：

- `version < 3.60` 直接返回 `403 当前版本只能扫码登录`；
- `version >= 3.60` 时要求附带 `altcha_token`（PBKDF2/SHA-256 工作量证明）。

补丁做了三件事：

- 把客户端上报的版本号改为官方仍在维护的旧架构版本 `3.60.0`（`login.js`、`main.js`）；
- 登录时向 `https://rest.ctfile.com/p8/public/captcha/altcha?act=login` 获取挑战，多线程搜索符合条件的 PBKDF2 计数器，生成 `altcha_token` 并随登录请求提交；令牌过期会自动换新重试；
- 让 `user.server_version` 始终等于本地版本，并接管 `app_upgrade()`，从而屏蔽升级入口。

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
- 若登录后仍提示“请完成安全验证”，再点一次登录即可（补丁只自动重试一次）；
- 版本伪装只用于通过旧版登录接口，不改变账号权限，也不会绕过服务端的其它安全校验；
- 服务端策略随时可能调整，本项目不保证长期有效。

## License

MIT
