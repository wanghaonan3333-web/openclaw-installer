#!/bin/sh
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 未安装，请先按页面步骤安装 Node.js。"
  exit 1
fi

npm install || exit 1
node bridge.js
