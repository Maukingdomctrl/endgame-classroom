/**
 * syncServer.ts  (run with: npx tsx syncServer.ts)
 *
 * Lightweight dev server that handles lesson file saves.
 * Listens on port 5174.
 *
 * Endpoints:
 *   POST /api/save-pgn   — writes a .pgn file  (NEW — used by BoardEditor)
 *   POST /api/save-lesson — writes a .json file (LEGACY — remove when migrated)
 */

import http   from "http";
import fs     from "fs";
import path   from "path";
import url    from "url";

const PORT       = 5174;
const __dirname  = path.dirname(url.fileURLToPath(import.meta.url));
const MODULES_DIR = path.resolve(__dirname, "src/modules");

// ── CORS helper ───────────────────────────────────────────────────────────────
function cors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: http.ServerResponse, status: number, body: object) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end",  () => resolve(buf));
    req.on("error", reject);
  });
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  // ── POST /api/save-pgn ───────────────────────────────────────────────────
  if (req.url === "/api/save-pgn") {
    try {
      const body = JSON.parse(await readBody(req)) as {
        moduleId:  string;
        filename:  string;   // without extension
        pgnText:   string;
      };

      const { moduleId, filename, pgnText } = body;

      if (!moduleId || !filename || !pgnText) {
        json(res, 400, { ok: false, error: "Missing moduleId, filename, or pgnText" });
        return;
      }

      // Sanitise filename
      const safe = filename
        .replace(/\.pgn$/, "")
        .replace(/[^a-zA-Z0-9_-]/g, "-");

      const dir      = path.join(MODULES_DIR, moduleId.replace("module-", "module"));
      const filePath = path.join(dir, `${safe}.pgn`);

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, pgnText, "utf8");

      console.log(`[save-pgn] ✓ ${filePath}`);
      json(res, 200, { ok: true, path: filePath });

    } catch (err) {
      console.error("[save-pgn] Error:", err);
      json(res, 500, { ok: false, error: String(err) });
    }
    return;
  }

  // ── POST /api/save-lesson (legacy JSON) ──────────────────────────────────
  if (req.url === "/api/save-lesson") {
    try {
      const body = JSON.parse(await readBody(req)) as {
        moduleId:   string;
        filename:   string;
        lessonData: object;
      };

      const { moduleId, filename, lessonData } = body;

      if (!moduleId || !filename || !lessonData) {
        json(res, 400, { ok: false, error: "Missing fields" });
        return;
      }

      const safe     = filename.replace(/\.json$/, "").replace(/[^a-zA-Z0-9_-]/g, "-");
      const dir      = path.join(MODULES_DIR, moduleId.replace("module-", "module"));
      const filePath = path.join(dir, `${safe}.json`);

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(lessonData, null, 2), "utf8");

      console.log(`[save-lesson] ✓ ${filePath}`);
      json(res, 200, { ok: true, path: filePath });

    } catch (err) {
      console.error("[save-lesson] Error:", err);
      json(res, 500, { ok: false, error: String(err) });
    }
    return;
  }

  json(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`\n✓ Sync server running on http://localhost:${PORT}`);
  console.log("  POST /api/save-pgn    — save .pgn lesson files");
  console.log("  POST /api/save-lesson — save .json lesson files (legacy)\n");
});