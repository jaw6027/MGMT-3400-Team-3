import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const outputDirectory = `work/browser-preview-dist-${process.pid}`;
const build = spawnSync(
  process.execPath,
  [
    "node_modules/expo/bin/cli",
    "export",
    "--platform",
    "web",
    "--output-dir",
    outputDirectory,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_PUBLIC_BROWSER_PREVIEW: "true",
      EXPO_PUBLIC_DEMO_MODE: "false",
      EXPO_PUBLIC_SUPABASE_URL: "",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "",
      EXPO_NO_TELEMETRY: "1",
      EXPO_OFFLINE: "1",
    },
  },
);
if (build.status !== 0) process.exit(build.status || 1);
const base = path.join(root, outputDirectory);
const walk = (p) =>
  fs
    .readdirSync(p, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(p, e.name)) : [path.join(p, e.name)],
    );
const assets = walk(path.join(base, "assets")).map((file) => ({
  uri: "/" + path.relative(base, file).split(path.sep).join("/"),
  file,
}));
const mime = (file) =>
  ({
    ".ttf": "font/ttf",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  })[path.extname(file)] || "application/octet-stream";
const inline = (file) =>
  `data:${mime(file)};base64,${fs.readFileSync(file).toString("base64")}`;
let html = fs.readFileSync(path.join(base, "index.html"), "utf8");
html = html.replace(
  /<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,
  (_tag, url) => {
    let js = fs.readFileSync(path.join(base, url.replace(/^\//, "")), "utf8");
    for (const asset of assets)
      js = js.split(asset.uri).join(inline(asset.file));
    js = js.replace(/<\/script/gi, "<\\/script");
    return `<script>${js}</script>`;
  },
);
html = html.replace(
  /<link rel="icon"[^>]*>/g,
  `<link rel="icon" href="data:image/png;base64,${fs.readFileSync("assets/favicon.png").toString("base64")}" />`,
);
html = html.replace(
  "<title>SplitCart</title>",
  '<title>SplitCart — Interactive Browser Preview</title><meta name="description" content="Try all SplitCart screens with local preview accounts, household codes, receipts, fair splits, balances and simulated payments. No installation or backend setup required." />',
);
if (/<script\b[^>]*src=/.test(html))
  throw new Error("Preview still references external scripts.");
fs.mkdirSync("preview", { recursive: true });
const temporaryFile = `preview/.index-${process.pid}.html`;
fs.writeFileSync(temporaryFile, html);
fs.renameSync(temporaryFile, "preview/index.html");
fs.rmSync(base, { recursive: true, force: true });
console.log(
  `Self-contained browser preview: ${path.join(root, "preview/index.html")} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`,
);
