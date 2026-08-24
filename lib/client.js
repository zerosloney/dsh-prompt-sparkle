window.__ModuleLoader__.load({ id: 'dsh-prompt-sparkle', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

/**
 * dsh-prompt-sparkle 浏览器半边：在 composer 工具栏的模型选择器
 * （[data-slot="conversation.input.model"]）旁挂一个魔法棒图标按钮
 * （+ Ctrl/Cmd+Shift+E 快捷键），把当前草稿经 host 的 /sparkle 命令
 * （recordInput: false，草稿不落会话日志）用会话当前选定的模型重写为
 * 更清晰的提示词，然后原路写回输入框——React 受控组件经原生 value
 * setter + input 事件走 InputBar.onChange → keyboard.setDraft，撤销栈
 * 自动记录，Ctrl/Cmd+Z 可回退原草稿。
 *
 * Vanilla DOM on purpose：不向模块表请求任何东西。宿主上下文经模块级
 * inject 声明 sessions/remote 两个服务（未声明的服务属性访问会抛错）：
 * sessions.current 取当前会话 id，remote.commands.execute 发起程序化
 * 命令调用。只依赖 ui-conversation 的稳定 DOM 契约：
 * [data-slot="conversation.input.model"]（模型选择器挂载点）、
 * [data-composer-card] 与其内 textarea 的 data-phase 属性。
 */

var CSS_TEXT = [
  '[data-dsh-prompt-sparkle-btn]{flex:none;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;margin-inline-start:2px;border-radius:8px;background:transparent;color:var(--dsw-alias-fg-subtle,#9a9a9a);cursor:pointer;transition:background-color .15s ease,color .15s ease;}',
  '[data-dsh-prompt-sparkle-btn]:hover:not(:disabled){background:rgba(128,128,128,.14);color:var(--dsw-alias-fg-base,#242424);}',
  '[data-dsh-prompt-sparkle-btn]:focus-visible{outline:2px solid var(--dsw-alias-fg-base,#242424);outline-offset:1px;}',
  '[data-dsh-prompt-sparkle-btn]:disabled{opacity:.45;cursor:default;}',
  '[data-dsh-prompt-sparkle-btn][data-busy] svg{animation:dsh-prompt-sparkle-spin .9s linear infinite;}',
  '@keyframes dsh-prompt-sparkle-spin{to{transform:rotate(360deg);}}',
  '[data-dsh-prompt-sparkle-toast]{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);max-width:min(560px,80vw);padding:7px 14px;border-radius:10px;background:rgba(36,36,36,.92);color:#fafafa;font:var(--dsw-font-xxs-12,12px/normal system-ui,-apple-system,sans-serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:60;pointer-events:none;animation:dsh-prompt-sparkle-toast-in .18s ease-out both;}',
  '[data-dsh-prompt-sparkle-toast][data-kind="error"]{background:rgba(140,32,32,.94);}',
  '[data-dsh-prompt-sparkle-toast][data-hidden]{display:none;}',
  '@keyframes dsh-prompt-sparkle-toast-in{from{opacity:0;transform:translate(-50%,4px);}to{opacity:1;transform:translate(-50%,0);}}',
].join('\n')

var WAND_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>'

/** 草稿超过该字符数时拒绝润色（提示词重写场景远用不到）。 */
var MAX_DRAFT_CHARS = 100000

/** 会话处于这些 phase 时输入框只读，写回会被机器丢弃。 */
var BUSY_PHASES = { adjudicating: 1, submitting: 1, inert: 1 }

function injectStyles() {
  var tagId = 'dsh-prompt-sparkle/client.css'
  if (document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
    var tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-prompt-sparkle'
    tag.dataset.pluginCss = tagId
    tag.textContent = CSS_TEXT
    document.head.appendChild(tag)
  }
}

/** UTF-8 安全的 base64 编码（草稿可含任意语言与换行）。 */
function encodeDraft(text) {
  var bytes = new TextEncoder().encode(text)
  var bin = ''
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function apply(ctx) {
  injectStyles()

  var button = null
  var toast = null
  var toastTimer = 0
  var busy = false
  var bodyMo = null

  function showToast(text, kind) {
    if (toast === null) {
      toast = document.createElement('div')
      toast.dataset.dshPromptSparkleToast = ''
      document.body.appendChild(toast)
    }
    toast.textContent = text
    toast.dataset.kind = kind || 'info'
    toast.removeAttribute('data-hidden')
    if (toastTimer !== 0) clearTimeout(toastTimer)
    toastTimer = setTimeout(function () {
      toastTimer = 0
      toast.dataset.hidden = ''
    }, 2800)
  }

  function findComposer() {
    return document.querySelector('[data-composer-card]')
  }

  /** 当前草稿状态：{ el, text, disabled }；找不到输入框时 disabled。 */
  function draftState() {
    var card = findComposer()
    if (card === null) return { el: null, text: '', disabled: true }
    var el = card.querySelector('textarea')
    if (el === null) return { el: null, text: '', disabled: true }
    var phase = el.getAttribute('data-phase')
    return {
      el: el,
      text: el.value,
      disabled: BUSY_PHASES[phase] === 1 || el.disabled || el.readOnly,
    }
  }

  function currentSessionId() {
    // sessions 服务没有 .current 直读属性：当前会话在快照存储里
    // （list.current 为会话摘要对象或 id；selection 持久化 {sessionId}）。
    try {
      var sessions = ctx.sessions
      if (sessions === null || sessions === undefined) return undefined
      if (typeof sessions.list?.getSnapshot === 'function') {
        var snap = sessions.list.getSnapshot()
        var cur = snap === null || snap === undefined ? undefined : snap.current
        if (typeof cur === 'string' && cur !== '') return cur
        if (cur !== null && typeof cur === 'object') {
          if (typeof cur.id === 'string' && cur.id !== '') return cur.id
          if (typeof cur.sessionId === 'string' && cur.sessionId !== '') return cur.sessionId
        }
      }
      if (typeof sessions.selection?.getSnapshot === 'function') {
        var sel = sessions.selection.getSnapshot()
        if (sel !== null && typeof sel === 'object' && typeof sel.sessionId === 'string' && sel.sessionId !== '') {
          return sel.sessionId
        }
      }
    } catch (error) { /* 会话服务暂不可用：按无会话处理 */ }
    return undefined
  }

  function updateButton() {
    if (button === null) return
    var state = draftState()
    button.disabled = busy || state.disabled || state.text.trim() === '' || currentSessionId() === undefined
  }

  /** 受控组件写回：原生 setter + input 事件走 React onChange → 机器 setDraft。 */
  function writeDraft(textarea, text) {
    var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.setSelectionRange(text.length, text.length)
    textarea.focus({ preventScroll: true })
  }

  function runSparkle() {
    if (busy) return
    var sessionId = currentSessionId()
    var state = draftState()
    if (sessionId === undefined) { showToast('没有活跃会话', 'error'); return }
    if (state.el === null || state.disabled) return
    var draft = state.text
    if (draft.trim() === '') { showToast('草稿为空', 'error'); return }
    if (draft.length > MAX_DRAFT_CHARS) { showToast('草稿过长，请缩短后重试', 'error'); return }
    var remote = ctx.remote
    var execute = remote && remote.commands && remote.commands.execute
    if (typeof execute !== 'function') { showToast('命令通道不可用', 'error'); return }

    busy = true
    if (button !== null) { button.dataset.busy = ''; }
    updateButton()

    execute(sessionId, '/sparkle ' + encodeDraft(draft), []).then(function (result) {
      if (!result || result.ok !== true) {
        var message = result && result.error ? result.error.message : 'unknown'
        showToast('润色调用失败：' + message, 'error')
        return
      }
      var execution = result.value
      if (execution === undefined) {
        showToast('/sparkle 命令未注册（插件未加载？）', 'error')
        return
      }
      var outcome = execution.result
      if (outcome.kind === 'error') {
        showToast(outcome.text, 'error')
        return
      }
      if (typeof outcome.text === 'string' && outcome.text.length > 0) {
        // 会话可能在请求期间进入只读 span：重读一次，被挡住就不写。
        var fresh = draftState()
        if (fresh.el !== null && !fresh.disabled) {
          writeDraft(fresh.el, outcome.text)
          showToast('已润色 · Ctrl/Cmd+Z 撤销')
        } else {
          showToast('润色完成，但输入框当前只读，未写回', 'error')
        }
      }
    }, function (reason) {
      showToast('润色调用失败：' + (reason && reason.message ? reason.message : String(reason)), 'error')
    }).then(function () {
      busy = false
      if (button !== null) { delete button.dataset.busy }
      updateButton()
    })
  }

  function ensureButton() {
    // 锚点：模型选择器的 slot 容器；按钮插在它紧后面，与工具栏原生图标同排。
    var anchor = document.querySelector('[data-slot="conversation.input.model"]')
    if (anchor === null || anchor.parentElement === null) return
    var parent = anchor.parentElement
    if (button !== null && button.isConnected && button.parentElement === parent && anchor.nextElementSibling === button) {
      updateButton()
      return
    }
    if (button !== null) { button.remove(); button = null }
    button = document.createElement('button')
    button.type = 'button'
    button.dataset.dshPromptSparkleBtn = ''
    button.title = '润色提示词 (Ctrl/Cmd+Shift+E)'
    button.setAttribute('aria-label', '润色提示词')
    button.innerHTML = WAND_SVG
    // 按下不夺焦：与 composer 内置按钮同一惯例，输入连续性不受打断。
    button.addEventListener('mousedown', function (e) { e.preventDefault() })
    button.addEventListener('click', runSparkle)
    anchor.insertAdjacentElement('afterend', button)
    updateButton()
  }

  function onKeyDown(e) {
    if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
    if (e.key !== 'e' && e.key !== 'E') return
    if (e.nativeEvent ? e.nativeEvent.isComposing : e.isComposing) return
    if (busy) { e.preventDefault(); return }
    var state = draftState()
    if (state.el === null || state.disabled || state.text.trim() === '') return
    e.preventDefault()
    runSparkle()
  }

  function setup() {
    // React 在会话切换间会重挂 ConversationRoot；缓存的模型选择器锚点
    // 失效即重挂按钮，O(1) 守卫使无关重渲染保持免费。
    bodyMo = new MutationObserver(function () { ensureButton() })
    bodyMo.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('keydown', onKeyDown)
    ensureButton()
  }

  function teardown() {
    if (bodyMo !== null) bodyMo.disconnect()
    bodyMo = null
    document.removeEventListener('keydown', onKeyDown)
    if (button !== null) button.remove()
    button = null
    if (toast !== null) toast.remove()
    toast = null
    if (toastTimer !== 0) clearTimeout(toastTimer)
    toastTimer = 0
  }

  if (document.body === null) {
    document.addEventListener('DOMContentLoaded', function () {
      ctx.effect(function () { setup(); return teardown }, 'prompt-sparkle: composer button')
    }, { once: true })
  } else {
    ctx.effect(function () { setup(); return teardown }, 'prompt-sparkle: composer button')
  }
}

// 服务声明：ctx 上的服务属性（含 remote 下的嵌套命令空间）必须逐路径
// 列出，否则访问即抛错（cannot get property "remote.commands" without
// inject）。声明后 fiber 还会自动等这些服务就绪才跑 apply。
var inject = ['sessions', 'remote', 'remote.commands']

module.exports = { apply: apply, inject: inject }
return module.exports
} });
