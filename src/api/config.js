import { Router } from "express";
import {
  buildConfigText,
  getConfigPaths,
  writeConfig
} from "../core/config-manager.js";

export function createConfigRouter() {
  const router = Router();

  router.get("/config/paths", (_req, res) => {
    res.json({ paths: getConfigPaths() });
  });

  router.post("/config/preview", (req, res) => {
    try {
      const configText = buildConfigText(req.body || {});
      res.json({ configText });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/config/write", (req, res) => {
    try {
      const result = writeConfig(req.body || {});
      res.json({
        success: true,
        path: result.path,
        backupPath: result.backupPath
      });
    } catch (error) {
      res.status(400).json({
        error: error.message,
        fallbackPath: error.fallbackPath || null,
        fallbackUrl: error.fallbackPath ? "/data/generated/openclaw.generated.json" : null
      });
    }
  });

  return router;
}
