import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_PORT = 7879;
export const APP_HOST = "0.0.0.0";
const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT_DIR =
  process.env.OPENCLAW_APP_ROOT || path.resolve(CURRENT_DIR, "..", "..");
export const APP_DATA_DIR =
  process.env.OPENCLAW_DATA_DIR || path.join(APP_ROOT_DIR, "data");
export const DB_DIR = APP_DATA_DIR;
export const DB_PATH = path.join(APP_DATA_DIR, "errors.db");
export const GENERATED_DIR = path.join(APP_DATA_DIR, "generated");
export const TEMPLATE_PATH = path.join(APP_ROOT_DIR, "openclaw.template.json");
export const STATIC_INDEX_PATH = path.join(APP_ROOT_DIR, "index.html");

export const DEFAULT_BASE_URL = "https://llm-gateway.mlamp.cn/";
export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const DEFAULT_WORKSPACE =
  process.platform === "win32"
    ? path.join(os.homedir(), ".openclaw", "workspace")
    : "~/.openclaw/workspace";

export const FRONTEND_ALLOWED_ORIGIN = "*";

export const ALLOWED_COMMANDS = [
  "xcode-select --install",
  "xcode-select -p",
  '/bin/zsh -c "$(curl -fsSL https://gitee.com/cunkai/HomebrewCN/raw/master/Homebrew.sh)"',
  "echo >> ~/.zprofile",
  "echo 'eval \"$(/opt/homebrew/bin/brew shellenv zsh)\"' >> ~/.zprofile",
  "eval \"$(/opt/homebrew/bin/brew shellenv zsh)\"",
  "brew doctor",
  "brew install node",
  "brew upgrade node",
  "npm install -g npm@latest",
  "curl -fsSL https://openclaw.ai/install.sh | bash",
  "curl -fsSL https://open-claw.org.cn/install-cn.sh | bash",
  "openclaw --version",
  "openclaw status",
  "openclaw health",
  "openclaw doctor",
  "openclaw gateway install",
  "openclaw gateway start",
  "openclaw gateway restart",
  "openclaw gateway stop",
  "openclaw gateway probe",
  "openclaw gateway health",
  "openclaw gateway status",
  "openclaw gateway",
  "openclaw onboard --install-daemon",
  "source ~/.bashrc",
  "source ~/.zshrc",
  "winget install OpenJS.NodeJS.LTS",
  "winget upgrade OpenJS.NodeJS.LTS",
  "npm install -g openclaw@latest",
  "iwr -useb https://openclaw.ai/install.ps1 | iex",
  "iwr -useb https://open-claw.org.cn/install-cn.ps1 | iex",
  "Set-ExecutionPolicy RemoteSigned -Scope CurrentUser",
  "node -v",
  "openclaw gateway probe",
  "openclaw gateway health",
  "openclaw gateway status"
];

export const ERROR_PATTERNS = [
  "error",
  "Error",
  "ERROR",
  "ENOENT",
  "EACCES",
  "EPERM",
  "EEXIST",
  "command not found",
  "not recognized",
  "not found",
  "failed",
  "Failed",
  "FAILED",
  "Cannot",
  "cannot",
  "Unable",
  "permission denied",
  "Permission denied",
  "npm ERR",
  "SyntaxError",
  "TypeError",
  "ReferenceError",
  "No such file",
  "Access is denied"
];

export function getDetectedOSLabel() {
  return process.platform === "win32" ? "Windows" : "macOS";
}

export function getDefaultConfigPath() {
  return path.join(os.homedir(), ".openclaw", "openclaw.json");
}

export function getDefaultWorkspacePath() {
  return process.platform === "win32"
    ? path.join(os.homedir(), ".openclaw", "workspace")
    : path.join("~", ".openclaw", "workspace");
}
