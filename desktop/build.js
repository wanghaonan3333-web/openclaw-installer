import { spawn } from "node:child_process";

const target = process.argv[2] || "all";
const extraArgs = process.argv.slice(3);

const targetArgsMap = {
  all: [],
  win: ["--win", "nsis", "portable"],
  mac: ["--mac", "dmg", "zip"]
};

const targetArgs = targetArgsMap[target];

if (!targetArgs) {
  console.error(`Unsupported build target: ${target}`);
  process.exit(1);
}

const env = {
  ...process.env,
  ELECTRON_MIRROR:
    process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/",
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
    "https://npmmirror.com/mirrors/electron-builder-binaries/"
};

const command =
  process.platform === "win32"
    ? `npx electron-builder ${[...targetArgs, ...extraArgs].join(" ")}`
    : "npx";

const commandArgs =
  process.platform === "win32" ? [] : ["electron-builder", ...targetArgs, ...extraArgs];

const child = spawn(command, commandArgs, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32"
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
