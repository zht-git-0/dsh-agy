/**
 * dsh-agy — 设置页（Client 半边）。
 *
 * 两段：环境检查（装没装、能不能跑、一键 install）+ 会话列表（全量展示，只给删除）。
 * 「增」和「改名」故意不放界面：派活的时候用工具做，界面上用户只需要清会话。
 * 数据走宿主 /dsh-agy/* 接口，Client 不碰磁盘。
 * 注册 id 必须等于包名 dsh-agy，否则 ModuleLoader 会报没注册。
 */
window.__ModuleLoader__.load({
  id: 'dsh-agy',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'
    const S = {
      panel: { display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px', fontSize: 13 },
      head: { display: 'flex', flexDirection: 'column', gap: 4 },
      title: { fontSize: 15, fontWeight: 600 },
      sub: { opacity: 0.62, fontSize: 12.5, lineHeight: 1.55 },
      card: {
        border: '1px solid rgba(127,127,127,0.22)',
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      },
      row: { display: 'flex', gap: 12, alignItems: 'baseline', lineHeight: 1.6 },
      key: { width: 128, flex: '0 0 auto', opacity: 0.6, fontSize: 12.5 },
      val: { wordBreak: 'break-all', fontFamily: mono, fontSize: 12.5 },
      bar: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
      btn: {
        appearance: 'none',
        border: '1px solid rgba(127,127,127,0.32)',
        background: 'transparent',
        color: 'inherit',
        borderRadius: 8,
        padding: '5px 12px',
        fontSize: 12.5,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      btnPrimary: { borderColor: 'rgba(80,140,255,0.6)', color: 'rgba(80,140,255,1)' },
      btnDanger: { borderColor: 'rgba(217,83,79,0.55)', color: 'rgba(217,83,79,1)' },
      tr: {
        display: 'grid',
        gridTemplateColumns: '1.6fr 1.8fr 1.2fr auto',
        gap: 10,
        alignItems: 'center',
        padding: '7px 0',
        borderTop: '1px solid rgba(127,127,127,0.14)',
      },
      th: { opacity: 0.55, fontSize: 12, paddingBottom: 2 },
      name: { fontWeight: 500, wordBreak: 'break-word' },
      dim: { opacity: 0.6, fontSize: 12, wordBreak: 'break-word' },
      out: {
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: 12,
        lineHeight: 1.55,
        maxHeight: 200,
        overflow: 'auto',
        fontFamily: mono,
        border: '1px solid rgba(127,127,127,0.18)',
        borderRadius: 8,
        padding: '8px 10px',
      },
      ok: { color: '#2f9e62' },
      bad: { color: '#d9534f' },
    }

    async function api(pathname, options) {
      const res = await fetch('/dsh-agy' + pathname, Object.assign({ cache: 'no-store' }, options))
      const text = await res.text()
      let body
      try {
        body = JSON.parse(text)
      } catch {
        body = { error: text.slice(0, 300) }
      }
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status)
      return body
    }

    function Row({ k, v, tone }) {
      return h(
        'div',
        { style: S.row },
        h('div', { style: S.key }, k),
        h('div', { style: Object.assign({}, S.val, tone || null) }, v),
      )
    }

    function EnvCard() {
      const [state, setState] = React.useState({ loading: true, data: null, error: '' })
      const [busy, setBusy] = React.useState(false)
      const [output, setOutput] = React.useState('')

      const load = React.useCallback(async () => {
        setState((s) => Object.assign({}, s, { loading: true, error: '' }))
        try {
          const data = await api('/status')
          setState({ loading: false, data, error: '' })
        } catch (error) {
          setState({ loading: false, data: null, error: String((error && error.message) || error) })
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const install = async () => {
        setBusy(true)
        setOutput('')
        try {
          const body = await api('/install', { method: 'POST' })
          setOutput(body.output || body.hint || JSON.stringify(body))
          await load()
        } catch (error) {
          setOutput(String((error && error.message) || error))
        }
        setBusy(false)
      }

      const d = state.data || {}
      const okBin = d.binExists === true
      const okRun = d.runnable === true

      return h(
        'div',
        { style: S.card },
        h(
          'div',
          { style: S.head },
          h('div', { style: S.title }, '环境'),
          h('div', { style: S.sub }, 'agy（Antigravity CLI）装在哪、能不能跑。装好之后下面那些会话才读得到。'),
        ),
        h(Row, { k: '二进制路径', v: d.bin || '（未配置）' }),
        h(Row, { k: '是否存在', v: okBin ? '是' : '否', tone: okBin ? S.ok : S.bad }),
        h(Row, {
          k: '能否运行',
          v: !okBin ? '—' : okRun ? '能（agy help 正常返回）' : '不能',
          tone: okBin ? (okRun ? S.ok : S.bad) : null,
        }),
        h(Row, { k: '会话目录', v: d.agyRoot || '—' }),
        h(Row, {
          k: '会话数',
          v: d.conversations === undefined ? '—' : String(d.conversations) + ' 个',
        }),
        h(
          'div',
          { style: S.bar },
          h(
            'button',
            { style: Object.assign({}, S.btn, S.btnPrimary), onClick: load, disabled: state.loading },
            state.loading ? '检查中…' : '重新检查',
          ),
          h('button', { style: S.btn, onClick: install, disabled: busy || !okBin }, busy ? '执行中…' : '运行 agy install'),
        ),
        state.error ? h('div', { style: Object.assign({}, S.out, S.bad) }, '检查失败：' + state.error) : null,
        output ? h('div', { style: S.out }, output) : null,
      )
    }

    function LoginCard() {
      const [msg, setMsg] = React.useState('')

      const openWindow = async () => {
        setMsg('')
        try {
          const body = await api('/login/console', { method: 'POST' })
          setMsg(body.ok ? '窗口已经弹出来了，去那个窗口里操作。' : '打不开窗口：' + (body.error || ''))
        } catch (error) {
          setMsg('打不开窗口：' + String((error && error.message) || error))
        }
      }

      return h(
        'div',
        { style: S.card },
        h(
          'div',
          { style: S.head },
          h('div', { style: S.title }, '登录'),
          h(
            'div',
            { style: S.sub },
            'agy 用自己的 Google 授权，桌面版和命令行是两套账号，不能互相带。点下面弹一个真终端窗口，它会把授权地址打印在窗口里；在浏览器里同意完，把拿到的验证码粘回那个窗口就行。整个过程要在 60 秒内完成。',
          ),
        ),
        h(
          'div',
          { style: S.bar },
          h('button', { style: Object.assign({}, S.btn, S.btnPrimary), onClick: openWindow }, '打开登录窗口'),
        ),
        h(
          'div',
          { style: S.dim },
          '为什么不在这里直接粘码：agy 只在真终端里读输入，走管道它不认。这个我实测过。',
        ),
        msg ? h('div', { style: S.out }, msg) : null,
      )
    }

    function SessionList() {
      const [rows, setRows] = React.useState([])
      const [trash, setTrash] = React.useState([])
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [loaded, setLoaded] = React.useState(false)

      const load = React.useCallback(async () => {
        try {
          const body = await api('/sessions?limit=500')
          setRows(body.rows || [])
          setTrash(body.trash || [])
          setLoaded(true)
        } catch (error) {
          setMsg('读取失败：' + String((error && error.message) || error))
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const remove = async (row) => {
        const label = row.label || row.title || row.conversationId
        if (!window.confirm('把「' + label + '」删掉？会先进回收站，可以恢复。')) return
        setBusy(row.conversationId)
        setMsg('')
        try {
          await api('/session/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ conversationId: row.conversationId }),
          })
          await load()
        } catch (error) {
          setMsg('删除失败：' + String((error && error.message) || error))
        }
        setBusy('')
      }

      const restore = async (item) => {
        setBusy(item.conversationId)
        setMsg('')
        try {
          await api('/session/restore', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ conversationId: item.conversationId }),
          })
          await load()
        } catch (error) {
          setMsg('恢复失败：' + String((error && error.message) || error))
        }
        setBusy('')
      }

      const purge = async (item) => {
        if (!window.confirm('彻底删掉这个会话？删完就找不回来了。')) return
        setBusy(item.conversationId)
        try {
          await api('/session/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ conversationId: item.conversationId, purge: true }),
          })
          await load()
        } catch (error) {
          setMsg('彻底删除失败：' + String((error && error.message) || error))
        }
        setBusy('')
      }

      return h(
        'div',
        { style: S.card },
        h(
          'div',
          { style: S.head },
          h('div', { style: S.title }, '会话（' + rows.length + '）'),
          h('div', { style: S.sub }, '全部列在这里。删是软删——先丢进回收站，想起来了还能放回来。'),
        ),
        msg ? h('div', { style: Object.assign({}, S.out, S.bad) }, msg) : null,
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column' } },
          h(
            'div',
            { style: Object.assign({}, S.tr, S.th) },
            h('div', null, '名字 / 标题'),
            h('div', null, '预览'),
            h('div', null, '目录'),
            h('div', null, ''),
          ),
          !loaded
            ? h('div', { style: { padding: '10px 0', opacity: 0.6 } }, '读取中…')
            : rows.length === 0
              ? h('div', { style: { padding: '10px 0', opacity: 0.6 } }, '没有会话')
              : rows.map((row) =>
                  h(
                    'div',
                    { key: row.conversationId, style: S.tr },
                    h(
                      'div',
                      null,
                      h('div', { style: S.name }, row.label || row.title || '（未命名）'),
                      h('div', { style: S.dim }, row.updatedAt ? new Date(row.updatedAt).toLocaleString() : ''),
                    ),
                    h('div', { style: S.dim }, (row.preview || '').slice(0, 100)),
                    h('div', { style: S.dim }, (row.workspaces && row.workspaces[0]) || row.lastCwd || '—'),
                    h(
                      'button',
                      { style: Object.assign({}, S.btn, S.btnDanger), onClick: () => remove(row), disabled: !!busy },
                      busy === row.conversationId ? '删…' : '删除',
                    ),
                  ),
                ),
        ),
        trash.length
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 } },
              h('div', { style: S.dim }, '回收站（' + trash.length + '）'),
              trash.map((item) =>
                h(
                  'div',
                  { key: item.conversationId, style: Object.assign({}, S.tr, { gridTemplateColumns: '2.4fr 1fr auto auto' }) },
                  h('div', { style: S.dim }, item.conversationId),
                  h('div', { style: S.dim }, item.movedAt ? new Date(item.movedAt).toLocaleString() : ''),
                  h('button', { style: S.btn, onClick: () => restore(item), disabled: !!busy }, '放回'),
                  h(
                    'button',
                    { style: Object.assign({}, S.btn, S.btnDanger), onClick: () => purge(item), disabled: !!busy },
                    '彻底删',
                  ),
                ),
              ),
            )
          : null,
      )
    }

    function AgyPanel() {
      return h('div', { style: S.panel }, h(EnvCard), h(LoginCard), h(SessionList))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = typeof ctx.get === 'function' ? ctx.get('slots') : ctx.slots
        if (!slots) return
        slots.inject('settings.section', () =>
          slots.register({ name: 'settings.section', id: 'agy', order: 30, label: 'Antigravity CLI' }, () => h(AgyPanel)),
        )
      },
    }
  },
})
