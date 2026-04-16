import { Router } from "express";
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from "../shared/constants.js";

function buildPrompt({ error_text, command, os, openclaw_version }) {
  return `用户在安装 OpenClaw 时遇到了报错，请分析原因并给出解决方案。

操作系统：${os || "未知"}
OpenClaw 版本：${openclaw_version || "未知"}
执行的命令：\`${command || ""}\`
报错信息：
${String(error_text || "").slice(0, 2000)}

请用中文简洁回答，严格按以下格式：
**原因**：（一句话说明根本原因）
**解决方案**：
（具体操作步骤，需要执行的命令用代码块包裹）`;
}

async function analyzeWithMininglamp(payload) {
  const apiKey = payload.apiKey || process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 API Key，请先在配置步骤中填写");
  }

  const baseUrl = (payload.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = payload.model || DEFAULT_MODEL;
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: buildPrompt(payload)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`LLM 请求失败: HTTP ${response.status}`);
  }

  const data = await response.json();
  const text = Array.isArray(data.content)
    ? data.content
        .filter((item) => item && item.type === "text")
        .map((item) => item.text)
        .join("\n")
    : "";

  if (!text) {
    throw new Error("LLM 未返回可解析内容");
  }

  return text;
}

export function createLlmRouter() {
  const router = Router();

  router.post("/llm/analyze", async (req, res) => {
    try {
      const solution = await analyzeWithMininglamp(req.body || {});
      res.json({ solution });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
