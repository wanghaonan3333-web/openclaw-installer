import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import { WebSocketServer } from "ws";
import { createConfigRouter } from "./src/api/config.js";
import { createErrorsRouter } from "./src/api/errors.js";
import { createHealthRouter } from "./src/api/health.js";
import { createLlmRouter } from "./src/api/llm.js";
import { createSystemRouter } from "./src/api/system.js";
import {
  runAllowedCommand,
  terminateChildProcess
} from "./src/core/command-runner.js";
import { initializeDatabase } from "./src/core/db.js";
import {
  APP_DATA_DIR,
  APP_HOST,
  APP_PORT,
  FRONTEND_ALLOWED_ORIGIN,
  TEMPLATE_PATH,
  STATIC_INDEX_PATH
} from "./src/shared/constants.js";

await initializeDatabase();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const runningProcesses = new Map();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", FRONTEND_ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json({ limit: "1mb" }));

app.use("/api", createHealthRouter());
app.use("/api", createConfigRouter());
app.use("/api", createErrorsRouter());
app.use("/api", createLlmRouter());
app.use("/api", createSystemRouter());

app.get("/", (_req, res) => {
  res.sendFile(STATIC_INDEX_PATH);
});

app.get("/openclaw.template.json", (_req, res) => {
  res.sendFile(TEMPLATE_PATH);
});

app.get("/favicon.ico", (_req, res) => {
  res.status(204).end();
});

app.use("/data", express.static(APP_DATA_DIR));

server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws) => {
  ws.on("message", (rawMessage) => {
    let payload;
    try {
      payload = JSON.parse(rawMessage.toString("utf8"));
    } catch {
      ws.send(JSON.stringify({ type: "error", data: "无效的 JSON 消息" }));
      return;
    }

    if (payload.type === "stop") {
      const processId = payload.id ?? null;
      const entry = processId ? runningProcesses.get(processId) : null;

      if (!entry) {
        ws.send(
          JSON.stringify({
            id: processId,
            type: "error",
            data: "未找到可中断的运行命令"
          })
        );
        return;
      }

      entry.stopping = true;
      const stopped = terminateChildProcess(entry.child);
      ws.send(
        JSON.stringify({
          id: processId,
          type: "stopping",
          data: stopped ? "正在中断命令..." : "命令中断失败"
        })
      );
      return;
    }

    if (payload.type !== "run" || !payload.command) {
      ws.send(JSON.stringify({ type: "error", data: "不支持的消息类型" }));
      return;
    }

    try {
      const existing = payload.id ? runningProcesses.get(payload.id) : null;
      if (existing) {
        existing.stopping = true;
        terminateChildProcess(existing.child);
      }

      const entry = {
        child: null,
        stopping: false,
        ws
      };

      const child = runAllowedCommand(payload.command, {
        onMessage(type, data) {
          const currentEntry = payload.id ? runningProcesses.get(payload.id) : null;
          const isStopping = currentEntry?.stopping;

          if (type === "exit" && payload.id) {
            runningProcesses.delete(payload.id);
          }

          ws.send(
            JSON.stringify({
              id: payload.id ?? null,
              type: type === "exit" && isStopping ? "stopped" : type,
              ...(type === "exit" ? data : { data })
            })
          );
        }
      });

      entry.child = child;
      if (payload.id) {
        runningProcesses.set(payload.id, entry);
      }
    } catch (error) {
      ws.send(
        JSON.stringify({
          id: payload.id ?? null,
          type: "error",
          data: error.message
        })
      );
    }
  });

  ws.on("close", () => {
    for (const [id, entry] of runningProcesses.entries()) {
      if (entry.ws !== ws) {
        continue;
      }
      entry.stopping = true;
      terminateChildProcess(entry.child);
      runningProcesses.delete(id);
    }
  });
});

server.listen(APP_PORT, APP_HOST, () => {
  const indexExists = fs.existsSync(STATIC_INDEX_PATH);
  console.log(`OpenClaw bridge is running at http://${APP_HOST}:${APP_PORT}`);
  console.log(`Health API: http://${APP_HOST}:${APP_PORT}/api/health`);
  if (indexExists) {
    console.log(`Open page: http://${APP_HOST}:${APP_PORT}/`);
  }
});
