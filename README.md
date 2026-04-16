# OpenClaw 本地安装向导

## 启动

```bash
npm install
node bridge.js
```

启动后打开：

- `http://127.0.0.1:7879/`

## 桌面版

开发模式：

```bash
npm install
npm run desktop:dev
```

打包：

```bash
npm run desktop:pack:win
npm run desktop:pack:mac
```

说明：

- 当前方案使用 Electron，把现有 `bridge.js + index.html` 直接包成桌面应用。
- Windows 输出 `exe`，macOS 输出 `.app/.dmg`。
- 桌面版运行时会把数据库和生成文件写到应用用户目录，不再依赖当前工作目录。
- 打包脚本内置了 Electron 国内镜像，国内网络下不需要再手动设置镜像变量。

## 已实现

- Node.js 本地桥接服务
- `/api/health`
- `/api/config/preview`
- `/api/config/write`
- `/api/errors/search`
- `/api/errors`
- `/api/errors/:id/vote`
- `/api/llm/analyze`
- WebSocket 命令执行
- 前端安装向导与配置编辑器

## 注意

- 命令执行仅允许白名单命令。
- 首批代码已包含报错库骨架和配置写入，但仍可继续补充更多 UI 和交互细节。
- `desktop:pack:mac` 需要在 macOS 环境下执行，`desktop:pack:win` 最好在 Windows 环境下执行。
