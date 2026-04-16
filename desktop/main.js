import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_PORT = 7879;
const APP_HOST = "127.0.0.1";
const APP_URL = `http://${APP_HOST}:${APP_PORT}/`;

let mainWindow = null;

function getAppRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function getBridgeDataDir() {
  return path.join(app.getPath("userData"), "data");
}

async function waitForBridge(url, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}api/health`);
      if (response.ok) {
        return;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error("本地 Bridge 启动超时");
}

async function bootBridge() {
  process.env.OPENCLAW_APP_ROOT = getAppRoot();
  process.env.OPENCLAW_DATA_DIR = getBridgeDataDir();

  const bridgeEntry = path.join(process.env.OPENCLAW_APP_ROOT, "bridge.js");
  await import(pathToFileURL(bridgeEntry).href);
  await waitForBridge(APP_URL);
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 820,
    show: false,
    backgroundColor: "#0b1220",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  await mainWindow.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  try {
    await bootBridge();
    await createMainWindow();
  } catch (error) {
    dialog.showErrorBox("OpenClaw Installer 启动失败", error.message);
    app.quit();
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
