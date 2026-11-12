# dsh-agy

把本机的 **Antigravity CLI（`agy`）** 接成 DeepSeek Harness 的工具：一次调用 = 一个能自己读代码、写代码、跑命令、生图的子智能体。

写完代码、审完仓库、生成图片之后，结果和**会话 id** 一起带回来；同一个名字接着聊，不用记 uuid。

---

## 它到底是干什么的

DSH 自己已经能开子智能体（`subagent` / `spawn_teammate`），但那些是**同一个模型开小号**。这个插件接的是**外面另一个 agent**：

| | DSH 自带的 subagent | 这个插件接的 agy |
|---|---|---|
| 谁在干活 | 同一个模型 | Antigravity CLI，另一个模型 |
| 能改文件吗 | 能，共享工作区 | 能，还能跑命令、生图 |
| 会话存在哪 | DSH 自己的会话 | agy 自己的会话库，可以续 |
| 适合干什么 | 省上下文的粗活 | 整仓重构、跨文件修改、出图 |

所以分工一般是：省 context 的活给 `subagent`，要多轮协作的给 `teammate`，**真动手改代码或者出图的丢给 agy，回来自己再验一遍**。

---

## 安装

### 前置条件

1. 本机装了 Antigravity CLI。Windows 默认在 `%LOCALAPPDATA%\agy\bin\agy.exe`，其他平台在 PATH 里叫 `agy`。
2. **已经登录过**（见下一节）。没登录的话所有工具都会报 `authentication failed`。

### 装插件

从本地目录装（开发用）：

```
plugin_manager install_bundle target=<这个目录的绝对路径>
```

从 GitHub 装：

```
plugin_manager install_bundle target=github:<用户名>/<仓库>
```

装完打开 **设置 → Antigravity CLI**，看到这一页就说明装好了。

### 确认能用

在设置页点「重新检查」，四行都应该对：

```
二进制路径   ...\agy.exe
是否存在     是
能否运行     能（agy help 正常返回）
会话数       22 个
```

---

## 登录

> 已经能跑 `agy -p test` 的可以跳过这一节。工具报 `authentication failed` 才需要看。

### 为什么只能在终端里做

Antigravity 的**桌面应用和命令行是两套独立账号**，桌面版登录了命令行不会跟着登录，`antigravity://` 这个系统协议也只指向桌面应用。

命令行的授权流程是：agy 打印一个地址 → 你在浏览器里同意 → 页面给一串验证码 → 这串验证码必须交回**发起这次授权的那个 agy 进程**。它只在真终端里读输入，所以整件事必须在一个终端窗口里从头做到尾。

### 操作步骤

1. 打开 **设置 → Antigravity CLI → 登录**，点 **「打开登录窗口」**
2. 弹出一个终端窗口（Windows Terminal），里面打印一长串 `https://accounts.google.com/...`
3. 复制这串地址，粘到浏览器地址栏打开
4. 选 Google 账号，同意授权
5. 页面最后会给一串验证码，复制它
6. 回到**刚才那个终端窗口**，粘贴，回车
7. 看到成功信息就关掉窗口；回设置页点「重新检查」，「能否运行」变成「能」就成了

### 三条硬约束

**① 只有 60 秒。**
从终端打印地址开始计时。超了窗口自动退出，得重新点「打开登录窗口」重来。建议先把浏览器开着，动作快一点。

**② 验证码只能给终端里那个进程。**
每个进程的授权参数是一次性的、只存在内存里。窗口关了、超时退出了，之前拿到的验证码就作废，必须重新来一遍。

**③ 这个插件不提供网页粘码。**
试过，不成立：把验证码通过管道喂给 agy，它完全不读，照样等满 60 秒然后报超时。所以设置页只有一个「打开登录窗口」按钮，没有输入框——那个框做出来也是假的。

### 判断登录成功

设置页「能否运行」显示「能」；或者随便调一次 `agy_run`，返回 `status: SUCCESS`。

---

## 用法

### 最常用：派一个活

```
agy_run({
  prompt: "读一下当前仓库，把 engine/runner.cpp 里的批处理参数补上文档注释，改完跑一遍 g++ 确认能编译。",
  cwd: "D:/Program/projects/AI_game",
  session: "ai_game 批处理"
})
```

返回：

```json
{
  "status": "SUCCESS",
  "response": "...",
  "conversationId": "423b02c0-...",
  "numTurns": 1,
  "durationSec": 41.2,
  "session": "ai_game 批处理"
}
```

### 接着上一次聊

同一个 `session` 名字再来一次，自动接上：

```
agy_run({ prompt: "刚才那个编译错误是怎么修的？", session: "ai_game 批处理" })
```

也可以直接给 `conversationId` 精确指定，或者 `continueLast: true` 按当前目录找上一次。

### 找会话

```
agy_sessions({ query: "AI_game" })     // 按标题/预览/名字/目录搜
agy_sessions({ limit: 50 })            // 全部
```

### 管会话

```
agy_session({ action: "info",   session: "ai_game 批处理" })
agy_session({ action: "rename", session: "旧名字", newLabel: "新名字" })
agy_session({ action: "label",  conversationId: "...", newLabel: "起个名" })
agy_session({ action: "delete", session: "ai_game 批处理" })            // 软删，进回收站
agy_session({ action: "delete", session: "ai_game 批处理", purge: true }) // 彻底删
```

软删会把会话库、`brain` 工作区、`annotations` 一起挪进 `~/.gemini/antigravity-cli/trash/<id>/`，同时清掉元数据缓存和目录映射，**可以恢复**（设置页回收站里点「放回」）。

### 高级参数

| 参数 | 说明 |
|---|---|
| `model` | 指定模型，先用 `agy_models` 看有哪些 |
| `effort` | `low` / `medium` / `high` / `xhigh` / `max`，越高越慢越细 |
| `mode` | `accept-edits` 只改文件 / `auto` 连命令一起跑 / `plan` 只出方案 |
| `agent` | 指定 agent 预设，先用 `agy_agents` 看 |
| `addDirs` | 额外挂进工作区的目录 |
| `timeoutSec` | 硬超时，超了杀整个进程树 |

---

## 设置页

**环境**：二进制路径、存不存在、能不能跑、会话数；「重新检查」和「运行 agy install」（跑 `agy install` 重置环境路径）。

**登录**：只有一个「打开登录窗口」按钮，见上面那一节。

**会话**：全部会话一次铺开，一行一个删除按钮。删是软删，回收站里可以「放回」或「彻底删」。

界面上**故意不放**「新建」和「改名」——那两个是派活时顺手用的，工具里有，不该占用户注意力。

---

## 配置

改 `cordis.patch.yml` 里的 `config`：

```yaml
- insert:
    - id: agy-runner
      name: 'dsh-agy'
      config:
        bin: 'C:\Users\you\AppData\Local\agy\bin\agy.exe'  # 二进制路径
        timeoutSec: 900                                    # 默认超时
        skipPermissions: true                              # 自动批准 agy 的工具调用
```

`skipPermissions: false` 时 agy 每次要动文件都会等你确认，适合在别人的机器上谨慎使用；自己机器上一般开 true。

---

## 接口

宿主侧提供 `/dsh-agy/*`，设置页通过它取数据，Client 不碰磁盘：

| 方法 | 路径 | 作用 | 界面上有入口吗 |
|---|---|---|---|
| GET | `/status` | 环境检查 | 有（重新检查） |
| POST | `/install` | 跑 `agy install` | 有（运行 agy install） |
| GET | `/sessions` | 全部会话 + 回收站（`?q=` 搜索） | 有（会话列表） |
| POST | `/session/delete` | 软删 / `purge` 彻底删 | 有（删除 / 彻底删） |
| POST | `/session/restore` | 从回收站恢复 | 有（放回） |
| POST | `/login/console` | 弹一个真终端去登录 | 有（打开登录窗口） |
| POST | `/session/new` | 新建（同名则续） | 没有，只给工具用 |
| POST | `/session/rename` | 改名 | 没有，只给工具用 |

---

## 已知限制

- **登录只能手动完成**：验证码必须交给真终端里那个进程，管道读不到，所以做不到「点一下就自动登录」，也没有网页输入框
- **60 秒窗口**：agy 自己的等待时间，改不了
- **不做账号池**：这个是「把 agy 当工具用」，不是「把 agy 的模型接成 LLM 供应商」。要多账号池、429 轮换那是另一类插件
- **会话元数据是只读的**：插件只读 agy 的 `conversation_metadata.json` 来展示，不负责生成它；删会话时会同步清理

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 所有工具报 `authentication failed` | 没登录，去设置页点「打开登录窗口」 |
| 点「打开登录窗口」没反应 | 确认 `bin` 路径对；或手动终端跑 `agy -p test` |
| 粘了验证码没反应 | 必须粘在弹出来的那个终端里，不是网页里 |
| 报 `会话 X 可能已被删除或失效` | 那个会话被删了，去掉 `session` 重新开一个 |
| 设置页看不到这一页 | 插件没被激活，查 profile 里 `include:agy-runner` 是否 enabled |

---

## 许可

MIT
