"use strict";
/* Token Boosting queue server. No dependencies. Needs Node 18 or newer. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = process.env.HOST_KEY || "";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const MAX_ENTRIES = 300;
const KEEP_FINISHED_MS = 24 * 3600 * 1000;

if (HOST_KEY.length < 8) {
  console.error("Set the HOST_KEY environment variable to a password of 8 or more characters. It unlocks the Host desk.");
  process.exit(1);
}

const sha = s => crypto.createHash("sha256").update(s).digest();
const HOST_DIGEST = sha(HOST_KEY);
const INDEX = fs.readFileSync(path.join(__dirname, "public", "index.html"));

/* ---- storage: one JSON file, written a moment after each change ---- */
let db = { v: 0, queue: {}, ops: {}, contact: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))); } catch (e) {}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DATA_FILE + ".tmp";
    try { fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DATA_FILE); } catch (e) { console.error("Could not save:", e.message); }
  }, 300);
}
function bump() { db.v++; save(); }

function dropPass(id) {
  delete db.queue[id]; delete db.contact[id];
  Object.keys(db.ops).forEach(k => { if (k.startsWith(id + "-")) delete db.ops[k]; });
}
function prune() {
  const cutoff = Date.now() - KEEP_FINISHED_MS; let changed = false;
  Object.keys(db.queue).forEach(id => {
    const e = db.queue[id], o = db.ops[id + "-" + e.ticket];
    if (o && o.status === "done" && (o.endedAt || 0) < cutoff) { dropPass(id); changed = true; }
  });
  if (changed) bump();
}
prune(); setInterval(prune, 3600 * 1000).unref();

/* ---- abuse limits (in memory) ---- */
const hits = new Map();
function limited(key, max, windowMs, count) {
  const now = Date.now(); let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  if (count !== false) h.n++;
  return h.n > max;
}
setInterval(() => { const now = Date.now(); hits.forEach((h, k) => { if (h.reset < now) hits.delete(k); }); }, 60000).unref();
const ipOf = req => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";

/* ---- who is asking ---- */
function auth(req) {
  const t = String(req.headers["x-token"] || "");
  const me = /^[a-f0-9]{48}$/.test(t) ? "p" + crypto.createHash("sha256").update(t).digest("hex").slice(0, 20) : null;
  const k = req.headers["x-host-key"];
  const host = typeof k === "string" && k.length > 0 && k.length < 200 && crypto.timingSafeEqual(sha(k), HOST_DIGEST);
  return { me, host };
}
function canWrite(col, id, a) { return a.host || (col !== "ops" && !!a.me && a.me === id); }

/* ---- validation ---- */
const cleanText = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
function cleanOps(b) {
  const o = {};
  ["paid", "skipPaid", "open", "online"].forEach(k => { if (typeof b[k] === "boolean") o[k] = b[k]; });
  if (["waiting", "playing", "done"].includes(b.status)) o.status = b.status;
  ["startedAt", "endedAt"].forEach(k => { if (Number.isFinite(b[k])) o[k] = b[k]; });
  return o;
}

/* ---- http helpers ---- */
const SECURITY = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; media-src data: blob:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};
function send(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, SECURITY));
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", c => { n += c.length; if (n > 4096) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      try { const o = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); resolve(o && typeof o === "object" && !Array.isArray(o) ? o : null); }
      catch (e) { resolve(null); }
    });
    req.on("error", reject);
  });
}

const DOC = /^\/api\/doc\/(queue|ops|contact)\/([A-Za-z0-9_.:-]{1,80})$/;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x"), ip = ipOf(req);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, Object.assign({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }, SECURITY));
      return res.end(INDEX);
    }
    if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });

    if (req.method === "GET" && url.pathname === "/api/state") {
      if (limited("r" + ip, 240, 60000)) return send(res, 429, { error: "Too many requests. Slow down." });
      const a = auth(req);
      const qv = url.searchParams.get("v");
      if (qv !== null && qv !== "" && Number(qv) === db.v) return send(res, 200, { unchanged: true });
      const contact = a.host ? db.contact : (a.me && db.contact[a.me] ? { [a.me]: db.contact[a.me] } : {});
      return send(res, 200, { v: db.v, me: a.me, host: a.host, queue: db.queue, ops: db.ops, contact });
    }

    if (req.method === "POST" && url.pathname === "/api/host-check") {
      if (limited("hf" + ip, 8, 600000, false)) return send(res, 429, { error: "Too many wrong passwords. Try again later." });
      if (!auth(req).host) { limited("hf" + ip, 8, 600000); return send(res, 401, { error: "Wrong password." }); }
      return send(res, 200, { ok: true });
    }

    const m = DOC.exec(url.pathname);
    if (m && (req.method === "PUT" || req.method === "DELETE")) {
      if (limited("w" + ip, 40, 60000)) return send(res, 429, { error: "Too many changes. Wait a minute and try again." });
      const col = m[1], id = m[2], a = auth(req);
      if (!canWrite(col, id, a)) return send(res, 403, { error: "You cannot change that." });

      if (req.method === "DELETE") {
        if (col === "queue") dropPass(id);
        else if (col === "contact") delete db.contact[id];
        else delete db.ops[id];
        bump(); return send(res, 200, { ok: true });
      }

      const b = await readBody(req);
      if (!b) return send(res, 400, { error: "That request was not valid." });

      if (col === "queue") {
        const tag = cleanText(b.tag, 24);
        if (!tag) return send(res, 400, { error: "Enter a gamertag so the host knows who to call." });
        const hours = b.hours === 2 ? 2 : 1, skip = b.skip === true;
        const old = db.queue[id], oldKey = old ? id + "-" + old.ticket : null;
        const finished = !!old && (db.ops[oldKey] || {}).status === "done";
        let ticket;
        if (!old || finished) {
          if (!a.host && db.ops.line && db.ops.line.open === false) return send(res, 403, { error: "The line is closed right now." });
          if (!old && Object.keys(db.queue).length >= MAX_ENTRIES) return send(res, 429, { error: "The line is full right now." });
          if (finished) delete db.ops[oldKey];
          ticket = Date.now();
        } else ticket = old.ticket;
        db.queue[id] = { tag, hours, skip, ticket };
      } else if (col === "contact") {
        const text = cleanText(b.text, 60);
        if (!text) delete db.contact[id]; else db.contact[id] = { text };
      } else {
        db.ops[id] = cleanOps(b);
      }
      bump(); return send(res, 200, { ok: true });
    }

    send(res, 404, { error: "Not found." });
  } catch (e) {
    send(res, 500, { error: "Something went wrong." });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log("Token Boosting is running on port " + PORT));
