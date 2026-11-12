# dsh-agy — 把 Antigravity CLI 接成 DSH 工具

把本机的 `agy`（Antigravity CLI）接成 DeepSeek Harness 的工具：一次调用 = 一个能自己读代码、写代码、跑命令、生图的子智能体。

## 它能干什么

- **派活**：`agy_run` 把一整件事交给 agy —— 读整个仓库、改多个文件、跑构建、生成图片 —— 再把结果和会话 id 带回来
- **接着聊**：同一个 `session` 名字永远接同一个会话，不需要记 uuid
- **管会话**：`agy_sessions` 列/搜本机全部会话，`agy_session` 改名、打标签、删除（软删进回收站，可恢复）
- **设置页**：在 DSH 设置里检查环境、跑 `agy install`、一键弹登录窗口、清会话

## 安装

从本目录装（开发用）：

```
plugin_manager install_bundle target=<本目录绝对路径>
```

从 GitHub 装：

```
plugin_manager install_bundle target=github:<用户名>/<仓库>
```

装完在 设置 → Antigravity CLI 里能看到这一页。

## 前置条件

本机要装好 Antigravity CLI，并且登录过。没装的话设置页会告诉你路径不存在；没登录的话点「打开登录窗口」，在弹出的终端里完成 Google 授权。

默认二进制路径：

- Windows：`%LOCALAPPDATA%\agy\bin\agy.exe`
- 其他：`agy`（PATH 中）

换路径改 `cordis.patch.yml` 里的 `config.bin`。

## 工具

| 工具 | 作用 |
|---|---|
| `agy_run` | 跑一轮 agy，可带 `session` 名字续会话 |
| `agy_sessions` | 列/搜本机会话 |
| `agy_session` | `info` / `label` / `rename` / `delete`（`purge` 彻底删） |
| `agy_agents` | 列出 agy 能用的 agent |
| `agy_models` | 列出 agy 能用的模型 |

## 设置页接口

宿主侧提供 `/dsh-agy/*`，Client 不碰磁盘：

```
GET  /dsh-agy/status          环境检查
POST /dsh-agy/install         跑 agy install
GET  /dsh-agy/sessions        全部会话 + 回收站
POST /dsh-agy/session/new     新建（同名则续）
POST /dsh-agy/session/rename  改名
POST /dsh-agy/session/delete  软删 / purge
POST /dsh-agy/session/restore 从回收站恢复
POST /dsh-agy/login/console   弹一个真终端去登录
```

## 已知限制

- agy 的等待窗口固定 60 秒，登录必须在这个窗口内完成，过时地址作废
- agy 只在**真终端**里读粘进去的验证码，管道读不到（实测：喂假码它完全不理，照样等满 60 秒）—— 所以「在这里粘码」这条路走不通，登录只能靠 `login/console` 弹一个真终端，用户在窗口里自己完成
- 这个插件不做账号池、不做 429 轮换，那些是 agy 自己的事

## 许可

MIT
