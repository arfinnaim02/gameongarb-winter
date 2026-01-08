import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import crypto from "crypto";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ✅ If you serve frontend + backend from same server, CORS isn't needed,
// but keeping it doesn't hurt.
app.use(cors());

// ✅ Parse JSON safely
app.use(express.json({ limit: "2mb" }));

// Paths
const ROOT = path.resolve(__dirname, "..");             // winter landing page/
const PUBLIC_DIR = path.join(ROOT, "public");          // winter landing page/public
const DATA_FILE = path.join(__dirname, "orders.json"); // winter landing page/server/orders.json

// Ensure orders.json exists
function ensureOrdersFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ orders: [] }, null, 2), "utf8");
  }
}
ensureOrdersFile();

function readOrders() {
  ensureOrdersFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { orders: [] };
    if (!Array.isArray(parsed.orders)) parsed.orders = [];
    return parsed;
  } catch {
    // ✅ if JSON got corrupted, auto-recover
    return { orders: [] };
  }
}

function writeOrders(db) {
  // ✅ atomic write to prevent corruption
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function makeOrderId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "GG-";
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ✅ small helper: auth check (token optional if ADMIN_TOKEN missing)
function isAuthorized(req) {
  const adminToken = String(process.env.ADMIN_TOKEN || "").trim();
  const token = String(req.headers["x-admin-token"] || req.query.token || "").trim();
  if (!adminToken) return true;
  return token === adminToken;
}

// ✅ Serve frontend static files
app.use(express.static(PUBLIC_DIR));

// ✅ Health check
app.get("/api/health", (req, res) => {
  const adminToken = String(process.env.ADMIN_TOKEN || "").trim();
  res.json({
    ok: true,
    time: new Date().toISOString(),
    tokenRequired: !!adminToken
  });
});

// ✅ Debug endpoint (kept because your admin uses it)
app.get("/api/debug", (req, res) => {
  try {
    ensureOrdersFile();
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    let count = 0;
    try {
      const parsed = JSON.parse(raw);
      count = Array.isArray(parsed?.orders) ? parsed.orders.length : 0;
    } catch {
      count = 0;
    }
    const stat = fs.statSync(DATA_FILE);

    res.json({
      ok: true,
      serverInstance: "srv-" + crypto.randomBytes(4).toString("hex"),
      ordersFile: DATA_FILE,
      fileSizeBytes: stat.size,
      ordersCount: count
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "debug failed" });
  }
});

// ✅ Create order (more tolerant + better error messages)
app.post("/api/order", (req, res) => {
  try {
    const body = req.body || {};

    // ✅ Debug log so you can see incoming payload in CMD
    console.log("🟦 ORDER REQUEST:", body);

    // ---- Validate required fields (tolerant) ----
    const productId = String(body.productId || "").trim();
    const productName = String(body.productName || "").trim();
    const productLink = body.productLink ? String(body.productLink) : "";

    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const address = String(body.address || "").trim();

    // qty + unitPrice may come as string
    const qty = Number(body.qty || 1);
    const unitPrice = Number(body.unitPrice || 0);

    // area may come as "Dhaka", "dhaka ", etc.
    const areaRaw = String(body.area || "").trim().toLowerCase();
    let area = "";
    if (areaRaw === "dhaka") area = "dhaka";
    else if (areaRaw === "outside" || areaRaw === "outside dhaka") area = "outside";

    if (!productId) return res.status(400).json({ ok: false, error: "Missing productId" });
    if (!productName) return res.status(400).json({ ok: false, error: "Missing productName" });
    if (!name) return res.status(400).json({ ok: false, error: "Missing customer name" });
    if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });
    if (!address) return res.status(400).json({ ok: false, error: "Missing address" });

    if (!Number.isFinite(qty) || qty < 1) {
      return res.status(400).json({ ok: false, error: "Invalid qty" });
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid unitPrice" });
    }
    if (!area) {
      return res.status(400).json({ ok: false, error: "Invalid area. Use dhaka / outside" });
    }

    // Shipping
    const ship = area === "dhaka" ? 70 : 130;
    const total = qty * unitPrice + ship;

    const order = {
      orderId: makeOrderId(),
      createdAt: new Date().toISOString(),
      status: "new",
      productId,
      productName,
      productLink,
      unitPrice,
      qty,
      size: body.size ? String(body.size) : "",
      area,
      shipping: ship,
      total,
      customer: { name, phone, address }
    };

    const db = readOrders();
    db.orders.unshift(order);
    writeOrders(db);

    console.log("✅ ORDER SAVED:", order.orderId);

    return res.json({ ok: true, orderId: order.orderId });

  } catch (e) {
    console.error("❌ ORDER ERROR:", e);
    return res.status(500).json({ ok: false, error: "Server error: " + (e.message || e) });
  }
});

// ✅ Admin list orders (token optional)
app.get("/api/orders", (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const db = readOrders();
    return res.json({ ok: true, orders: db.orders || [] });

  } catch (e) {
    console.error("❌ ORDERS LIST ERROR:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Admin update status (optional)
app.patch("/api/orders/:orderId", (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const { orderId } = req.params;
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ ok: false, error: "Missing status" });

    const db = readOrders();
    const idx = (db.orders || []).findIndex(o => o.orderId === orderId);
    if (idx === -1) return res.status(404).json({ ok: false, error: "Not found" });

    db.orders[idx].status = String(status);
    writeOrders(db);

    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ PATCH ERROR:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ✅ NEW: Delete single order (hard delete)
app.delete("/api/orders/:orderId", (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const { orderId } = req.params;
    const db = readOrders();
    const before = db.orders.length;
    db.orders = db.orders.filter(o => o.orderId !== orderId);
    const after = db.orders.length;

    if (before === after) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    writeOrders(db);
    return res.json({ ok: true, deleted: 1 });
  } catch (e) {
    console.error("❌ DELETE ERROR:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ✅ NEW: Bulk delete (hard delete)
app.post("/api/orders/bulk-delete", (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const ids = Array.isArray(req.body?.orderIds) ? req.body.orderIds.map(String) : [];
    if (ids.length === 0) {
      return res.status(400).json({ ok: false, error: "orderIds required" });
    }

    const set = new Set(ids);
    const db = readOrders();
    const before = db.orders.length;
    db.orders = db.orders.filter(o => !set.has(String(o.orderId)));
    const deleted = before - db.orders.length;

    writeOrders(db);
    return res.json({ ok: true, deleted });
  } catch (e) {
    console.error("❌ BULK DELETE ERROR:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
  console.log(`✅ Health: http://localhost:${PORT}/api/health`);
  console.log(`✅ Admin: http://localhost:${PORT}/admin.html`);
});
