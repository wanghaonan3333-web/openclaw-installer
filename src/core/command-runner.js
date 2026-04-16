import { spawn } from "node:child_process";
import { ALLOWED_COMMANDS } from "../shared/constants.js";

export function isAllowedCommand(cmd = "") {
  const trimmed = String(cmd).trim();
  return ALLOWED_COMMANDS.some(
    (allowed) => trimmed === allowed || trimmed.startsWith(`${allowed} `)
  );
}

function createProcess(command) {
  if (process.platform === "win32") {
    return spawn("powershell", ["-NoProfile", "-Command", command], {
      shell: false,
      windowsHide: true
    });
  }

  return spawn("/bin/sh", ["-c", command], {
    shell: true
  });
}

export function terminateChildProcess(child) {
  if (!child || child.killed) {
    return false;
  }

  try {
    if (process.platform === "win32" && child.pid) {
      const killer = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          shell: false,
          windowsHide: true
        }
      );
      killer.unref();
      return true;
    }

    child.kill("SIGTERM");
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 1500);
    timeout.unref?.();
    return true;
  } catch {
    return false;
  }
}

export function runAllowedCommandWithResult(command, options = {}) {
  return new Promise((resolve, reject) => {
    if (!isAllowedCommand(command)) {
      reject(new Error("命令不在白名单"));
      return;
    }

    const child = createProcess(command);
    let stdout = "";
    let stderr = "";
    const timeoutMs = options.timeoutMs ?? 8000;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      child.kill();
      fail(new Error("命令执行超时"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      options.onStderr?.(text);
    });

    child.on("error", (error) => {
      fail(error);
    });

    child.on("close", (code) => {
      finish({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

export function runAllowedCommand(command, handlers = {}) {
  if (!isAllowedCommand(command)) {
    throw new Error("命令不在白名单");
  }

  const child = createProcess(command);
  const emit = (type, payload) => {
    if (typeof handlers.onMessage === "function") {
      handlers.onMessage(type, payload);
    }
  };

  emit("started", `执行: ${command}`);

  child.stdout.on("data", (chunk) => {
    emit("stdout", chunk.toString("utf8"));
  });

  child.stderr.on("data", (chunk) => {
    emit("stderr", chunk.toString("utf8"));
  });

  child.on("error", (error) => {
    emit("error", error.message);
  });

  child.on("close", (code) => {
    emit("exit", { code: code ?? 1 });
  });

  return child;
}
