#!/usr/bin/env node
/**
 * Validates the public/ directory before deployment:
 * - kebab-case filenames (lowercase, alphanumeric, dashes)
 * - allowed extensions
 * - maximum file size limits
 * - existence of public/_headers
 */
import { readdir, stat, access } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");

const ALLOWED_EXTENSIONS = new Set([".svg", ".png", ".webp", ".avif", ".jpg", ".jpeg", ".ico"]);
const RESERVED_FILES = new Set(["_headers", "_redirects", "_routes.json", "404.html", "index.html"]);
const EXCLUDED_DIRS = new Set(["_ui"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const WARN_FILE_SIZE = 1024 * 1024; // 1 MB

const NAME_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

const errors = [];
const warnings = [];
let checked = 0;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || EXCLUDED_DIRS.has(entry.name)) continue;
      if (!NAME_PATTERN.test(entry.name)) {
        errors.push(`Invalid directory name: ${relative(ROOT, fullPath)}`);
      }
      await walk(fullPath);
      continue;
    }

    if (!entry.isFile()) continue;

    const rel = relative(ROOT, fullPath).replaceAll("\\", "/");
    if (RESERVED_FILES.has(entry.name) || entry.name.startsWith(".")) continue;

    checked += 1;

    const ext = extname(entry.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      errors.push(`Disallowed extension (${ext || "no extension"}): ${rel}`);
    }

    const baseName = entry.name.slice(0, -ext.length);
    if (!NAME_PATTERN.test(baseName)) {
      errors.push(`Invalid name (must use lowercase kebab-case): ${rel}`);
    }

    const info = await stat(fullPath);
    if (info.size > MAX_FILE_SIZE) {
      errors.push(`File too large (${(info.size / 1024 / 1024).toFixed(1)} MB): ${rel}`);
    } else if (info.size > WARN_FILE_SIZE) {
      warnings.push(`Large file (${(info.size / 1024).toFixed(0)} KB): ${rel}`);
    }

    if (info.size === 0) {
      errors.push(`Empty file: ${rel}`);
    }
  }
}

if (!(await exists(PUBLIC_DIR))) {
  console.error("The public/ directory does not exist.");
  process.exit(1);
}

if (!(await exists(join(PUBLIC_DIR, "_headers")))) {
  errors.push("Missing public/_headers (required for CORS and caching).");
}

await walk(PUBLIC_DIR);

for (const warning of warnings) {
  console.warn(`WARNING: ${warning}`);
}

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s):`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(`OK: ${checked} asset(s) validated in public/.`);
