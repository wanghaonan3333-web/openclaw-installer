import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_WORKSPACE,
  GENERATED_DIR,
  TEMPLATE_PATH,
  getDefaultConfigPath
} from "../shared/constants.js";

let templateCache;

function readTemplate() {
  if (!templateCache) {
    templateCache = JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8"));
  }
  return structuredClone(templateCache);
}

function normalizeWorkspace(workspace = DEFAULT_WORKSPACE) {
  if (!workspace) {
    return DEFAULT_WORKSPACE;
  }

  if (workspace.startsWith("~/")) {
    return path.join(os.homedir(), workspace.slice(2));
  }

  return workspace;
}

export function getConfigPaths() {
  const configPath = getDefaultConfigPath();
  const writable = fs.existsSync(path.dirname(configPath))
    ? isDirectoryWritable(path.dirname(configPath))
    : isDirectoryWritable(os.homedir());

  return [
    {
      path: configPath,
      exists: fs.existsSync(configPath),
      writable,
      recommended: true
    }
  ];
}

function isDirectoryWritable(dirPath) {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function buildConfig({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model = DEFAULT_MODEL,
  workspace = DEFAULT_WORKSPACE
}) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error("API Key 不能为空");
  }

  const config = readTemplate();
  const normalizedWorkspace = normalizeWorkspace(workspace);

  config.models.providers.mininglamp.baseUrl = baseUrl;
  config.models.providers.mininglamp.apiKey = apiKey.trim();
  config.agents.defaults.model.primary = `mininglamp/${model}`;
  config.agents.defaults.workspace = normalizedWorkspace;

  return config;
}

export function buildConfigText(payload) {
  return `${JSON.stringify(buildConfig(payload), null, 2)}\n`;
}

export function writeConfig({
  apiKey,
  baseUrl,
  model,
  workspace,
  targetPath,
  backup = true
}) {
  const configText = buildConfigText({ apiKey, baseUrl, model, workspace });
  const finalPath = targetPath || getDefaultConfigPath();
  const finalDir = path.dirname(finalPath);
  let backupPath = null;

  fs.mkdirSync(finalDir, { recursive: true });

  try {
    if (backup && fs.existsSync(finalPath)) {
      backupPath = `${finalPath}.bak-${Date.now()}`;
      fs.copyFileSync(finalPath, backupPath);
    }

    fs.writeFileSync(finalPath, configText, "utf8");
  } catch (error) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    const fallbackPath = path.join(GENERATED_DIR, "openclaw.generated.json");
    fs.writeFileSync(fallbackPath, configText, "utf8");
    error.fallbackPath = fallbackPath;
    throw error;
  }

  return {
    path: finalPath,
    backupPath,
    configText
  };
}
