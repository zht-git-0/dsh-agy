import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'agy'
export const inject = ['tools', 'webServer']

// agy（Antigravity CLI）默认装在这里；config.bin 可以覆盖。
const DEFAULT_BIN =
  process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe')
    : 'agy'

// agy 自己的会话资料：每个会话的标题、预览、最近修改、所属工作区
const AGY_ROOT = path.join(os.homedir(), '.gemini', 'antigravity-cli')
const META_FILE = path.join(AGY_ROOT, 'cache', 'conversation_metadata.json')
const LAST_FILE = path.join(AGY_ROOT, 'cache', 'last_conversations.json')
// 我自己的名字索引：label -> { id, cwd, updated }
const INDEX_FILE = path.join(os.homedir(), '.dsh', 'agy-sessions.json')

// 一个会话在磁盘上的三处痕迹：会话库、brain 工作区、标注
function sessionPaths(id) {
  return {
    db: path.join(AGY_ROOT, 'conversations', `${id}.db`),
    brain: path.join(AGY_ROOT, 'brain', id),
    annotations: path.join(AGY_ROOT, 'annotations', `${id}.pbtxt`),
  }
}

// 删会话先丢进 trash，不做不可撤销的删除
function trashDir() {
  return path.join(AGY_ROOT, 'trash')
}

function moveIntoTrash(source, id, label) {
  try {
    if (!fs.existsSync(source)) return null
    const dir = path.join(trashDir(), id)
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, `${label || 'item'}${path.extname(source) || ''}`)
    fs.renameSync(source, target)
    return target
  } catch {
    return null
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

function loadIndex() {
  const raw = readJson(INDEX_FILE, {})
  return raw && typeof raw === 'object' ? raw : {}
}

function saveIndex(index) {
  writeJson(INDEX_FILE, index)
}

function listKnownSessions() {
  const meta = readJson(META_FILE, {})?.conversations ?? {}
  const last = readJson(LAST_FILE, {}) ?? {}
  const index = loadIndex()

  const labels = {}
  for (const [label, entry] of Object.entries(index)) {
    if (entry?.id) labels[entry.id] = label
  }
  const cwdOf = {}
  for (const [cwd, id] of Object.entries(last)) {
    if (id && !cwdOf[id]) cwdOf[id] = cwd
  }

  const rows = Object.entries(meta).map(([id, value]) => {
    const s = value?.summary ?? {}
    const workspaces = Array.isArray(s.WorkspaceURIs)
      ? s.WorkspaceURIs.map((u) => {
          try {
            return decodeURIComponent(String(u).replace(/^file:\/\//, ''))
          } catch {
            return String(u)
          }
        })
      : []
    return {
      conversationId: id,
      label: labels[id],
      title: s.Title || '',
      preview: String(s.Preview ?? '').replace(/\s+/g, ' ').slice(0, 120),
      steps: s.NumSteps,
      updatedAt: value?.last_modified_time || s.UpdatedAt || '',
      workspaces,
      lastCwd: cwdOf[id],
    }
  })

  // 索引里有、但 agy 元数据里没有的（少见），也列出来
  for (const [label, entry] of Object.entries(index)) {
    if (!entry?.id || rows.some((r) => r.conversationId === entry.id)) continue
    rows.push({
      conversationId: entry.id,
      label,
      title: '',
      preview: '',
      updatedAt: entry.updated ?? '',
      workspaces: entry.cwd ? [entry.cwd] : [],
      lastCwd: entry.cwd,
    })
  }

  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  // 工具返回值必须是无损 JSON：抹掉 undefined / 非字符串字段
  return rows.map((row) => {
    const clean = {}
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined || value === null || value === '') continue
      clean[key] = value
    }
    return clean
  })
}

function asText(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

// 工具返回值必须是无损 JSON：递归去掉 undefined / null
function clean(value) {
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || entry === null) continue
      out[key] = clean(entry)
    }
    return out
  }
  return value
}

// 跑一次 agy。不经过 shell，参数数组直接交给 spawn，中文和空格都不会被拆坏。
function runProcess(bin, args, { cwd, timeoutSec = 900, input } = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    let child
    try {
      child = spawn(bin, args, {
        cwd: cwd || undefined,
        windowsHide: true,
        env: process.env,
      })
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error?.message ?? error), ms: 0, timedOut: false })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        /* 尽力而为 */
      }
    }, Math.max(5, timeoutSec) * 1000)

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}${error?.message ?? error}`, ms: Date.now() - started, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, ms: Date.now() - started, timedOut })
    })
    if (input) {
      try {
        child.stdin?.write(input)
        child.stdin?.end()
      } catch {
        /* ignore */
      }
    }
  })
}

function parseJsonOutput(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // agy 有时会在前面打日志行，从最后一个 '{' 起再试一次
    const at = text.lastIndexOf('{')
    if (at >= 0) {
      try {
        return JSON.parse(text.slice(at))
      } catch {
        return null
      }
    }
    return null
  }
}

export function apply(ctx, config = {}) {
  const bin = config.bin || DEFAULT_BIN
  const defaultTimeout = Number(config.timeoutSec) || 900
  const skipPermissions = config.skipPermissions !== false

  // ── 设置页用的 HTTP 接口 ────────────────────────────────────────────────
  function readBody(req) {
    return new Promise((resolve) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
        if (raw.length > 1_000_000) raw = raw.slice(0, 1_000_000)
      })
      req.on('end', () => resolve(raw))
      req.on('error', () => resolve(raw))
    })
  }

  function parseBody(raw) {
    try {
      const value = JSON.parse(raw || '{}')
      return value && typeof value === 'object' ? value : {}
    } catch {
      return {}
    }
  }

  function listTrash() {
    try {
      return fs
        .readdirSync(trashDir(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const dir = path.join(trashDir(), entry.name)
          let movedAt = ''
          try {
            movedAt = fs.statSync(dir).mtime.toISOString()
          } catch {}
          return { conversationId: entry.name, movedAt }
        })
    } catch {
      return []
    }
  }

  // 从 trash 里搬回去：文件名是按 kind 存的，位置可预测
  function restoreSession(id) {
    const dir = path.join(trashDir(), id)
    if (!fs.existsSync(dir)) return { ok: false, reason: 'trash 里没有这个会话' }
    const paths = sessionPaths(id)
    const moved = []
    const plan = [
      [path.join(dir, 'db.db'), paths.db],
      [path.join(dir, 'brain'), paths.brain],
      [path.join(dir, 'annotations.pbtxt'), paths.annotations],
    ]
    for (const [from, to] of plan) {
      if (!fs.existsSync(from)) continue
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.renameSync(from, to)
        moved.push(to)
      } catch {}
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
    return { ok: moved.length > 0, moved }
  }

  async function checkEnv() {
    const report = {
      bin,
      binExists: fs.existsSync(bin),
      agyRoot: AGY_ROOT,
      agyRootExists: fs.existsSync(AGY_ROOT),
      platform: process.platform,
      nodeVersion: process.version,
      checkedAt: new Date().toISOString(),
    }
    if (report.binExists) {
      const probe = await runProcess(bin, ['help'], { timeoutSec: 20 })
      report.runnable = probe.code === 0
      report.exitCode = probe.code
      report.firstLine = String(probe.stdout || probe.stderr || '').split('\n')[0].slice(0, 140)
    }
    try {
      report.conversations = listKnownSessions().length
    } catch {
      report.conversations = 0
    }
    try {
      report.indexed = Object.keys(loadIndex()).length
    } catch {
      report.indexed = 0
    }
    return clean(report)
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/dsh-agy',
        handler: async (req, res) => {
          const send = (status, body) => {
            if (res.destroyed || res.writableEnded) return
            res.writeHead(status, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(body))
          }
          const pathname = String(req.url ?? '/').split('?')[0].replace(/^\/dsh-agy/, '') || '/'
          try {
            if (pathname === '/' || pathname === '/status' || pathname === '/check') {
              return send(200, await checkEnv())
            }
            if (pathname === '/install') {
              if (!fs.existsSync(bin)) {
                return send(200, {
                  ok: false,
                  reason: 'missing',
                  bin,
                  hint: '本机没有 agy。先按官方方式装好 Antigravity CLI，再回来点检查。',
                })
              }
              const run = await runProcess(bin, ['install'], { timeoutSec: 180 })
              const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().slice(0, 4000)
              return send(200, clean({ ok: run.code === 0, exitCode: run.code, output }))
            }

            // ── 会话的增删改查 ──────────────────────────────────────────
            if (pathname === '/sessions') {
              const url = new URL(String(req.url ?? '/'), 'http://local')
              const q = String(url.searchParams.get('q') ?? '').toLowerCase().trim()
              const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500)
              let rows = listKnownSessions()
              if (q) {
                rows = rows.filter((row) =>
                  [row.label, row.title, row.preview, row.conversationId, ...(row.workspaces ?? []), row.lastCwd]
                    .filter(Boolean)
                    .some((field) => String(field).toLowerCase().includes(q)),
                )
              }
              return send(200, { total: rows.length, rows: rows.slice(0, limit), trash: listTrash() })
            }

            if (pathname === '/session/new') {
              const body = parseBody(await readBody(req))
              const prompt = String(body.prompt ?? '').trim()
              const label = String(body.session ?? '').trim()
              const cwd = body.cwd ? String(body.cwd) : undefined
              if (!prompt) return send(400, { error: 'prompt 不能为空' })
              const argv = ['-p', prompt, '--output-format', 'json']
              const existing = label ? loadIndex()[label]?.id : ''
              if (existing) argv.push('--conversation', String(existing))
              if (skipPermissions) argv.push('--dangerously-skip-permissions')
              const run = await runProcess(bin, argv, { cwd, timeoutSec: 180 })
              const parsed = parseJsonOutput(run.stdout)
              if (label && parsed?.conversation_id) {
                const index = loadIndex()
                index[label] = { id: String(parsed.conversation_id), cwd: cwd ?? null, updated: new Date().toISOString() }
                saveIndex(index)
              }
              return send(
                200,
                clean({
                  ok: run.code === 0 && parsed?.status === 'SUCCESS',
                  status: parsed?.status,
                  conversationId: parsed?.conversation_id,
                  response: String(parsed?.response ?? '').slice(0, 4000),
                  session: label || undefined,
                  resumed: existing ? true : undefined,
                  error: parsed ? undefined : String(run.stderr ?? '').slice(0, 800) || 'agy 没有返回可解析的结果',
                }),
              )
            }

            if (pathname === '/session/rename' || pathname === '/session/label') {
              const body = parseBody(await readBody(req))
              const id = String(body.conversationId ?? '').trim()
              const next = String(body.newLabel ?? '').trim()
              const prev = String(body.session ?? '').trim()
              if (!id) return send(400, { error: 'conversationId 不能为空' })
              if (!next) return send(400, { error: 'newLabel 不能为空' })
              const index = loadIndex()
              index[next] = { id, cwd: index[prev]?.cwd ?? null, updated: new Date().toISOString() }
              if (prev && prev !== next) delete index[prev]
              saveIndex(index)
              return send(200, clean({ ok: true, conversationId: id, from: prev || undefined, to: next }))
            }

            if (pathname === '/session/delete') {
              const body = parseBody(await readBody(req))
              const id = String(body.conversationId ?? '').trim()
              if (!id) return send(400, { error: 'conversationId 不能为空' })
              const paths = sessionPaths(id)
              let movedFiles = 0
              for (const [kind, source] of Object.entries(paths)) {
                if (moveIntoTrash(source, id, kind)) movedFiles += 1
              }
              const meta = readJson(META_FILE, null)
              if (meta?.conversations && meta.conversations[id]) {
                delete meta.conversations[id]
                writeJson(META_FILE, meta)
              }
              const last = readJson(LAST_FILE, null)
              if (last && typeof last === 'object') {
                let dirty = false
                for (const [cwd, cid] of Object.entries(last)) {
                  if (cid === id) {
                    delete last[cwd]
                    dirty = true
                  }
                }
                if (dirty) writeJson(LAST_FILE, last)
              }
              const index = loadIndex()
              const dropped = []
              for (const [name, entry] of Object.entries(index)) {
                if (entry?.id === id) {
                  delete index[name]
                  dropped.push(name)
                }
              }
              saveIndex(index)
              let purged = false
              if (body.purge) {
                try {
                  fs.rmSync(path.join(trashDir(), id), { recursive: true, force: true })
                  purged = true
                } catch {}
              }
              return send(
                200,
                clean({ ok: true, conversationId: id, movedFiles, droppedLabels: dropped.length ? dropped : undefined, purged }),
              )
            }

            if (pathname === '/session/restore') {
              const body = parseBody(await readBody(req))
              const id = String(body.conversationId ?? '').trim()
              if (!id) return send(400, { error: 'conversationId 不能为空' })
              return send(200, clean(restoreSession(id)))
            }

            if (pathname === '/login/console') {
              // agy 只在真终端里读「粘进来的验证码」，管道读不到（实测确认）。
              // 所以这条路是：弹一个真终端窗口，地址和粘码都在那个窗口里完成。
              // 用 cmd 的 start 开新控制台；PowerShell 的 Start-Process 从宿主里起不来窗口。
              try {
                spawn('cmd.exe', ['/c', 'start', '', bin, '-p', 'test'], {
                  detached: true,
                  stdio: 'ignore',
                  windowsHide: true,
                }).unref()
                return send(200, { ok: true, note: '已经弹出一个 agy 窗口，地址在那里面，验证码也粘回那个窗口' })
              } catch (error) {
                return send(500, { error: String(error?.message ?? error) })
              }
            }

            return send(404, { error: 'unknown path', pathname })
          } catch (error) {
            return send(500, { error: String(error?.message ?? error) })
          }
        },
      }),
    'dsh-agy: settings api',
  )

  ctx.tools.register({
    name: 'agy_run',
    description:
      'Run one non-interactive turn of agy (the Antigravity CLI agent) on this machine and return its final answer. ' +
      'agy is a separate coding agent: it can read and write files in the working directory, run shell commands, and generate images. ' +
      'Use it to delegate heavy multi-file work, whole-project review, or code generation, then verify its claims yourself. ' +
      'Pass conversationId (or continueLast) to keep talking in the same agy conversation.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'What agy should do. Write it as a complete brief: goal, constraints, and what to report back.',
        },
        cwd: {
          type: 'string',
          description: 'Working directory agy operates in. Omit to inherit the current session directory.',
        },
        conversationId: {
          type: 'string',
          description: 'Resume a previous agy conversation by id (returned by an earlier agy_run call).',
        },
        session: {
          type: 'string',
          description:
            'A stable name for this line of work, e.g. "fatal-lock 修 bug". The plugin keeps a name -> conversationId ' +
            'index, so the same name always resumes the same agy conversation; the first call with a new name starts one. ' +
            'Prefer this over raw conversationId for anything you will come back to.',
        },
        continueLast: {
          type: 'boolean',
          description: 'Continue the most recent agy conversation instead of starting a new one.',
        },
        model: { type: 'string', description: 'Model id for this run, e.g. "claude-sonnet-4.6". Omit for the default.' },
        effort: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'xhigh', 'max'],
          description: 'Reasoning effort. Higher is slower and more thorough.',
        },
        mode: {
          type: 'string',
          enum: ['accept-edits', 'auto', 'plan'],
          description: 'Execution mode: accept-edits writes files, auto also runs commands, plan only plans.',
        },
        agent: { type: 'string', description: 'Agent preset name, from agy_agents.' },
        addDirs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Extra directories to add to the workspace.',
        },
        timeoutSec: {
          type: 'number',
          description: 'Hard timeout in seconds. The process tree is killed when it expires.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { status: { type: 'string' }, response: { type: 'string' } } },
      render: (_args, value) => asText(value),
    },
    async execute(args) {
      const prompt = String(args?.prompt ?? '')
      if (!prompt.trim()) throw new Error('prompt is required')

      const argv = ['-p', prompt, '--output-format', 'json']

      // 三种定位会话的方式，优先级：conversationId > session 名字 > continueLast
      const index = loadIndex()
      const label = typeof args?.session === 'string' ? args.session.trim() : ''
      const byLabel = label && index[label]?.id ? String(index[label].id) : ''
      const resumeId = args?.conversationId ? String(args.conversationId) : byLabel
      if (resumeId) argv.push('--conversation', resumeId)
      else if (args?.continueLast) argv.push('--continue')
      if (args?.model) argv.push('--model', String(args.model))
      if (args?.effort) argv.push('--effort', String(args.effort))
      if (args?.mode) argv.push('--mode', String(args.mode))
      if (args?.agent) argv.push('--agent', String(args.agent))
      for (const dir of Array.isArray(args?.addDirs) ? args.addDirs : []) {
        if (dir) argv.push('--add-dir', String(dir))
      }
      if (skipPermissions) argv.push('--dangerously-skip-permissions')

      const timeoutSec = Number(args?.timeoutSec) || defaultTimeout
      const result = await runProcess(bin, argv, { cwd: args?.cwd, timeoutSec })
      const parsed = parseJsonOutput(result.stdout)

      if (!parsed) {
        return {
          status: result.timedOut ? 'TIMEOUT' : result.code === 0 ? 'UNPARSED' : 'ERROR',
          response: String(result.stdout ?? '').slice(0, 20000),
          stderr: String(result.stderr ?? '').slice(0, 4000),
          exitCode: result.code,
          elapsedSec: Number((result.ms / 1000).toFixed(1)),
        }
      }

      const out = {
        status: result.timedOut ? 'TIMEOUT' : (parsed.status ?? (result.code === 0 ? 'SUCCESS' : 'ERROR')),
        response: String(parsed.response ?? ''),
        conversationId: parsed.conversation_id,
        numTurns: parsed.num_turns,
        usage: parsed.usage,
        durationSec: parsed.duration_seconds,
        exitCode: result.code,
      }
      // 丢掉 undefined：工具返回值必须是无损 JSON
      for (const key of Object.keys(out)) {
        if (out[key] === undefined) delete out[key]
      }
      const err = String(result.stderr ?? '').trim()
      if (err) out.stderr = err.slice(0, 2000)

      // 接不上旧会话时给个明确提示，别让人以为是自己写错了
      if (resumeId && out.status !== 'SUCCESS' && !String(out.response ?? '').trim()) {
        out.hint = `会话 ${resumeId} 可能已被删除或失效：去掉 session / conversationId 再跑一次就会新开一个。`
      }

      // 记名字索引：下次用同一个 session 就能接上这次
      if (label && out.conversationId) {
        const idx = loadIndex()
        idx[label] = {
          id: String(out.conversationId),
          cwd: args?.cwd ?? null,
          updated: new Date().toISOString(),
        }
        saveIndex(idx)
        out.session = label
      }
      return out
    },
  })

  ctx.tools.register({
    name: 'agy_session',
    description:
      'Manage one agy conversation. action "info" shows it; "label" attaches a name to an existing conversationId; ' +
      '"rename" moves a saved name to a new one; "delete" removes it (the session db, its brain workspace and its ' +
      'annotations move into the agy trash folder, so it is reversible until purge:true). ' +
      'Identify the session by `conversationId` or by a saved `session` name.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['info', 'label', 'rename', 'delete'] },
        conversationId: { type: 'string', description: 'Exact conversation id.' },
        session: { type: 'string', description: 'Saved name of the conversation.' },
        newLabel: { type: 'string', description: 'For "label" and "rename": the name to attach.' },
        purge: {
          type: 'boolean',
          description: 'With "delete": also permanently remove the trash copy. Default false (reversible).',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, action: { type: 'string' } } },
      render: (_args, value) => asText(value),
    },
    async execute(args) {
      const action = String(args?.action ?? '')
      const index = loadIndex()
      const label = String(args?.session ?? '').trim()
      const id = String(args?.conversationId ?? (label && index[label]?.id ? index[label].id : '')).trim()
      if (!id) throw new Error('pass conversationId or a session name that is already in the index')

      const rows = listKnownSessions()
      const row = rows.find((r) => r.conversationId === id) ?? { conversationId: id }

      if (action === 'info') {
        return { ok: true, action, session: rows.find((r) => r.conversationId === id) ?? { conversationId: id } }
      }

      if (action === 'label') {
        const name = String(args?.newLabel ?? '').trim()
        if (!name) throw new Error('newLabel is required for action "label"')
        index[name] = { id, cwd: index[label]?.cwd ?? null, updated: new Date().toISOString() }
        if (label && label !== name) delete index[label]
        saveIndex(index)
        return { ok: true, action, conversationId: id, session: name }
      }

      if (action === 'rename') {
        const name = String(args?.newLabel ?? '').trim()
        if (!label) throw new Error('session (the old name) is required for action "rename"')
        if (!name) throw new Error('newLabel is required for action "rename"')
        index[name] = { ...index[label], id, updated: new Date().toISOString() }
        delete index[label]
        saveIndex(index)
        return { ok: true, action, conversationId: id, from: label, to: name }
      }

      if (action === 'delete') {
        const paths = sessionPaths(id)
        const moved = []
        for (const [kind, source] of Object.entries(paths)) {
          const target = moveIntoTrash(source, id, kind)
          if (target) moved.push({ kind, from: source, to: target })
        }

        // 抹掉 agy 自己的元数据缓存里这一条
        const meta = readJson(META_FILE, null)
        if (meta?.conversations && meta.conversations[id]) {
          delete meta.conversations[id]
          writeJson(META_FILE, meta)
        }
        // 抹掉「每个目录上次用哪个会话」里指向它的映射
        const last = readJson(LAST_FILE, null)
        if (last && typeof last === 'object') {
          let dirty = false
          for (const [cwd, cid] of Object.entries(last)) {
            if (cid === id) {
              delete last[cwd]
              dirty = true
            }
          }
          if (dirty) writeJson(LAST_FILE, last)
        }
        // 抹掉我自己的名字索引
        let droppedLabels = []
        for (const [name, entry] of Object.entries(index)) {
          if (entry?.id === id) {
            delete index[name]
            droppedLabels.push(name)
          }
        }
        saveIndex(index)

        let purged = false
        if (args?.purge) {
          try {
            fs.rmSync(path.join(trashDir(), id), { recursive: true, force: true })
            purged = true
          } catch {
            purged = false
          }
        }

        return clean({
          ok: true,
          action,
          conversationId: id,
          title: row.title || undefined,
          movedFiles: moved.length,
          movedTo: moved.length ? path.join(trashDir(), id) : undefined,
          droppedLabels: droppedLabels.length ? droppedLabels : undefined,
          purged,
          note: purged ? 'trash copy removed as well' : 'reversible: files are in the agy trash folder',
        })
      }

      throw new Error(`unknown action: ${action}`)
    },
  })

  ctx.tools.register({
    name: 'agy_sessions',
    description:
      'List agy conversations known on this machine: conversation id, the label you saved it under, title, preview, ' +
      'when it last changed, and which workspace directories it was used in. Filter with `query` (matches title, ' +
      'preview, label or workspace path) to find the one a job belongs to before resuming it.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Case-insensitive substring matched against label, title, preview and workspace path.',
        },
        limit: { type: 'number', description: 'How many rows to return, default 20.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { rows: { type: 'array' } } },
      render: (_args, value) => asText(value),
    },
    async execute(args) {
      const q = String(args?.query ?? '').toLowerCase().trim()
      const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100)
      let rows = listKnownSessions()
      if (q) {
        rows = rows.filter((r) =>
          [r.label, r.title, r.preview, r.conversationId, ...(r.workspaces ?? []), r.lastCwd]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(q)),
        )
      }
      return { total: rows.length, rows: rows.slice(0, limit) }
    },
  })

  ctx.tools.register({
    name: 'agy_agents',
    description: 'List the agents agy can run (their names are what agy_run takes as `agent`).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } } },
      render: (_args, value) => asText(value),
    },
    async execute() {
      const result = await runProcess(bin, ['agents'], { timeoutSec: 60 })
      return {
        status: result.code === 0 ? 'OK' : 'ERROR',
        text: String(result.stdout ?? '').slice(0, 8000) || String(result.stderr ?? '').slice(0, 2000),
      }
    },
  })

  ctx.tools.register({
    name: 'agy_models',
    description: 'List the models agy can run (their ids are what agy_run takes as `model`).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } } },
      render: (_args, value) => asText(value),
    },
    async execute() {
      const result = await runProcess(bin, ['models'], { timeoutSec: 60 })
      return {
        status: result.code === 0 ? 'OK' : 'ERROR',
        text: String(result.stdout ?? '').slice(0, 8000) || String(result.stderr ?? '').slice(0, 2000),
      }
    },
  })
}
