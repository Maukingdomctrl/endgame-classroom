/**
 * syncServer.ts  (run with: npx tsx syncServer.ts)
 *
 * Lightweight dev server that handles lesson file saves.
 * Listens on port 5174.
 *
 * Endpoints:
 * GET  /api/list-modules — returns list of available module directories
 * GET  /api/get-pgn      — reads and combines all .pgn files in a module
 * POST /api/save-pgn     — writes a .pgn file  (NEW — used by BoardEditor)
 * POST /api/save-lesson  — writes a .json file (LEGACY — remove when migrated)
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

  const reqUrl = req.url || "/";
  const parsedUrl = url.parse(reqUrl, true);
  const pathname = parsedUrl.pathname;

  // ── GET Endpoints ───────────────────────────────────────────────────────────
  if (req.method === "GET") {
    // 1. GET /api/list-modules
    if (pathname === "/api/list-modules") {
      try {
        if (!fs.existsSync(MODULES_DIR)) {
          json(res, 200, { ok: true, modules: [] });
          return;
        }
        
        // Read directory and filter for subdirectories only
        const modules = fs.readdirSync(MODULES_DIR, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);
          
        console.log(`[list-modules] ✓ Found ${modules.length} modules`);
        json(res, 200, { ok: true, modules });
      } catch (err) {
        console.error("[list-modules] Error:", err);
        json(res, 500, { ok: false, error: String(err) });
      }
      return;
    }

    // 2. GET /api/get-pgn?moduleId=...
    if (pathname === "/api/get-pgn") {
      try {
        const moduleId = parsedUrl.query.moduleId as string;
        
        if (!moduleId) {
          json(res, 400, { ok: false, error: "Missing moduleId query parameter" });
          return;
        }

        const dir = path.join(MODULES_DIR, moduleId.replace("module-", "module"));
        
        if (!fs.existsSync(dir)) {
          json(res, 404, { ok: false, error: `Module directory not found: ${dir}` });
          return;
        }

        // Find all .pgn files, sort alphabetically, and concatenate their contents
        const files = fs.readdirSync(dir)
          .filter(file => file.endsWith('.pgn'))
          .sort();
          
        let combinedPgnText = "";
        
        for (const file of files) {
          const filePath = path.join(dir, file);
          const fileContent = fs.readFileSync(filePath, "utf8");
          // Add a newline between file contents to ensure clean separation
          combinedPgnText += fileContent + "\n\n"; 
        }

        console.log(`[get-pgn] ✓ Read ${files.length} files for ${moduleId}`);
        json(res, 200, { ok: true, pgnText: combinedPgnText.trim() });
      } catch (err) {
        console.error("[get-pgn] Error:", err);
        json(res, 500, { ok: false, error: String(err) });
      }
      return;
    }
    
    // If GET but not a matched route, let it fall through to 404
  }

  // ── POST Endpoints ──────────────────────────────────────────────────────────
  if (req.method === "POST") {
    // 1. POST /api/save-pgn
    if (pathname === "/api/save-pgn") {
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

    // 2. POST /api/save-lesson (legacy JSON)
    if (pathname === "/api/save-lesson") {
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
  }

  // ── Fallback ────────────────────────────────────────────────────────────────
  json(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`\n✓ Sync server running on http://localhost:${PORT}`);
  console.log("  GET  /api/list-modules — list available modules");
  console.log("  GET  /api/get-pgn      — retrieve combined PGN for a module");
  console.log("  POST /api/save-pgn     — save .pgn lesson files");
  console.log("  POST /api/save-lesson  — save .json lesson files (legacy)\n");
});