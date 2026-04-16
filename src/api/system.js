import fs from "node:fs";
import net from "node:net";
import { Router } from "express";
import { runAllowedCommandWithResult } from "../core/command-runner.js";
import { getStorageMode } from "../core/db.js";
import {
  getDefaultConfigPath,
  getDefaultWorkspacePath,
  getDetectedOSLabel
} from "../shared/constants.js";

const DEFAULT_GATEWAY_HOST = "127.0.0.1";
const DEFAULT_GATEWAY_PORT = 18789;

function normalizeOutput(result) {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function buildGatewayState({ command, result, error }) {
  const output = error ? error.message : normalizeOutput(result);
  const lower = output.toLowerCase();
  const reachable =
    lower.includes("reachable: yes") ||
    lower.includes("connect: ok") ||
    lower.includes("rpc probe: ok") ||
    lower.includes("listening:");
  const requiresPairing = lower.includes("pairing required");

  let summary = "未就绪";
  if (reachable) {
    summary = requiresPairing ? "网关可达，等待配对" : "网关可用";
  } else if (requiresPairing) {
    summary = "需要配对";
  } else if (lower.includes("timeout") || lower.includes("超时")) {
    summary = "探测超时";
  }

  return {
    ok: reachable || requiresPairing,
    reachable,
    requiresPairing,
    command,
    summary,
    output
  };
}

function readGatewayPort() {
  try {
    const configPath = getDefaultConfigPath();
    if (!fs.existsSync(configPath)) {
      return DEFAULT_GATEWAY_PORT;
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return Number(config?.gateway?.port) || DEFAULT_GATEWAY_PORT;
  } catch {
    return DEFAULT_GATEWAY_PORT;
  }
}

function probeGatewaySocket({ host, port, timeoutMs = 1500 }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      finish({ ok: true, output: `TCP connect ok: ${host}:${port}` });
    });
    socket.on("timeout", () => {
      finish({ ok: false, output: `TCP timeout: ${host}:${port}` });
    });
    socket.on("error", (error) => {
      finish({ ok: false, output: error.message });
    });
  });
}

async function probeGatewayHttp({ host, port, timeoutMs = 2500 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://${host}:${port}/`, {
      method: "GET",
      signal: controller.signal
    });
    return {
      ok: response.ok,
      output: `HTTP ${response.status}: http://${host}:${port}/`
    };
  } catch (error) {
    return {
      ok: false,
      output: error.name === "AbortError" ? "HTTP timeout" : error.message
    };
  } finally {
    clearTimeout(timer);
  }
}

async function detectOpenClawVersion() {
  try {
    const result = await runAllowedCommandWithResult("openclaw --version", {
      timeoutMs: 5000
    });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return {
      installed: result.code === 0,
      version: output || null,
      command: "openclaw --version"
    };
  } catch {
    return {
      installed: false,
      version: null,
      command: "openclaw --version"
    };
  }
}

async function detectGatewayStatus() {
  const port = readGatewayPort();
  const socketProbe = await probeGatewaySocket({
    host: DEFAULT_GATEWAY_HOST,
    port
  });

  if (socketProbe.ok) {
    const httpProbe = await probeGatewayHttp({
      host: DEFAULT_GATEWAY_HOST,
      port
    });

    return {
      ok: true,
      reachable: true,
      requiresPairing: false,
      command: "direct localhost probe",
      summary: "网关可用",
      output: httpProbe.ok
        ? `${socketProbe.output}\n${httpProbe.output}`
        : socketProbe.output,
      host: DEFAULT_GATEWAY_HOST,
      port,
      dashboardUrl: `http://${DEFAULT_GATEWAY_HOST}:${port}/`
    };
  }

  const attempts = [
    { command: "openclaw gateway probe", timeoutMs: 7000 },
    { command: "openclaw gateway status", timeoutMs: 12000 },
    { command: "openclaw gateway health", timeoutMs: 6000 }
  ];

  let lastState = null;

  for (const attempt of attempts) {
    try {
      const result = await runAllowedCommandWithResult(attempt.command, {
        timeoutMs: attempt.timeoutMs
      });
      const state = buildGatewayState({ command: attempt.command, result });
      if (state.ok) {
        return {
          ...state,
          host: DEFAULT_GATEWAY_HOST,
          port,
          dashboardUrl: `http://${DEFAULT_GATEWAY_HOST}:${port}/`
        };
      }
      lastState = state;
    } catch (error) {
      lastState = buildGatewayState({ command: attempt.command, error });
    }
  }

  return (
    lastState || {
      ok: false,
      reachable: false,
      requiresPairing: false,
      command: "openclaw gateway probe",
      summary: "未就绪",
      output: "未获取到网关状态",
      host: DEFAULT_GATEWAY_HOST,
      port,
      dashboardUrl: `http://${DEFAULT_GATEWAY_HOST}:${port}/`
    }
  );
}

export function createSystemRouter() {
  const router = Router();

  router.get("/system/info", async (_req, res) => {
    const [versionInfo, gatewayInfo] = await Promise.all([
      detectOpenClawVersion(),
      detectGatewayStatus()
    ]);

    res.json({
      os: getDetectedOSLabel(),
      storageMode: getStorageMode(),
      configPath: getDefaultConfigPath(),
      workspacePath: getDefaultWorkspacePath(),
      openclaw: versionInfo,
      gateway: gatewayInfo
    });
  });

  return router;
}
