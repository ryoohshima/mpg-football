// MPG 移籍データ可視化スクリプト（静的 HTML 生成）
//
// data/*.json を読み込み、選手リストを自動検出して dist/index.html を生成する。
// 取得 JSON の構造に依存しないよう、キー名のパターンから表示軸を推定する。
//
// 使い方: node src/visualize.mjs && open dist/index.html

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// JSON から「オブジェクトの配列」を最長のものとして拾い、選手リストと見なす
export function findPlayerList(json) {
  let best = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      if (node.length > best.length && node.every((x) => x && typeof x === "object" && !Array.isArray(x))) best = node;
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(walk);
    }
  };
  walk(json);
  return best;
}

// 選手オブジェクトから表示名と数値軸（価格等）のキーを推定
export function detectFields(rows) {
  if (rows.length === 0) return { nameKey: null, valueKey: null };
  const keys = Object.keys(rows[0]);
  const nameKey =
    keys.find((k) => /(^|_)(last_?name|full_?name|player_?name|^name)$/i.test(k)) ??
    keys.find((k) => /name/i.test(k) && typeof rows[0][k] === "string") ??
    keys.find((k) => typeof rows[0][k] === "string");
  const numericKeys = keys.filter((k) => rows.every((r) => typeof r[k] === "number"));
  const valueKey =
    numericKeys.find((k) => /(price|value|quotation|amount|bid|cost)/i.test(k)) ?? numericKeys[0] ?? null;
  return { nameKey, valueKey };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function renderSection(title, rows) {
  const { nameKey, valueKey } = detectFields(rows);
  const keys = rows.length ? Object.keys(rows[0]) : [];

  let bars = "";
  if (nameKey && valueKey) {
    const sorted = [...rows].sort((a, b) => (b[valueKey] ?? 0) - (a[valueKey] ?? 0)).slice(0, 20);
    const max = Math.max(1, ...sorted.map((r) => r[valueKey] ?? 0));
    bars = sorted
      .map((r) => {
        const w = Math.round(((r[valueKey] ?? 0) / max) * 100);
        return `<div class="bar-row"><span class="bar-label" title="${esc(r[nameKey])}">${esc(r[nameKey])}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${w}%"></span></span>
          <span class="bar-val">${esc(r[valueKey])}</span></div>`;
      })
      .join("");
    bars = `<h3>上位 ${sorted.length} 件（${esc(valueKey)}）</h3><div class="bars">${bars}</div>`;
  }

  const thead = keys.map((k) => `<th>${esc(k)}</th>`).join("");
  const tbody = rows
    .map((r) => `<tr>${keys.map((k) => `<td>${esc(typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k] ?? "")}</td>`).join("")}</tr>`)
    .join("");

  return `<section><h2>${esc(title)} <small>(${rows.length} 件)</small></h2>
    ${bars}
    <details><summary>全データを表で見る</summary>
      <div class="table-wrap"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>
    </details></section>`;
}

function main() {
  const dataDir = join(ROOT, "data");
  let files;
  try {
    files = readdirSync(dataDir).filter((f) => f.endsWith(".json") && f !== "dashboard.json");
  } catch {
    console.error("data/ が無いでござる。先に node src/fetch.mjs を実行してくだされ。");
    process.exit(1);
  }
  if (files.length === 0) {
    console.error("data/ に移籍データが無い。先に node src/fetch.mjs を実行してくだされ。");
    process.exit(1);
  }

  const sections = files
    .map((f) => {
      const json = JSON.parse(readFileSync(join(dataDir, f), "utf8"));
      const rows = findPlayerList(json);
      return rows.length ? renderSection(f.replace(/\.json$/, ""), rows) : "";
    })
    .filter(Boolean)
    .join("\n");

  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MPG 移籍データ</title>
<style>
  :root{--bg:#ffffff;--ink:#1a1a1a;--muted:#6b7280;--line:#e5e7eb;--surface:#f9fafb;--accent:#3b82f6}
  @media(prefers-color-scheme:dark){:root{--bg:#0f1115;--ink:#e6e6e6;--muted:#9aa0a6;--line:#2a2d34;--surface:#171a21;--accent:#60a5fa}}
  *{box-sizing:border-box}
  body{margin:0;padding:24px;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink);max-width:960px;margin-inline:auto}
  h1{font-size:22px}small{color:var(--muted);font-weight:400}
  section{margin:32px 0;padding-top:8px;border-top:1px solid var(--line)}
  .bars{display:flex;flex-direction:column;gap:6px;margin:12px 0}
  .bar-row{display:grid;grid-template-columns:160px 1fr 64px;align-items:center;gap:8px}
  .bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
  .bar-track{background:var(--surface);border-radius:4px;height:16px;overflow:hidden}
  .bar-fill{display:block;height:100%;background:var(--accent);border-radius:4px}
  .bar-val{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
  .table-wrap{overflow-x:auto}
  table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
  th,td{padding:4px 8px;border:1px solid var(--line);text-align:left;white-space:nowrap}
  th{background:var(--surface)}
  details{margin-top:8px}summary{cursor:pointer;color:var(--accent)}
</style></head>
<body>
<h1>MPG 移籍データ <small>スナップショット</small></h1>
${sections || "<p>表示できる選手リストが見つからなかったでござる。data/ の中身を確認してくだされ。</p>"}
</body></html>`;

  mkdirSync(join(ROOT, "dist"), { recursive: true });
  writeFileSync(join(ROOT, "dist", "index.html"), html);
  console.log("生成完了: dist/index.html");
}

// self-check: node src/visualize.mjs --check
if (process.argv.includes("--check")) {
  const sample = { data: { players: [{ lastName: "Mbappé", position: "A", price: 90 }, { lastName: "Haaland", position: "A", price: 88 }] } };
  const rows = findPlayerList(sample);
  console.assert(rows.length === 2, "findPlayerList が選手配列を検出できていない");
  const { nameKey, valueKey } = detectFields(rows);
  console.assert(nameKey === "lastName", `nameKey 誤検出: ${nameKey}`);
  console.assert(valueKey === "price", `valueKey 誤検出: ${valueKey}`);
  console.log("self-check OK");
} else {
  main();
}
