import { Router } from "express";
import { getErrorCount } from "../core/db.js";
import { getDetectedOSLabel } from "../shared/constants.js";

export function createHealthRouter() {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      error_count: getErrorCount(),
      os: getDetectedOSLabel()
    });
  });

  return router;
}
