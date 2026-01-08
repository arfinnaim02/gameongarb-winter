import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const PRODUCTS_DIR = path.join(ROOT, "public", "assets", "products");
const OUT_FILE = path.join(PRODUCTS_DIR, "manifest.json");

function isImage(file) {
  return /\.(png|jpg|jpeg|webp)$/i.test(file);
}

function safeList(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

const manifest = {};
const productFolders = safeList(PRODUCTS_DIR).filter(f => {
  const full = path.join(PRODUCTS_DIR, f);
  return fs.existsSync(full) && fs.statSync(full).isDirectory();
});

for (const folder of productFolders) {
  const full = path.join(PRODUCTS_DIR, folder);
  const files = safeList(full)
    .filter(isImage)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  manifest[folder] = files;
}

fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2), "utf8");
console.log("✅ manifest created:", OUT_FILE);
