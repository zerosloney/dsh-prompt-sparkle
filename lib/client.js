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

var FONT_SYSTEM = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'
var FONT_MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

var CSS_TEXT = [
  /* 按钮与基础动效 */
  '[data-dsh-prompt-sparkle-btn]{flex:none;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;margin-inline-start:2px;border-radius:8px;background:transparent;color:var(--dsw-alias-fg-subtle,#9a9a9a);cursor:pointer;transition:background-color .15s ease,color .15s ease;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}',
  '[data-dsh-prompt-sparkle-btn]:hover:not(:disabled){background:rgba(128,128,128,.14);color:var(--dsw-alias-fg-base,#242424);}',
  '[data-dsh-prompt-sparkle-btn]:focus-visible{outline:2px solid var(--dsw-alias-fg-base,#242424);outline-offset:1px;}',
  '[data-dsh-prompt-sparkle-btn]:disabled:not([data-busy]){opacity:.45;cursor:default;}',
  '[data-dsh-prompt-sparkle-btn][data-busy]{opacity:.9;cursor:wait;}',
  '[data-dsh-prompt-sparkle-btn][data-busy] svg{animation:dsh-prompt-sparkle-spin .85s linear infinite;color:var(--dsw-alias-accent,var(--dsw-alias-primary,var(--dsw-alias-fg-base,#242424)));}',
  '@keyframes dsh-prompt-sparkle-spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}',

  /* Toast 样式 */
  '[data-dsh-prompt-sparkle-toast]{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);max-width:min(560px,80vw);padding:7px 14px;border-radius:10px;z-index:60;pointer-events:auto;display:inline-flex;align-items:center;gap:10px;animation:dsh-prompt-sparkle-toast-in .18s ease-out both;font:var(--dsw-font-xxs-12,12px/1.4 ' + FONT_SYSTEM + ');white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;backface-visibility:hidden;}',
  '@keyframes dsh-prompt-sparkle-toast-in{from{opacity:0;transform:translate(-50%,4px);}to{opacity:1;transform:translate(-50%,0);}}',
  '[data-dsh-prompt-sparkle-toast][data-hidden]{display:none;}',
  '[data-dsh-prompt-sparkle-toast-action]{padding:2px 8px;border-radius:6px;border:0;font:inherit;font-weight:500;cursor:pointer;transition:background .15s ease;}',

  /* Toast - 浅色简约主题 */
  '[data-dsh-prompt-sparkle-toast][data-theme="light"]{background:#ffffff;color:#1e293b;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,.09),0 2px 6px rgba(0,0,0,.04);}',
  '[data-dsh-prompt-sparkle-toast][data-theme="light"][data-kind="error"]{background:#fef2f2;color:#b91c1c;border-color:#fecaca;}',
  '[data-dsh-prompt-sparkle-toast][data-theme="light"] [data-dsh-prompt-sparkle-toast-action]{background:#f1f5f9;color:#0f172a;}',
  '[data-dsh-prompt-sparkle-toast][data-theme="light"] [data-dsh-prompt-sparkle-toast-action]:hover{background:#e2e8f0;}',

  /* Toast - 深色主题 */
  '[data-dsh-prompt-sparkle-toast][data-theme="dark"]{background:rgba(36,36,36,.96);color:#fafafa;box-shadow:0 4px 12px rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.1);}',
  '[data-dsh-prompt-sparkle-toast][data-theme="dark"][data-kind="error"]{background:rgba(140,32,32,.94);}',
  '[data-dsh-prompt-sparkle-toast][data-theme="dark"] [data-dsh-prompt-sparkle-toast-action]{background:rgba(255,255,255,.18);color:#fff;}',
  '[data-dsh-prompt-sparkle-toast][data-theme="dark"] [data-dsh-prompt-sparkle-toast-action]:hover{background:rgba(255,255,255,.32);}',

  /* 右键菜单基础结构 */
  '[data-dsh-prompt-sparkle-menu]{position:fixed;border-radius:10px;padding:6px;z-index:90;display:flex;flex-direction:column;gap:3px;min-width:215px;animation:dsh-prompt-sparkle-toast-in .14s ease-out both;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;backface-visibility:hidden;}',
  '[data-dsh-prompt-sparkle-menu-header]{padding:4px 8px 6px;font:var(--dsw-font-xxs-11,11.5px/1.4 ' + FONT_SYSTEM + ');font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;}',
  '[data-dsh-prompt-sparkle-menu-divider]{height:1px;margin:4px 2px;}',
  '[data-dsh-prompt-sparkle-menu-item]{padding:6px 10px;border-radius:6px;border:0;background:transparent;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:2px;transition:background .12s ease,color .12s ease;}',
  '[data-dsh-prompt-sparkle-menu-item] .item-name{font:var(--dsw-font-xxs-12,12px/1.4 ' + FONT_SYSTEM + ');font-weight:500;}',
  '[data-dsh-prompt-sparkle-menu-item] .item-desc{font-size:11.5px;line-height:1.35;}',

  /* 右键菜单 - 浅色简约 */
  '[data-dsh-prompt-sparkle-menu][data-theme="light"]{background:rgba(255,255,255,.98);border:1px solid #e2e8f0;box-shadow:0 12px 30px rgba(0,0,0,.1),0 2px 6px rgba(0,0,0,.04);}',
  '[data-dsh-prompt-sparkle-menu][data-theme="light"] [data-dsh-prompt-sparkle-menu-header]{color:#475569;border-bottom:1px solid #f1f5f9;}',
  '[data-dsh-prompt-sparkle-menu][data-theme="light"] [data-dsh-prompt-sparkle-menu-divider]{background:#e2e8f0;}',
  '[data-dsh-prompt-sparkle-menu][data-theme="light"] [data-dsh-prompt-sparkle-menu-item]{color:#1e293b;}',
  '[data-dsh-prompt-sparkle-menu][data-theme="light"] [data-dsh-prompt-sparkle-menu-item]:hover{background:#f1f5f9;color:#0f172a;}',
  '[data-dsh-prompt-sparkle-menu][data-theme="light"] [data-dsh-prompt-sparkle-menu-item][data-active]{background:#e2e8f0;color:#0f172a;}',
  '[data-dsh-prompt-sparkle-menu][data-theme="light"] [data-dsh-prompt-sparkle-menu-item] .item-desc{color:#64748b;}',
  '[data-dsh-prompt-sparkle-menu][data-theme="light"] [data-dsh-prompt-sparkle-menu-item]:hover .item-desc,[data-dsh-prompt-sparkle-menu][data-theme="light"] [data-dsh-prompt-sparkle-menu-item][data-active] .item-desc{color:#334155;}',

  /* 右键菜单 - 深色主题 */
  '[data-dsh-prompt-sparkle-menu][data-theme="dark"]{background:rgba(30,30,30,.96);border:1px solid rgba(255,255,255,.14);box-shadow:0 10px 28px rgba(0,0,0,.35);}',
  '[data-dsh-prompt-sparkle-menu][data-theme="dark"] [data-dsh-prompt-sparkle-menu-header]{color:rgba(255,255,255,.65);border-bottom:1px solid rgba(255,255,255,.08);}',
  '[data-dsh-prompt-sparkle-menu][data-theme="dark"] [data-dsh-prompt-sparkle-menu-divider]{background:rgba(255,255,255,.1);}',
  '[data-dsh-prompt-sparkle-menu][data-theme="dark"] [data-dsh-prompt-sparkle-menu-item]{color:#f1f5f9;}',
  '[data-dsh-prompt-sparkle-menu][data-theme="dark"] [data-dsh-prompt-sparkle-menu-item]:hover{background:rgba(255,255,255,.12);color:#fff;}',
  '[data-dsh-prompt-sparkle-menu][data-theme="dark"] [data-dsh-prompt-sparkle-menu-item][data-active]{background:rgba(255,255,255,.18);color:#fff;}',
  '[data-dsh-prompt-sparkle-menu][data-theme="dark"] [data-dsh-prompt-sparkle-menu-item] .item-desc{color:rgba(255,255,255,.72);}',
  '[data-dsh-prompt-sparkle-menu][data-theme="dark"] [data-dsh-prompt-sparkle-menu-item]:hover .item-desc,[data-dsh-prompt-sparkle-menu][data-theme="dark"] [data-dsh-prompt-sparkle-menu-item][data-active] .item-desc{color:rgba(255,255,255,.9);}',

  /* Modal 基础结构 */
  '[data-dsh-prompt-sparkle-modal-backdrop]{position:fixed;inset:0;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:100;display:flex;align-items:center;justify-content:center;animation:dsh-prompt-sparkle-fade-in .15s ease-out both;}',
  '@keyframes dsh-prompt-sparkle-fade-in{from{opacity:0;}to{opacity:1;}}',
  '[data-dsh-prompt-sparkle-modal]{border-radius:14px;width:min(580px,92vw);max-height:85vh;display:flex;flex-direction:column;font:var(--dsw-font-xs-13,13px/1.5 ' + FONT_SYSTEM + ');animation:dsh-prompt-sparkle-scale-in .18s cubic-bezier(.16,1,.3,1) both;overflow:hidden;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;backface-visibility:hidden;}',
  '@keyframes dsh-prompt-sparkle-scale-in{from{opacity:0;transform:scale(.95);}to{opacity:1;transform:scale(1);}}',
  '[data-dsh-prompt-sparkle-modal-header]{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;font-weight:600;font-size:14px;}',
  '[data-dsh-prompt-sparkle-modal-close]{background:transparent;border:0;font-size:18px;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1;transition:all .15s;}',
  '[data-dsh-prompt-sparkle-modal-body]{padding:16px 18px;overflow-y:auto;display:flex;flex-direction:column;gap:16px;flex:1;}',
  '.dsh-sparkle-field-group{display:flex;flex-direction:column;gap:8px;}',
  '.dsh-sparkle-field-title{font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;}',
  '.dsh-sparkle-row{display:flex;align-items:center;gap:10px;}',
  '.dsh-sparkle-input{flex:1;border-radius:6px;padding:7px 10px;font:inherit;font-size:12px;outline:none;transition:border-color .15s,background-color .15s;}',
  '.dsh-sparkle-textarea{width:100%;min-height:72px;resize:vertical;border-radius:6px;padding:8px 10px;font:inherit;font-size:12px;outline:none;line-height:1.45;box-sizing:border-box;transition:border-color .15s,background-color .15s;}',
  '.dsh-sparkle-select{border-radius:6px;padding:7px 10px;font:inherit;font-size:12px;outline:none;cursor:pointer;transition:border-color .15s,background-color .15s;}',
  '.dsh-sparkle-checkbox-label{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:12px;}',
  '.dsh-sparkle-checkbox-label input[type="checkbox"]{cursor:pointer;accent-color:var(--dsw-alias-accent,#2563eb);}',
  '.dsh-sparkle-range-wrap{display:flex;align-items:center;gap:12px;}',
  '.dsh-sparkle-range-wrap input[type="range"]{flex:1;accent-color:var(--dsw-alias-accent,#2563eb);cursor:pointer;}',
  '.dsh-sparkle-hint{font-size:12px;line-height:1.4;}',
  '[data-dsh-prompt-sparkle-modal-footer]{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;}',
  '.dsh-sparkle-btn-group{display:flex;align-items:center;gap:8px;}',
  '.dsh-sparkle-btn{padding:7px 15px;border-radius:6px;border:0;font:inherit;font-size:12px;font-weight:500;cursor:pointer;transition:all .15s;}',
  '.dsh-sparkle-diff-box{display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1;}',
  '.dsh-sparkle-diff-col{display:flex;flex-direction:column;gap:6px;}',
  '.dsh-sparkle-diff-col-title{font-size:11.5px;font-weight:600;text-transform:uppercase;}',
  '.dsh-sparkle-diff-content{flex:1;border-radius:8px;padding:10px;font-family:' + FONT_MONO + ';font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;overflow-y:auto;max-height:360px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}',

  /* Modal - 浅色简约主题 (Light Minimalist) */
  '[data-dsh-prompt-sparkle-modal-backdrop][data-theme="light"]{background:rgba(15,23,42,.35);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"]{background:#ffffff;color:#1e293b;border:1px solid #e2e8f0;box-shadow:0 20px 45px rgba(0,0,0,.12),0 4px 12px rgba(0,0,0,.04);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] [data-dsh-prompt-sparkle-modal-header]{border-bottom:1px solid #f1f5f9;color:#0f172a;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] [data-dsh-prompt-sparkle-modal-close]{color:#64748b;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] [data-dsh-prompt-sparkle-modal-close]:hover{background:#f1f5f9;color:#0f172a;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-field-title{color:#475569;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-input,[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-select,[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-textarea{background:#f8fafc;border:1px solid #cbd5e1;color:#0f172a;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-input:focus,[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-select:focus,[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-textarea:focus{border-color:#2563eb;background:#ffffff;box-shadow:0 0 0 2px rgba(37,99,235,.15);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-hint{color:#64748b;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] [data-dsh-prompt-sparkle-modal-footer]{background:#f8fafc;border-top:1px solid #f1f5f9;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-btn-subtle{background:transparent;color:#64748b;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-btn-subtle:hover{background:#e2e8f0;color:#0f172a;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-btn-secondary{background:#e2e8f0;color:#1e293b;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-btn-secondary:hover{background:#cbd5e1;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-btn-primary{background:#2563eb;color:#ffffff;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-btn-primary:hover{background:#1d4ed8;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-diff-col-title{color:#64748b;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-diff-content.original{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="light"] .dsh-sparkle-diff-content.polished{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;}',

  /* Modal - 深色质感主题 (Dark Mode) */
  '[data-dsh-prompt-sparkle-modal-backdrop][data-theme="dark"]{background:rgba(0,0,0,.68);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"]{background:var(--dsw-alias-bg-panel,#202020);color:var(--dsw-alias-fg-base,#f1f5f9);border:1px solid rgba(255,255,255,.14);box-shadow:0 16px 40px rgba(0,0,0,.5);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] [data-dsh-prompt-sparkle-modal-header]{border-bottom:1px solid rgba(255,255,255,.1);color:#fff;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] [data-dsh-prompt-sparkle-modal-close]{color:rgba(255,255,255,.7);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] [data-dsh-prompt-sparkle-modal-close]:hover{background:rgba(255,255,255,.12);color:#fff;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-field-title{color:rgba(255,255,255,.75);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-input,[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-select,[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-textarea{background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.16);color:#fff;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-input:focus,[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-select:focus,[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-textarea:focus{border-color:var(--dsw-alias-accent,#4f8cff);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-hint{color:rgba(255,255,255,.68);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] [data-dsh-prompt-sparkle-modal-footer]{background:rgba(0,0,0,.2);border-top:1px solid rgba(255,255,255,.1);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-btn-subtle{background:transparent;color:rgba(255,255,255,.75);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-btn-subtle:hover{background:rgba(255,255,255,.1);color:#fff;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-btn-secondary{background:rgba(255,255,255,.12);color:#fff;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-btn-secondary:hover{background:rgba(255,255,255,.2);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-btn-primary{background:var(--dsw-alias-accent,#3880ff);color:#fff;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-btn-primary:hover{opacity:.9;}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-diff-col-title{color:rgba(255,255,255,.65);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-diff-content.original{color:rgba(255,255,255,.8);background:rgba(255,100,100,.04);border:1px solid rgba(255,100,100,.2);}',
  '[data-dsh-prompt-sparkle-modal][data-theme="dark"] .dsh-sparkle-diff-content.polished{color:#a3e635;background:rgba(163,230,53,.04);border:1px solid rgba(163,230,53,.25);}',
].join('\n')

var WAND_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>'

var STYLES = [
  { id: 'standard', name: '⚡ 默认精炼', desc: '去芜存菁，清晰直接' },
  { id: 'structured', name: '🧱 结构化模版', desc: '角色/任务/约束/格式' },
  { id: 'english', name: '🌐 英文优化', desc: '地道专业英文提示词' },
  { id: 'cot', name: '🧠 思维链引导', desc: '引导逐步推理与验证' },
]

var CONFIG_KEY = 'dsh-prompt-sparkle-config-v2'

var DEFAULT_CONFIG = {
  uiTheme: 'light',
  defaultStyle: 'standard',
  enableFastModel: false,
  fastProvider: '',
  fastModel: '',
  temperature: 0.3,
  maxTokens: 1024,
  timeoutMs: 15000,
  diffPreview: false,
  autoCopy: false,
  customPrompt: '',
}

function loadConfig() {
  try {
    var raw = localStorage.getItem(CONFIG_KEY)
    if (raw) {
      var parsed = JSON.parse(raw)
      return Object.assign({}, DEFAULT_CONFIG, parsed)
    }
  } catch (e) {}
  var oldStyle = localStorage.getItem('dsh-prompt-sparkle-style')
  if (oldStyle) {
    return Object.assign({}, DEFAULT_CONFIG, { defaultStyle: oldStyle })
  }
  return Object.assign({}, DEFAULT_CONFIG)
}

function saveConfig(conf) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(conf))
    localStorage.setItem('dsh-prompt-sparkle-style', conf.defaultStyle)
  } catch (e) {}
}

function getEffectiveTheme(conf) {
  var t = conf && conf.uiTheme ? conf.uiTheme : 'light'
  if (t === 'light') return 'light'
  if (t === 'dark') return 'dark'
  if (document.body && document.body.hasAttribute('data-ds-dark-theme')) return 'dark'
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

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
  var menu = null
  var toast = null
  var toastTimer = 0
  var busy = false
  var bodyMo = null

  function showToast(text, kind, action) {
    var conf = loadConfig()
    var theme = getEffectiveTheme(conf)

    if (toast === null) {
      toast = document.createElement('div')
      toast.dataset.dshPromptSparkleToast = ''
      document.body.appendChild(toast)
    }
    toast.dataset.theme = theme
    toast.innerHTML = ''
    var textNode = document.createElement('span')
    textNode.textContent = text
    toast.appendChild(textNode)

    if (action && typeof action.label === 'string' && typeof action.onClick === 'function') {
      var actionBtn = document.createElement('button')
      actionBtn.type = 'button'
      actionBtn.dataset.dshPromptSparkleToastAction = ''
      actionBtn.textContent = action.label
      actionBtn.addEventListener('mousedown', function (e) { e.preventDefault() })
      actionBtn.addEventListener('click', function (e) {
        e.stopPropagation()
        action.onClick()
      })
      toast.appendChild(actionBtn)
    }

    toast.dataset.kind = kind || 'info'
    toast.removeAttribute('data-hidden')
    if (toastTimer !== 0) clearTimeout(toastTimer)
    toastTimer = setTimeout(function () {
      toastTimer = 0
      toast.dataset.hidden = ''
    }, action ? 4200 : 2800)
  }

  function closeMenu() {
    if (menu !== null) {
      menu.remove()
      menu = null
      document.removeEventListener('click', closeMenu)
      document.removeEventListener('contextmenu', onDocContextMenu)
    }
  }

  function onDocContextMenu(e) {
    if (menu !== null && !menu.contains(e.target) && e.target !== button) {
      closeMenu()
    }
  }

  function openSettingsModal() {
    var conf = loadConfig()
    var theme = getEffectiveTheme(conf)

    var modalBackdrop = document.createElement('div')
    modalBackdrop.dataset.dshPromptSparkleModalBackdrop = ''
    modalBackdrop.dataset.theme = theme

    var modal = document.createElement('div')
    modal.dataset.dshPromptSparkleModal = ''
    modal.dataset.theme = theme

    var header = document.createElement('div')
    header.dataset.dshPromptSparkleModalHeader = ''
    header.innerHTML = '<span>⚙️ 润色与提示词增强设置</span>'
    var closeBtn = document.createElement('button')
    closeBtn.dataset.dshPromptSparkleModalClose = ''
    closeBtn.textContent = '✕'
    closeBtn.onclick = function () { modalBackdrop.remove() }
    header.appendChild(closeBtn)
    modal.appendChild(header)

    var body = document.createElement('div')
    body.dataset.dshPromptSparkleModalBody = ''

    body.innerHTML = [
      '<div class="dsh-sparkle-field-group">',
      '  <div class="dsh-sparkle-field-title">界面视觉风格 (UI Theme)</div>',
      '  <select class="dsh-sparkle-select" id="sparkle-cfg-theme">',
      '    <option value="light">☀️ 浅色简约 (Light Minimalist)</option>',
      '    <option value="dark">🌙 深色质感 (Dark Mode)</option>',
      '    <option value="auto">🌗 自动跟随宿主主题 (Auto / System)</option>',
      '  </select>',
      '</div>',
      '<div class="dsh-sparkle-field-group">',
      '  <div class="dsh-sparkle-field-title">默认润色风格</div>',
      '  <select class="dsh-sparkle-select" id="sparkle-cfg-style">',
      '    <option value="standard">⚡ 默认精炼 (清晰紧凑)</option>',
      '    <option value="structured">🧱 结构化模版 (Role/Task/Context/Constraints)</option>',
      '    <option value="english">🌐 英文优化 (地道专业英文)</option>',
      '    <option value="cot">🧠 思维链引导 (逐步推理分析)</option>',
      '  </select>',
      '</div>',
      '<div class="dsh-sparkle-field-group">',
      '  <div class="dsh-sparkle-field-title">极速轻量模型路由 (Fast Route)</div>',
      '  <label class="dsh-sparkle-checkbox-label">',
      '    <input type="checkbox" id="sparkle-cfg-fast-enabled">',
      '    <span>优先走独立极速模型 (避免思考模型等待)</span>',
      '  </label>',
      '  <div class="dsh-sparkle-field-group" style="margin-top:4px;">',
      '    <div class="dsh-sparkle-hint" style="font-weight:500;margin-bottom:2px;">从当前环境已配置的可用模型中快速选择：</div>',
      '    <select class="dsh-sparkle-select" id="sparkle-cfg-fast-select" style="width:100%;">',
      '      <option value="">-- 从 DSH 可用模型中选择 (自动填充) --</option>',
      '    </select>',
      '  </div>',
      '  <div class="dsh-sparkle-row" id="sparkle-cfg-fast-row">',
      '    <input class="dsh-sparkle-input" id="sparkle-cfg-fast-provider" placeholder="Provider (如 deepseek)">',
      '    <input class="dsh-sparkle-input" id="sparkle-cfg-fast-model" placeholder="Model (如 deepseek-chat)">',
      '  </div>',
      '  <div class="dsh-sparkle-hint">未勾选或未填写时，将自动跟随当前会话选定的模型。</div>',
      '</div>',
      '<div class="dsh-sparkle-field-group">',
      '  <div class="dsh-sparkle-field-title">采样与生成参数</div>',
      '  <div class="dsh-sparkle-range-wrap">',
      '    <span style="font-size:12px;">温度:</span>',
      '    <input type="range" id="sparkle-cfg-temp" min="0" max="1" step="0.05">',
      '    <span id="sparkle-cfg-temp-val" style="font-weight:600;min-width:28px;"></span>',
      '  </div>',
      '  <div class="dsh-sparkle-row">',
      '    <span style="font-size:12px;">Token 上限:</span>',
      '    <input class="dsh-sparkle-input" type="number" id="sparkle-cfg-tokens" style="width:100px;">',
      '  </div>',
      '</div>',
      '<div class="dsh-sparkle-field-group">',
      '  <div class="dsh-sparkle-field-title">交互与写回体验</div>',
      '  <label class="dsh-sparkle-checkbox-label">',
      '    <input type="checkbox" id="sparkle-cfg-diff">',
      '    <span>开启 Diff 差异对比预览 (先在浮层预览再决定采纳)</span>',
      '  </label>',
      '  <label class="dsh-sparkle-checkbox-label">',
      '    <input type="checkbox" id="sparkle-cfg-autocopy">',
      '    <span>润色完成后自动复制到剪贴板</span>',
      '  </label>',
      '</div>',
      '<div class="dsh-sparkle-field-group">',
      '  <div class="dsh-sparkle-field-title">自定义系统提示词 (可选覆盖)</div>',
      '  <textarea class="dsh-sparkle-textarea" id="sparkle-cfg-prompt" placeholder="留空时按上方风格预设执行；填写后将优先使用此自定义提示词"></textarea>',
      '</div>',
    ].join('\n')

    modal.appendChild(body)

    var selTheme = body.querySelector('#sparkle-cfg-theme')
    var selStyle = body.querySelector('#sparkle-cfg-style')
    var chkFast = body.querySelector('#sparkle-cfg-fast-enabled')
    var selFastModel = body.querySelector('#sparkle-cfg-fast-select')
    var inpProvider = body.querySelector('#sparkle-cfg-fast-provider')
    var inpModel = body.querySelector('#sparkle-cfg-fast-model')
    var fastRow = body.querySelector('#sparkle-cfg-fast-row')
    var rngTemp = body.querySelector('#sparkle-cfg-temp')
    var txtTempVal = body.querySelector('#sparkle-cfg-temp-val')
    var inpTokens = body.querySelector('#sparkle-cfg-tokens')
    var chkDiff = body.querySelector('#sparkle-cfg-diff')
    var chkAutoCopy = body.querySelector('#sparkle-cfg-autocopy')
    var txtPrompt = body.querySelector('#sparkle-cfg-prompt')

    selTheme.value = conf.uiTheme || 'light'
    selStyle.value = conf.defaultStyle || 'standard'
    chkFast.checked = !!conf.enableFastModel
    inpProvider.value = conf.fastProvider || ''
    inpModel.value = conf.fastModel || ''
    rngTemp.value = conf.temperature !== undefined ? conf.temperature : 0.3
    txtTempVal.textContent = Number(rngTemp.value).toFixed(2)
    inpTokens.value = conf.maxTokens || 1024
    chkDiff.checked = !!conf.diffPreview
    chkAutoCopy.checked = !!conf.autoCopy
    txtPrompt.value = conf.customPrompt || ''

    // 动态拉取并填充当前 DSH 环境中所有已配置的可用模型
    var populateModels = function () {
      var sid = currentSessionId()
      var apiSessions = (ctx.connection && ctx.connection.api && ctx.connection.api.sessions)
        || (ctx.remote && ctx.remote.api && ctx.remote.api.sessions)
      var apiLlm = (ctx.connection && ctx.connection.api && ctx.connection.api.llm)
        || (ctx.remote && ctx.remote.api && ctx.remote.api.llm)

      var renderGroups = function (groups) {
        if (!groups || groups.length === 0) return false
        selFastModel.innerHTML = '<option value="">-- 从 DSH 已配置模型中选择 (自动填充) --</option>'
        var count = 0
        groups.forEach(function (group) {
          var models = group.models || []
          if (models.length === 0) return
          var optGroup = document.createElement('optgroup')
          optGroup.label = group.name || group.displayName || group.id || 'Provider'
          models.forEach(function (m) {
            var mId = typeof m === 'string' ? m : (m.id || m.model || m.name)
            var mName = typeof m === 'string' ? m : (m.name || m.id || mId)
            var gId = group.id || group.provider || 'deepseek'
            var opt = document.createElement('option')
            opt.value = gId + '::' + mId
            opt.textContent = mName + ' (' + gId + ' / ' + mId + ')'
            if (gId === inpProvider.value && mId === inpModel.value) {
              opt.selected = true
            }
            optGroup.appendChild(opt)
            count++
          })
          selFastModel.appendChild(optGroup)
        })
        return count > 0
      }

      // 先立即渲染 DSH 官方核心模型，确保随时秒开可选
      var defaultDshGroups = [
        {
          id: 'deepseek',
          name: 'DeepSeek 官方模型',
          models: [
            { id: 'deepseek-chat', name: 'DeepSeek-Chat / V3 (极速推荐)' },
            { id: 'deepseek-reasoner', name: 'DeepSeek-Reasoner / R1 (深度推理)' },
          ]
        }
      ]
      renderGroups(defaultDshGroups)

      // 异步探测当前会话与提供商，动态补充已配置的其他模型
      var loadPromise = null
      if (sid && apiSessions && typeof apiSessions.models === 'function') {
        loadPromise = apiSessions.models({ sessionId: sid }).then(function (res) {
          if (res && res.result && res.result.ok && res.result.value && res.result.value.groups && res.result.value.groups.length > 0) {
            return renderGroups(res.result.value.groups)
          }
          return false
        }).catch(function () { return false })
      } else {
        loadPromise = Promise.resolve(false)
      }

      loadPromise.then(function (ok) {
        if (ok) return
        if (apiLlm && typeof apiLlm.providers === 'function') {
          return apiLlm.providers({}).then(function (res) {
            if (res && res.result && res.result.ok && res.result.value && res.result.value.providers && res.result.value.providers.length > 0) {
              return renderGroups(res.result.value.providers)
            }
            return false
          }).catch(function () { return false })
        }
        return false
      })
    }
    populateModels()

    selFastModel.onchange = function () {
      if (!selFastModel.value) return
      var parts = selFastModel.value.split('::')
      if (parts.length === 2) {
        inpProvider.value = parts[0]
        inpModel.value = parts[1]
        chkFast.checked = true
        updateFastState()
      }
    }

    inpProvider.oninput = function () {
      if (inpProvider.value.trim() !== '' || inpModel.value.trim() !== '') {
        chkFast.checked = true
        updateFastState()
      }
    }
    inpModel.oninput = function () {
      if (inpProvider.value.trim() !== '' || inpModel.value.trim() !== '') {
        chkFast.checked = true
        updateFastState()
      }
    }

    var updateFastState = function () {
      var enabled = chkFast.checked
      fastRow.style.opacity = enabled ? '1' : '0.65'
      inpProvider.disabled = false
      inpModel.disabled = false
      selFastModel.disabled = false
    }
    updateFastState()
    chkFast.onchange = updateFastState

    selTheme.onchange = function () {
      var nextTheme = getEffectiveTheme({ uiTheme: selTheme.value })
      modalBackdrop.dataset.theme = nextTheme
      modal.dataset.theme = nextTheme
    }

    rngTemp.oninput = function () {
      txtTempVal.textContent = Number(rngTemp.value).toFixed(2)
    }

    var footer = document.createElement('div')
    footer.dataset.dshPromptSparkleModalFooter = ''

    var resetBtn = document.createElement('button')
    resetBtn.className = 'dsh-sparkle-btn dsh-sparkle-btn-subtle'
    resetBtn.textContent = '恢复默认'
    resetBtn.onclick = function () {
      selTheme.value = DEFAULT_CONFIG.uiTheme
      selStyle.value = DEFAULT_CONFIG.defaultStyle
      chkFast.checked = DEFAULT_CONFIG.enableFastModel
      inpProvider.value = DEFAULT_CONFIG.fastProvider
      inpModel.value = DEFAULT_CONFIG.fastModel
      rngTemp.value = DEFAULT_CONFIG.temperature
      txtTempVal.textContent = Number(DEFAULT_CONFIG.temperature).toFixed(2)
      inpTokens.value = DEFAULT_CONFIG.maxTokens
      chkDiff.checked = DEFAULT_CONFIG.diffPreview
      chkAutoCopy.checked = DEFAULT_CONFIG.autoCopy
      txtPrompt.value = DEFAULT_CONFIG.customPrompt
      updateFastState()
      selTheme.onchange()
    }

    var rightGroup = document.createElement('div')
    rightGroup.className = 'dsh-sparkle-btn-group'

    var cancelBtn = document.createElement('button')
    cancelBtn.className = 'dsh-sparkle-btn dsh-sparkle-btn-secondary'
    cancelBtn.textContent = '取消'
    cancelBtn.onclick = function () { modalBackdrop.remove() }

    var saveBtn = document.createElement('button')
    saveBtn.className = 'dsh-sparkle-btn dsh-sparkle-btn-primary'
    saveBtn.textContent = '保存设置'
    saveBtn.onclick = function () {
      var nextConf = {
        uiTheme: selTheme.value,
        defaultStyle: selStyle.value,
        enableFastModel: chkFast.checked,
        fastProvider: inpProvider.value.trim(),
        fastModel: inpModel.value.trim(),
        temperature: parseFloat(rngTemp.value) || 0.3,
        maxTokens: parseInt(inpTokens.value, 10) || 1024,
        timeoutMs: conf.timeoutMs || 15000,
        diffPreview: chkDiff.checked,
        autoCopy: chkAutoCopy.checked,
        customPrompt: txtPrompt.value.trim(),
      }
      saveConfig(nextConf)
      modalBackdrop.remove()
      updateButton()
      showToast('设置已保存并生效')
    }

    rightGroup.appendChild(cancelBtn)
    rightGroup.appendChild(saveBtn)

    footer.appendChild(resetBtn)
    footer.appendChild(rightGroup)
    modal.appendChild(footer)

    modalBackdrop.appendChild(modal)
    document.body.appendChild(modalBackdrop)

    modalBackdrop.onclick = function (e) {
      if (e.target === modalBackdrop) modalBackdrop.remove()
    }
  }

  function openDiffPreview(original, polished, isPartial, selRange) {
    var conf = loadConfig()
    var theme = getEffectiveTheme(conf)

    var modalBackdrop = document.createElement('div')
    modalBackdrop.dataset.dshPromptSparkleModalBackdrop = ''
    modalBackdrop.dataset.theme = theme

    var modal = document.createElement('div')
    modal.dataset.dshPromptSparkleModal = ''
    modal.dataset.theme = theme
    modal.style.width = 'min(720px, 94vw)'

    var header = document.createElement('div')
    header.dataset.dshPromptSparkleModalHeader = ''
    header.innerHTML = '<span>📝 润色结果差异对比' + (isPartial ? ' (局部选区)' : '') + '</span>'
    var closeBtn = document.createElement('button')
    closeBtn.dataset.dshPromptSparkleModalClose = ''
    closeBtn.textContent = '✕'
    closeBtn.onclick = function () { modalBackdrop.remove() }
    header.appendChild(closeBtn)
    modal.appendChild(header)

    var body = document.createElement('div')
    body.dataset.dshPromptSparkleModalBody = ''
    body.innerHTML = [
      '<div class="dsh-sparkle-diff-box">',
      '  <div class="dsh-sparkle-diff-col">',
      '    <div class="dsh-sparkle-diff-col-title">原草稿内容</div>',
      '    <div class="dsh-sparkle-diff-content original"></div>',
      '  </div>',
      '  <div class="dsh-sparkle-diff-col">',
      '    <div class="dsh-sparkle-diff-col-title">✨ 润色后提示词</div>',
      '    <div class="dsh-sparkle-diff-content polished"></div>',
      '  </div>',
      '</div>',
    ].join('\n')
    body.querySelector('.dsh-sparkle-diff-content.original').textContent = original
    body.querySelector('.dsh-sparkle-diff-content.polished').textContent = polished
    modal.appendChild(body)

    var footer = document.createElement('div')
    footer.dataset.dshPromptSparkleModalFooter = ''

    var leftDiv = document.createElement('div')
    var copyBtn = document.createElement('button')
    copyBtn.className = 'dsh-sparkle-btn dsh-sparkle-btn-secondary'
    copyBtn.textContent = '📋 仅复制'
    copyBtn.onclick = function () {
      if (navigator.clipboard) navigator.clipboard.writeText(polished)
      showToast('已复制润色结果')
    }
    leftDiv.appendChild(copyBtn)

    var rightDiv = document.createElement('div')
    rightDiv.className = 'dsh-sparkle-btn-group'

    var discardBtn = document.createElement('button')
    discardBtn.className = 'dsh-sparkle-btn dsh-sparkle-btn-subtle'
    discardBtn.textContent = '放弃'
    discardBtn.onclick = function () { modalBackdrop.remove() }

    var applyBtn = document.createElement('button')
    applyBtn.className = 'dsh-sparkle-btn dsh-sparkle-btn-primary'
    applyBtn.textContent = '✔ 采纳写回 (Enter)'
    applyBtn.onclick = function () {
      modalBackdrop.remove()
      var fresh = draftState()
      if (fresh.el !== null && !fresh.disabled) {
        writeDraft(fresh.el, polished, selRange)
        showToast('已采纳润色结果')
      }
    }

    rightDiv.appendChild(discardBtn)
    rightDiv.appendChild(applyBtn)

    footer.appendChild(leftDiv)
    footer.appendChild(rightDiv)
    modal.appendChild(footer)

    modalBackdrop.appendChild(modal)
    document.body.appendChild(modalBackdrop)

    modalBackdrop.onclick = function (e) {
      if (e.target === modalBackdrop) modalBackdrop.remove()
    }
    var onKey = function (e) {
      if (e.key === 'Escape') {
        modalBackdrop.remove()
        document.removeEventListener('keydown', onKey)
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || document.activeElement === applyBtn)) {
        applyBtn.click()
        document.removeEventListener('keydown', onKey)
      }
    }
    document.addEventListener('keydown', onKey)
  }

  function openMenu(anchorEl) {
    closeMenu()
    var conf = loadConfig()
    var current = conf.defaultStyle || 'standard'
    var theme = getEffectiveTheme(conf)

    menu = document.createElement('div')
    menu.dataset.dshPromptSparkleMenu = ''
    menu.dataset.theme = theme

    var header = document.createElement('div')
    header.dataset.dshPromptSparkleMenuHeader = ''
    header.textContent = '润色风格预设'
    menu.appendChild(header)

    STYLES.forEach(function (item) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.dataset.dshPromptSparkleMenuItem = ''
      if (item.id === current) {
        btn.dataset.active = ''
      }
      btn.innerHTML = '<span class="item-name">' + item.name + '</span><span class="item-desc">' + item.desc + '</span>'
      btn.addEventListener('mousedown', function (e) { e.preventDefault() })
      btn.addEventListener('click', function (e) {
        e.stopPropagation()
        conf.defaultStyle = item.id
        saveConfig(conf)
        closeMenu()
        updateButton()
        showToast('已切换润色风格：' + item.name)
      })
      menu.appendChild(btn)
    })

    var divider = document.createElement('div')
    divider.dataset.dshPromptSparkleMenuDivider = ''
    menu.appendChild(divider)

    var settingsBtn = document.createElement('button')
    settingsBtn.type = 'button'
    settingsBtn.dataset.dshPromptSparkleMenuItem = ''
    settingsBtn.innerHTML = '<span class="item-name">⚙️ 偏好设置...</span><span class="item-desc">视觉风格/极速模型/Diff对比</span>'
    settingsBtn.addEventListener('mousedown', function (e) { e.preventDefault() })
    settingsBtn.addEventListener('click', function (e) {
      e.stopPropagation()
      closeMenu()
      openSettingsModal()
    })
    menu.appendChild(settingsBtn)

    document.body.appendChild(menu)
    var rect = anchorEl.getBoundingClientRect()
    var menuRect = menu.getBoundingClientRect()
    var top = rect.top - menuRect.height - 6
    var left = Math.max(8, rect.left + rect.width / 2 - menuRect.width / 2)
    menu.style.top = top + 'px'
    menu.style.left = left + 'px'

    setTimeout(function () {
      document.addEventListener('click', closeMenu)
      document.addEventListener('contextmenu', onDocContextMenu)
    }, 10)
  }

  function findComposer() {
    return document.querySelector('[data-composer-card]')
  }

  /** 当前草稿状态：{ el, text, disabled, selectionStart, selectionEnd, selectedText }；找不到输入框时 disabled。 */
  function draftState() {
    var card = findComposer()
    if (card === null) return { el: null, text: '', disabled: true, selectionStart: 0, selectionEnd: 0, selectedText: '' }
    var el = card.querySelector('textarea')
    if (el === null) return { el: null, text: '', disabled: true, selectionStart: 0, selectionEnd: 0, selectedText: '' }
    var phase = el.getAttribute('data-phase')
    var selStart = el.selectionStart || 0
    var selEnd = el.selectionEnd || 0
    var selectedText = selEnd > selStart ? el.value.slice(selStart, selEnd) : ''
    return {
      el: el,
      text: el.value,
      disabled: BUSY_PHASES[phase] === 1 || el.disabled || el.readOnly,
      selectionStart: selStart,
      selectionEnd: selEnd,
      selectedText: selectedText,
    }
  }

  function currentSessionId() {
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
    var hasSelection = state.selectedText.trim() !== ''
    var conf = loadConfig()
    var curStyle = conf.defaultStyle || 'standard'
    var styleObj = STYLES.find(function (s) { return s.id === curStyle }) || STYLES[0]
    var actionName = hasSelection ? '润色选中文本' : '润色提示词'
    button.title = actionName + ' [' + styleObj.name + '] (右键设置与风格 · Ctrl/Cmd+Shift+E)'
    button.setAttribute('aria-label', actionName)
    button.disabled = busy || state.disabled || state.text.trim() === '' || currentSessionId() === undefined
  }

  /** 受控组件写回：原生 setter + input 事件走 React onChange → 机器 setDraft。支持选区局部替换。 */
  function writeDraft(textarea, text, selRange) {
    var nextText = text
    var nextSelStart = text.length
    var nextSelEnd = text.length
    if (selRange && typeof selRange.start === 'number' && typeof selRange.end === 'number' && selRange.end >= selRange.start) {
      var current = textarea.value
      var before = current.slice(0, selRange.start)
      var after = current.slice(selRange.end)
      nextText = before + text + after
      nextSelStart = selRange.start
      nextSelEnd = selRange.start + text.length
    }
    var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, nextText)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.setSelectionRange(nextSelStart, nextSelEnd)
    textarea.focus({ preventScroll: true })
  }

  function runSparkle() {
    if (busy) return
    var sessionId = currentSessionId()
    var state = draftState()
    if (sessionId === undefined) { showToast('没有活跃会话', 'error'); return }
    if (state.el === null || state.disabled) return
    var isPartial = state.selectedText.trim() !== ''
    var draft = isPartial ? state.selectedText : state.text
    var selRange = isPartial ? { start: state.selectionStart, end: state.selectionEnd } : undefined
    if (draft.trim() === '') { showToast(isPartial ? '选区为空' : '草稿为空', 'error'); return }
    if (draft.length > MAX_DRAFT_CHARS) { showToast('草稿过长，请缩短后重试', 'error'); return }
    var remote = ctx.remote
    var execute = remote && remote.commands && remote.commands.execute
    if (typeof execute !== 'function') { showToast('命令通道不可用', 'error'); return }

    busy = true
    if (button !== null) { button.dataset.busy = ''; }
    updateButton()

    var conf = loadConfig()
    var currentStyle = conf.defaultStyle || 'standard'
    var clientOptions = {
      temperature: conf.temperature,
      maxTokens: conf.maxTokens,
      timeoutMs: conf.timeoutMs,
      customPrompt: conf.customPrompt,
    }
    if (conf.enableFastModel && conf.fastProvider && conf.fastModel) {
      clientOptions.fastModel = {
        provider: conf.fastProvider.trim(),
        model: conf.fastModel.trim(),
      }
    }
    var optionsB64 = encodeDraft(JSON.stringify(clientOptions))
    var cmd = '/sparkle ' + encodeDraft(draft) + ' ' + currentStyle + ' ' + optionsB64

    execute(sessionId, cmd, []).then(function (result) {
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
        if (conf.autoCopy && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(outcome.text).catch(function () {})
        }

        if (conf.diffPreview) {
          openDiffPreview(draft, outcome.text, isPartial, selRange)
          return
        }

        var fresh = draftState()
        if (fresh.el !== null && !fresh.disabled) {
          writeDraft(fresh.el, outcome.text, selRange)
          var polishedLen = outcome.text.length
          showToast(isPartial ? '已润色选中部分' : '已润色提示词', 'info', {
            label: '撤销',
            onClick: function () {
              var current = draftState()
              if (current.el !== null && !current.disabled) {
                var undoRange = isPartial ? { start: selRange.start, end: selRange.start + polishedLen } : undefined
                writeDraft(current.el, draft, undoRange)
                showToast('已恢复原草稿')
              }
            }
          })
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
    button.innerHTML = WAND_SVG
    button.addEventListener('mousedown', function (e) { e.preventDefault() })
    button.addEventListener('click', runSparkle)
    button.addEventListener('contextmenu', function (e) {
      e.preventDefault()
      e.stopPropagation()
      openMenu(button)
    })
    anchor.insertAdjacentElement('afterend', button)
    updateButton()
  }

  function onKeyDown(e) {
    if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
    if (e.key !== 'e' && e.key !== 'E') return
    if (e.nativeEvent ? e.nativeEvent.isComposing : e.isComposing) return
    if (busy) { e.preventDefault(); return }
    var state = draftState()
    if (state.el === null || document.activeElement !== state.el || state.disabled) return
    var target = state.selectedText.trim() !== '' ? state.selectedText : state.text
    if (target.trim() === '') return
    e.preventDefault()
    runSparkle()
  }

  function onSelectionChange() {
    if (button === null || busy) return
    var state = draftState()
    if (document.activeElement === state.el) {
      updateButton()
    }
  }

  var rAfTimer = 0

  function setup() {
    bodyMo = new MutationObserver(function () {
      if (rAfTimer !== 0) return
      rAfTimer = requestAnimationFrame(function () {
        rAfTimer = 0
        ensureButton()
      })
    })
    bodyMo.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('selectionchange', onSelectionChange)
    ensureButton()
  }

  function teardown() {
    closeMenu()
    if (bodyMo !== null) bodyMo.disconnect()
    bodyMo = null
    if (rAfTimer !== 0) {
      cancelAnimationFrame(rAfTimer)
      rAfTimer = 0
    }
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('selectionchange', onSelectionChange)
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
var inject = ['sessions', 'connection', 'remote', 'remote.commands']

module.exports = { apply: apply, inject: inject }
return module.exports
} });
