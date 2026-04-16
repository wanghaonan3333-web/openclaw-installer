import { Router } from "express";
import {
  insertError,
  searchErrors,
  submitErrorFeedback,
  voteError
} from "../core/db.js";

export function createErrorsRouter() {
  const router = Router();

  router.get("/errors/search", (req, res) => {
    const {
      query = "",
      os = "",
      version = "",
      limit = "5",
      sort = "best",
      source = "all",
      sameVersionOnly = "false",
      minVotes = "0"
    } = req.query;
    const results = searchErrors({
      query: String(query),
      os: String(os),
      version: String(version),
      limit: Math.min(Math.max(Number(limit) || 5, 1), 50),
      sort: ["best", "votes", "latest"].includes(String(sort))
        ? String(sort)
        : "best",
      source: ["all", "llm", "community"].includes(String(source))
        ? String(source)
        : "all",
      sameVersionOnly:
        String(sameVersionOnly) === "true" || String(sameVersionOnly) === "1",
      minVotes: Math.max(Number(minVotes) || 0, 0)
    });

    res.json(results);
  });

  router.post("/errors", (req, res) => {
    const { error_pattern, command, os, openclaw_version, solution, source } =
      req.body || {};

    if (!error_pattern || !solution) {
      res.status(400).json({ error: "error_pattern 和 solution 不能为空" });
      return;
    }

    const result = insertError({
      error_pattern,
      command,
      os,
      openclaw_version,
      solution,
      source
    });

    res.json({
      success: true,
      id: result.id,
      error_fingerprint: result.error_fingerprint
    });
  });

  router.post("/errors/:id/vote", (req, res) => {
    const ok = voteError(Number(req.params.id));

    if (!ok) {
      res.status(404).json({ error: "记录不存在" });
      return;
    }

    res.json({ success: true });
  });

  router.post("/errors/:id/feedback", (req, res) => {
    const { type } = req.body || {};
    const normalizedType = type === "not_solved" ? "not_solved" : "helpful";
    const stats = submitErrorFeedback(Number(req.params.id), normalizedType);

    if (!stats) {
      res.status(404).json({ error: "记录不存在" });
      return;
    }

    res.json({
      success: true,
      helpful_count: stats.helpful_count,
      not_solved_count: stats.not_solved_count,
      votes: stats.votes
    });
  });

  return router;
}
