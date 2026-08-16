// MPG 移籍データ取得スクリプト（スナップショット型）
//
// .env の MPG_TOKEN で api.mpg.football を叩き、所属ディビジョンの
// 移籍関連データを data/*.json に保存する。
//
// 使い方: node src/fetch.mjs
//
// エンドポイント・認証方式は mpg.football のフロントバンドルから確認したもの。
// 認証は Auth0 のアクセストークン（Bearer）。トークンはブラウザの localStorage から取得する（.env.example 参照）。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.mpg.football";
// SPA が axios 共通ヘッダに仕込む識別子。欠けると 400 になる（フロント v13.2.0 由来）
const CLIENT_VERSION = "13.2.0";

// .env を最小パース（依存を足さない）
function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* .env なしは下でエラーにする */
  }
  return env;
}

async function api(path, token, clientVersion, { method = "GET", body } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    platform: "web",
    application: "mpg",
    "client-version": clientVersion || CLIENT_VERSION,
    "client-language": "fr-FR",
  };

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} -> ${res.status} ${res.statusText}\n${text.slice(0, 500)}`);
  }
  return res.json();
}

function save(name, data) {
  const file = join(ROOT, "data", `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`  saved data/${name}.json`);
}

// dashboard のレスポンスから division id を柔軟に拾う（構造差分に強くする）
export function extractDivisionIds(dashboard) {
  const ids = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    for (const [k, v] of Object.entries(node)) {
      if ((k === "divisionId" || k === "id") && typeof v === "string" && /division|mpg/i.test(v)) ids.add(v);
      if (k === "divisions" && Array.isArray(v)) for (const d of v) if (d?.id) ids.add(d.id);
      walk(v);
    }
  };
  walk(dashboard);
  return [...ids];
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const token = env.MPG_TOKEN;
  if (!token) {
    console.error("MPG_TOKEN が未設定でござる。.env.example を参照してトークンを設定してくだされ。");
    process.exit(1);
  }
  const clientVersion = env.MPG_CLIENT_VERSION;

  console.log("dashboard を取得中...");
  const dashboard = await api("/dashboard", token, clientVersion);
  save("dashboard", dashboard);

  const divisionIds = extractDivisionIds(dashboard);
  if (divisionIds.length === 0) {
    console.warn("dashboard から division id を特定できず。data/dashboard.json を確認し、必要なら MPG_DIVISION_ID を .env に設定してくだされ。");
  }
  const targets = env.MPG_DIVISION_ID ? [env.MPG_DIVISION_ID] : divisionIds;
  console.log(`対象ディビジョン: ${targets.join(", ") || "(なし)"}`);

  // 移籍関連エンドポイント（実リクエスト捕獲で確認済み）
  // - traders / transfersExperts / transfersLosers: 常時取得できる移籍成績ランキング（本命）
  // - best-available-players / sales-and-bids: 移籍期間中のみ有効。失敗時は skip
  for (const id of targets) {
    console.log(`division ${id} の移籍データを取得中...`);
    const jobs = [
      ["traders", `/division-ranking/division/${id}/traders?ignoreLive=false`, { method: "GET" }],
      ["transfers-experts", `/division-ranking/division/${id}/transfersExperts?ignoreLive=false`, { method: "GET" }],
      ["transfers-losers", `/division-ranking/division/${id}/transfersLosers?ignoreLive=false`, { method: "GET" }],
      ["best-available-players", `/division/${id}/best-available-players`, { method: "GET" }],
      ["sales-and-bids", `/division/${id}/sales-and-bids`, { method: "POST", body: {} }],
    ];
    for (const [name, path, opts] of jobs) {
      try {
        const data = await api(path, token, clientVersion, opts);
        save(`${id}__${name}`, data);
      } catch (e) {
        console.warn(`  skip ${name}: ${e.message.split("\n")[0]}`);
      }
    }
  }

  console.log("完了。次は node src/visualize.mjs でござる。");
}

// self-check: node src/fetch.mjs --check
if (process.argv.includes("--check")) {
  const sample = { leagues: [{ divisions: [{ id: "mpg_division_A" }, { id: "mpg_division_B" }] }] };
  const ids = extractDivisionIds(sample);
  console.assert(ids.includes("mpg_division_A") && ids.includes("mpg_division_B"), `division id 抽出失敗: ${ids}`);
  console.log("self-check OK");
} else {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
