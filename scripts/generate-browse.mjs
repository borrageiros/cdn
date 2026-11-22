#!/usr/bin/env node
/**
 * Generates the directory listing pages (Nginx autoindex format) that
 * PrettyIndex turns into the browsing UI. Runs before every deploy; the
 * generated index.html files are never committed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const UI_DIR = join(PUBLIC_DIR, "_ui");

const UI_BASE_URL = (
  process.env.PRETTYINDEX_BASE_URL ??
  "https://cdn.jsdelivr.net/gh/borrageiros/PrettyIndex@latest/dist"
).replace(/\/$/, "");

const EXCLUDED_DIRS = new Set(["_ui"]);
const EXCLUDED_FILES = new Set([
  "_headers",
  "_redirects",
  "_routes.json",
  "index.html",
  "404.html",
]);

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function gitTimestamp(repoRelativePath) {
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%ct", "--", repoRelativePath],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const timestamp = Number(out);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  } catch {
    return null;
  }
}

function timestampFor(absPath, info) {
  const repoRelativePath = relative(ROOT, absPath).split("\\").join("/");
  return gitTimestamp(repoRelativePath) ?? Math.floor(info.mtimeMs / 1000);
}

function isoDate(timestamp) {
  return new Date(timestamp * 1000).toISOString();
}

function row(name, href, timestamp, size) {
  const sizeCell = size === null ? "-" : String(size);
  return `<a href="${href}">${escapeHtml(name)}</a>    ${isoDate(timestamp)}    ${sizeCell}`;
}

function renderPage(urlPath, rows, withParent, uiCss, uiJs) {
  const parent = withParent ? '<a href="../">../</a>\n' : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Index of ${escapeHtml(urlPath)}</title>
  <link rel="stylesheet" href="${uiCss}" data-prettyindex-css>
</head>
<body>
  <h1>Index of ${escapeHtml(urlPath)}</h1>
  <pre>${parent}${rows.join("\n")}
</pre>
  <script src="${uiJs}" defer></script>
</body>
</html>
`;
}

function renderNotFoundPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 - Not Found</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      background: #0b1020;
      color: #e2e8f0;
    }
    main { max-width: 34rem; text-align: center; }
    h1 { margin: 0; font-size: clamp(3rem, 12vw, 6rem); letter-spacing: -0.04em; }
    p { color: #94a3b8; line-height: 1.6; }
    code { color: #22d3ee; word-break: break-all; }
    a {
      display: inline-block;
      margin-top: 0.75rem;
      padding: 0.65rem 1.1rem;
      border-radius: 999px;
      background: #7c3aed;
      color: #fff;
      font-weight: 600;
      text-decoration: none;
    }
    a:hover { background: #6d28d9; }
  </style>
</head>
<body>
  <main>
    <h1>404</h1>
    <p>The resource <code id="path"></code> does not exist on this CDN.</p>
    <p><a href="/">Back to index</a></p>
  </main>
  <script>document.getElementById("path").textContent = location.pathname;</script>
</body>
</html>
`;
}

async function download(url) {
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { "user-agent": "cdn-borrageiros-build" },
    });
  } catch (error) {
    throw new Error(`Could not download ${url}: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

async function prepareUiAssets() {
  const [js, css] = await Promise.all([
    download(`${UI_BASE_URL}/prettyindex.js`),
    download(`${UI_BASE_URL}/prettyindex.css`),
  ]);

  if (!js.includes("PrettyIndex") || js.length < 1000) {
    throw new Error(`Downloaded prettyindex.js from ${UI_BASE_URL} looks invalid.`);
  }
  if (css.length < 1000) {
    throw new Error(`Downloaded prettyindex.css from ${UI_BASE_URL} looks invalid.`);
  }

  const hash = createHash("sha256")
    .update(js)
    .update(css)
    .digest("hex")
    .slice(0, 8);

  await mkdir(UI_DIR, { recursive: true });
  for (const name of await readdir(UI_DIR)) {
    if (/^prettyindex\.[a-f0-9]+\.(js|css)$/.test(name)) {
      await rm(join(UI_DIR, name), { force: true });
    }
  }

  const jsName = `prettyindex.${hash}.js`;
  const cssName = `prettyindex.${hash}.css`;
  await writeFile(join(UI_DIR, jsName), js, "utf8");
  await writeFile(join(UI_DIR, cssName), css, "utf8");

  console.log(`UI: ${UI_BASE_URL} -> /_ui/${jsName}`);
  return { uiJs: `/_ui/${jsName}`, uiCss: `/_ui/${cssName}` };
}

async function collectEntries(absDir) {
  const entries = await readdir(absDir, { withFileTypes: true });
  const dirs = [];
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) dirs.push(entry.name);
    } else if (entry.isFile() && !EXCLUDED_FILES.has(entry.name)) {
      files.push(entry.name);
    }
  }

  dirs.sort(collator.compare);
  files.sort(collator.compare);
  return { dirs, files };
}

async function generateDirectory(absDir, uiJs, uiCss, counter) {
  const rel = relative(PUBLIC_DIR, absDir).split("\\").join("/");
  const urlPath = rel ? `/${rel}/` : "/";
  const { dirs, files } = await collectEntries(absDir);
  const rows = [];

  for (const dir of dirs) {
    const absPath = join(absDir, dir);
    const info = await stat(absPath);
    rows.push(
      row(`${dir}/`, `${encodeURIComponent(dir)}/`, timestampFor(absPath, info), null),
    );
  }

  for (const file of files) {
    const absPath = join(absDir, file);
    const info = await stat(absPath);
    rows.push(row(file, encodeURIComponent(file), timestampFor(absPath, info), info.size));
  }

  await writeFile(
    join(absDir, "index.html"),
    renderPage(urlPath, rows, rel !== "", uiCss, uiJs),
    "utf8",
  );
  counter.total += 1;

  for (const dir of dirs) {
    await generateDirectory(join(absDir, dir), uiJs, uiCss, counter);
  }
}

const { uiJs, uiCss } = await prepareUiAssets();
const counter = { total: 0 };
await writeFile(join(PUBLIC_DIR, "404.html"), renderNotFoundPage(), "utf8");
await generateDirectory(PUBLIC_DIR, uiJs, uiCss, counter);
console.log(`OK: ${counter.total} listing page(s) and 404.html generated.`);
