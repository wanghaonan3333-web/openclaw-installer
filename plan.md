好，下面是一份吸收 `优化plan.md` 后、可以直接继续分配给多个 Agent 并行执行的优化版方案。

---

# 执行计划：OpenClaw 在线安装向导 + 本地 Bridge API + 报错库 + 配置编辑器

## 核心原则

1. **统一技术栈**：去掉 Python 后端，全部使用 Node.js。
2. **降低用户门槛**：用户只需要运行一个本地服务 `node bridge.js`。
3. **配置零手改**：用户输入 API Key 后，通过表单生成并一键写入 `openclaw.json`。
4. **命令可降级**：Bridge 不可用时，仍然可以复制命令手动执行。
5. **搜索更靠谱**：报错库使用 SQLite FTS + 错误指纹，而不是简单 LIKE。

---

## 整体架构

```txt
用户浏览器 (index.html)
    │
    ├── HTTP API http://localhost:7879/api/* ──→ bridge.js（本地 Node.js 服务）
    │                                             ├── Express API
    │                                             ├── better-sqlite3 报错库
    │                                             ├── Mininglamp LLM 代理
    │                                             ├── 配置文件探测 / 预览 / 写入
    │                                             └── 命令执行入口
    │
    └── WebSocket ws://localhost:7879/ws ───────→ bridge.js
                                                  └── 流式返回 stdout / stderr / exit
```

**最终目标**：
```txt
用户先安装 Node.js
→ 运行 bridge.js
→ 打开 index.html
→ 自动识别系统
→ 一步步安装 OpenClaw
→ 输入 API Key 生成配置
→ 一键替换本机 openclaw.json
→ 若命令报错，直接查本地报错库或调用 LLM 分析
```

---

## 推荐文件结构

```txt
index.html
bridge.js                  # 本地唯一入口，负责 API + WebSocket + 命令执行
package.json
openclaw.template.json     # 前端/本地服务共同使用的模板
data/
  errors.db
src/
  api/
    errors.js
    llm.js
    config.js
    health.js
  core/
    command-runner.js
    config-manager.js
    error-fingerprint.js
    db.js
  shared/
    constants.js
```

---

## 任务分配（4个 Agent 并行）

---

### Agent 1 — 本地 API 服务（Node.js + Express + SQLite）

**文件**：`bridge.js`、`src/api/errors.js`、`src/api/llm.js`、`src/api/config.js`、`src/core/db.js`、`package.json`

**职责**：本地 API、报错库、LLM 代理、配置写入接口

**技术选型**：
```txt
express
ws
better-sqlite3
http(s) / fetch
dotenv（可选）
```

**数据库 Schema**：
```sql
CREATE TABLE errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    error_pattern TEXT NOT NULL,        -- 原始报错，截断保存
    error_fingerprint TEXT NOT NULL,    -- 去噪后的错误指纹
    command TEXT,
    os TEXT,                            -- 'macOS' | 'Windows'
    openclaw_version TEXT,              -- 当前 OpenClaw 版本
    solution TEXT NOT NULL,
    source TEXT DEFAULT 'llm',          -- 'llm' | 'community'
    votes INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**FTS 表**：
```sql
CREATE VIRTUAL TABLE errors_fts USING fts5(
    error_pattern,
    error_fingerprint,
    solution,
    command,
    os,
    openclaw_version,
    content='errors',
    content_rowid='id'
);
```

**搜索策略**：
```txt
1. 前端传入原始错误文本
2. 服务端先生成 error_fingerprint
3. 优先按 fingerprint + FTS 查询
4. 次级按 os / openclaw_version 排序
5. 仍无结果时再调用 LLM
```

**错误指纹提取规则**：
```txt
1. 取报错前 1~3 行核心文本
2. 去掉绝对路径、版本号、行号、时间戳
3. 保留错误码、关键异常名、失败命令
4. 统一大小写和空白
```

**API 接口规范**：
```txt
GET  /api/health
     → { status: "ok", error_count: 42, os: "Windows" }

GET  /api/errors/search?query=<错误文本>&os=<系统>&version=<版本>&limit=5
     → [{ id, error_pattern, error_fingerprint, command, os, openclaw_version, solution, source, votes, created_at }]

POST /api/errors
     Body: { error_pattern, command, os, openclaw_version, solution, source }
     → { success: true, id }

POST /api/errors/:id/vote
     → { success: true }

POST /api/llm/analyze
     Body: { error_text, command, os, openclaw_version }
     → { solution: "**原因**：...\n**解决方案**：..." }
     → { error: "..." }

GET  /api/config/paths
     → { paths: [{ path, exists, writable, recommended }] }

POST /api/config/preview
     Body: { apiKey, baseUrl, model, workspace }
     → { configText: "{ ...json... }" }

POST /api/config/write
     Body: { apiKey, baseUrl, model, workspace, targetPath?, backup: true }
     → { success: true, path, backupPath }
```

**LLM 配置**：
```txt
直接复用 Mininglamp
LLM_BASE_URL=https://llm-gateway.mlamp.cn/
LLM_MODEL=claude-sonnet-4-6
API Key 来源：用户在配置表单中输入的同一个 Key
```

**LLM Prompt 模板**：
```txt
用户在安装 OpenClaw 时遇到了报错，请分析原因并给出解决方案。

操作系统：{os}
OpenClaw 版本：{openclaw_version}
执行的命令：`{command}`
报错信息：
{error_text[:2000]}

请用中文简洁回答，严格按以下格式：
**原因**：（一句话说明根本原因）
**解决方案**：
（具体操作步骤，需要执行的命令用代码块包裹）
```

**package.json 依赖**：
```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "express": "^4.19.0",
    "ws": "^8.18.0"
  }
}
```

**启动命令**：`node bridge.js`

---

### Agent 2 — Bridge 命令执行与配置写入

**文件**：`bridge.js`、`src/core/command-runner.js`、`src/core/config-manager.js`、`src/shared/constants.js`

**职责**：命令白名单、WebSocket 输出流、shell 模式执行、配置文件探测与一键替换

**关键优化点**：
```txt
1. 含管道的命令必须走 shell 执行
2. 不能只用 spawn(command, args)
3. Bridge 同时提供“执行”和“复制”所需的命令元数据
4. 一键替换配置时先备份旧文件
```

**白名单扩展**：
```js
// Mac
'xcode-select --install',
'xcode-select -p',
'/bin/zsh -c "$(curl -fsSL https://gitee.com/cunkai/HomebrewCN/raw/master/Homebrew.sh)"',
'echo >> ~/.zprofile',
'brew doctor',
'brew install node',
'brew upgrade node',
'npm install -g npm@latest',
'curl -fsSL https://openclaw.ai/install.sh | bash',
'curl -fsSL https://open-claw.org.cn/install-cn.sh | bash',
'openclaw --version',
'openclaw gateway install',
'openclaw gateway',
'openclaw onboard --install-daemon',
'source ~/.bashrc',
'source ~/.zshrc',

// Windows
'winget install OpenJS.NodeJS.LTS',
'winget upgrade OpenJS.NodeJS.LTS',
'npm install -g openclaw@latest',
'iwr -useb https://openclaw.ai/install.ps1 | iex',
'iwr -useb https://open-claw.org.cn/install-cn.ps1 | iex',
'Set-ExecutionPolicy RemoteSigned -Scope CurrentUser',
'node -v',
'openclaw gateway status',
'openclaw --version'
```

**白名单匹配规则**：
```js
function isAllowed(cmd) {
  const trimmed = cmd.trim();
  return ALLOWED_COMMANDS.some((allowed) =>
    trimmed === allowed || trimmed.startsWith(allowed + ' ')
  );
}
```

**执行策略**：
```js
// macOS
spawn('/bin/sh', ['-c', cmd], { shell: true });

// Windows
spawn('powershell', ['-NoProfile', '-Command', cmd], { shell: false });
```

**为什么必须这样做**：
```txt
安装命令中包含 |、$(...)、iex、source 等 shell 特性
如果直接把 curl 或 iwr 当成普通可执行文件去跑，会导致整条命令失败
```

**WebSocket 消息格式**：
```js
{ id, type: 'started', data: '执行: xxx' }
{ id, type: 'stdout', data: '...' }
{ id, type: 'stderr', data: '...' }
{ id, type: 'exit', code: 0 }
{ id, type: 'error', data: '命令不在白名单' }
{ id, type: 'config-paths', data: [{ path, exists, writable, recommended }] }
{ id, type: 'config-written', data: { path, backupPath } }
{ id, type: 'config-write-failed', data: '写入失败原因' }
```

**配置文件路径策略**：
```txt
Windows:
1. %USERPROFILE%\.openclaw\openclaw.json

macOS:
1. ~/.openclaw/openclaw.json
```

**一键替换要求**：
```txt
1. 探测候选路径并标记 recommended
2. 若目录不存在，自动创建
3. 若旧文件存在，先备份为 openclaw.json.bak-时间戳
4. 写入新配置
5. 返回 path + backupPath
6. 写入失败时回传明确错误信息
```

---

### Agent 3 — 前端安装向导（index.html）

**文件**：`index.html`

**职责**：自动识别系统、安装步骤 UI、配置编辑器、命令复制降级、错误检测与报错库 UI

**新增安装流程**：
```txt
Step 1. 自动识别当前系统（默认 Windows / macOS）
Step 2. 安装 Node.js
Step 3. 安装 OpenClaw
Step 4. 输入 API Key，生成并写入 openclaw.json
Step 5. 验证版本与网关状态
Step 6. 报错时查库 / AI 分析
```

**系统检测**：
```js
const detectedOS = navigator.platform.toLowerCase().includes('win') ? 'windows' : 'mac';
let os = detectedOS;
```

**要求**：
```txt
1. 页面首次打开时自动按当前系统展示步骤
2. 同时保留手动切换系统按钮
3. 所有命令卡片都显示两个按钮：
   - ▶ 运行
   - 📋 复制
4. 即使本地 bridge 没启动，也能复制命令
```

**配置编辑器 UI**：
```html
<section class="config-panel">
  <h3>配置 OpenClaw</h3>
  <label>明略 API Key</label>
  <input id="api-key-input" type="password" placeholder="请输入 API Key" />

  <label>Base URL</label>
  <input id="base-url-input" value="https://llm-gateway.mlamp.cn/" />

  <label>模型</label>
  <input id="model-input" value="claude-sonnet-4-6" />

  <label>工作空间路径</label>
  <input id="workspace-input" value="~/.openclaw/workspace" />

  <div class="config-actions">
    <button class="btn" onclick="generateConfig()">生成配置文件</button>
    <button class="btn" onclick="downloadConfigFile()">下载配置文件</button>
    <button class="btn btn-ai" onclick="replaceConfigFile()">一键替换到本机</button>
  </div>

  <div id="config-path-hint"></div>
  <pre id="config-preview"></pre>
</section>
```

**配置交互要求**：
```txt
1. 用户输入 API Key 后点击“生成配置文件”
2. 前端调用 /api/config/preview 获取标准 JSON
3. 展示 `openclaw.json` 预览
4. 再调用 /api/config/paths 获取推荐路径
5. 若接口可用，展示“一键替换到本机”
6. 若接口不可用，展示“下载配置文件 + 手动替换说明”
```

**手动替换引导**：
```txt
已生成配置文件，请将下载的 openclaw.json 替换到以下目录：
- Windows: %USERPROFILE%\.openclaw\openclaw.json
- macOS: ~/.openclaw/openclaw.json

建议先备份旧文件。
若目录不存在，请先创建 `.openclaw` 目录。
```

**步骤状态持久化**：
```js
localStorage.setItem(`step_${stepIdx}_status`, 'done');
const done = localStorage.getItem(`step_${stepIdx}_status`) === 'done';
```

**报错检测逻辑**：
```txt
1. 命令 exit code != 0 时触发错误面板
2. stdout / stderr 出现错误关键词时也触发
3. 先搜索本地报错库
4. 无命中时调用 LLM 分析
5. 用户确认“解决了”后可保存到报错库
```

**错误关键词**：
```js
const ERROR_PATTERNS = [
  'error', 'Error', 'ERROR',
  'ENOENT', 'EACCES', 'EPERM', 'EEXIST',
  'command not found', 'not recognized', 'not found',
  'failed', 'Failed', 'FAILED',
  'Cannot', 'cannot', 'Unable',
  'permission denied', 'Permission denied',
  'npm ERR', 'SyntaxError', 'TypeError', 'ReferenceError',
  'No such file', 'Access is denied'
];
```

**模板来源**：
```txt
配置模板来源于仓库现有 `openclaw.json`
生成时只替换以下字段：
- models.providers.mininglamp.baseUrl
- models.providers.mininglamp.apiKey
- agents.defaults.model.primary
- agents.defaults.workspace
```

---

### Agent 4 — 运行方式、发布与验收

**文件**：`README.md`、`package.json`、`start.bat`、`start.sh`

**职责**：降低启动门槛，提供本地运行方式和验收脚本

**本地启动方式**：
```bash
npm install
node bridge.js
```

**可选快捷脚本**：
```bash
# Windows
start.bat

# macOS
./start.sh
```

**脚本职责**：
```txt
1. 检查 Node.js 是否已安装
2. 若未安装，提示去执行前端步骤
3. 安装依赖
4. 启动本地服务
5. 在控制台打印访问地址 http://localhost:7879
```

**部署建议**：
```txt
这是一个“前端静态页 + 本地 Node 服务”方案
不再需要 Python、Docker、云端数据库
如需远程托管 index.html，可以放在 GitHub Pages / Vercel
但 bridge.js 仍需用户本地运行
```

---

## 执行顺序 & 依赖关系

```txt
Agent 1（本地 API） ─────────────────────────→ 完成
Agent 2（Bridge 执行层） ───────────────────→ 完成
                                                    ↓
Agent 3（前端向导） ← 依赖 Agent 1/2 接口规范 → 完成
                                                    ↓
Agent 4（启动与验收） ← 依赖 Agent 1/2/3 完成 → 完成
```

**并行建议**：
```txt
Agent 1 和 Agent 2 可同时开始
Agent 3 不必等待 API 实现完成，只要接口格式先定下来即可同步开发
Agent 4 最后收口
```

---

## 关键实现细节

### 1. 为什么去掉 Python

```txt
OpenClaw 安装本来就依赖 Node.js
如果再要求用户安装 Python，会额外增加失败点
统一为 Node.js 后，用户只需要维护一个运行环境
```

### 2. 为什么配置编辑器优先级最高

```txt
新手最容易卡在 openclaw.json
如果让用户自己改 JSON，格式、路径、字段名都容易出错
改成“输入 API Key → 生成 → 一键写入”，成功率最高
```

### 3. 为什么每条命令都要有复制按钮

```txt
Bridge 失败时，运行按钮会失效
但复制按钮能保证页面仍然有价值，不至于完全阻断安装流程
```

### 4. 为什么报错库要加 FTS

```txt
报错文本变化大，LIKE 命中率太低
FTS + 错误指纹会更接近“按语义关键词搜索”
```

---

## 验收标准

| 功能 | 验收条件 |
|------|---------|
| 本地服务启动 | 执行 `node bridge.js` 后可访问 `http://localhost:7879/api/health` |
| OS 自动识别 | 打开页面自动显示对应系统步骤，且支持手动切换 |
| 命令执行 | 点击运行后终端有流式输出 |
| 复制降级 | Bridge 不可用时仍能复制命令 |
| 管道命令执行 | `curl ... \| bash`、`iwr ... \| iex` 这类命令能正常执行 |
| 配置生成 | 输入 API Key 后能生成 `openclaw.json` 预览 |
| 一键替换 | 点击按钮后可备份旧文件并写入新配置 |
| 手动替换引导 | 下载配置文件后能看到目标路径和替换说明 |
| 报错库搜索 | 有匹配时能优先展示 FTS 命中结果 |
| AI 分析 | 无匹配时调用 Mininglamp 返回原因 + 解决方案 |
| 保存报错 | 点击保存后再次搜索能命中 |
| 点赞 | votes 字段 +1 |
| 状态持久化 | 刷新页面后已完成步骤仍显示完成 |

---

## 最终结论

这版优化后的方案，重点不是“功能更多”，而是把最容易失败的地方都前置处理掉：

```txt
去掉 Python
→ 减少环境依赖

配置编辑器 + 一键写入
→ 解决最大痛点

自动识别系统 + 复制按钮
→ 提升成功率和容错

FTS + 错误指纹
→ 提升报错库可用性

shell 执行管道命令
→ 保证安装命令真实可跑
```
