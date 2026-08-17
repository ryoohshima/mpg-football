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

function readSaved(name) {
  return JSON.parse(readFileSync(join(ROOT, "data", `${name}.json`), "utf8"));
}

// dashboard のレスポンスから division id を拾う。
// tournament / team を除外するため mpg_division_ 始まりのみに限定する
// （division-ranking はディビジョン専用で、他エンティティを渡すと 400 になる）。
export function extractDivisionIds(dashboard) {
  const ids = new Set();
  const walk = (node) => {
    if (typeof node === "string") {
      if (/^mpg_division_/.test(node)) ids.add(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(walk);
    }
  };
  walk(dashboard);
  return [...ids];
}

// championshipId は gameSettings 配下にあるが、位置に依存せず拾う
export function extractChampionshipIds(node, found = new Set()) {
  if (Array.isArray(node)) {
    node.forEach((v) => extractChampionshipIds(v, found));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "championshipId" && typeof v === "number") found.add(v);
      else extractChampionshipIds(v, found);
    }
  }
  return found;
}

// mpg_division_PHDHUA3Z_9_1 -> mpg_league_PHDHUA3Z
// dashboard は現行シーズンしか返さないため、リーグ経由で過去シーズンを辿る
export function toLeagueId(divisionId) {
  const m = divisionId.match(/^mpg_division_([^_]+)_/);
  return m ? `mpg_league_${m[1]}` : null;
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

  const divisionIds = new Set(extractDivisionIds(dashboard));
  if (divisionIds.size === 0) {
    console.warn("dashboard から division id を特定できず。data/dashboard.json を確認し、必要なら MPG_DIVISION_ID を .env に設定してくだされ。");
  }

  // 過去シーズンのディビジョンをリーグ情報から収集（現行シーズンは未開始で空のことがある）
  const championshipIds = new Set();
  for (const leagueId of new Set([...divisionIds].map(toLeagueId).filter(Boolean))) {
    try {
      const league = await api(`/league/${leagueId}`, token, clientVersion);
      save(leagueId, league);
      for (const id of extractDivisionIds(league)) divisionIds.add(id);
      for (const cid of extractChampionshipIds(league)) championshipIds.add(cid);
    } catch (e) {
      console.warn(`  skip ${leagueId}: ${e.message.split("\n")[0]}`);
    }
  }

  // 選手プール: transfersExperts 等が返す playerId を名前に解決するために必要
  for (const cid of championshipIds) {
    try {
      save(`players-${cid}`, await api(`/championship-players-pool/${cid}/details`, token, clientVersion));
    } catch (e) {
      console.warn(`  skip players-${cid}: ${e.message.split("\n")[0]}`);
    }
  }

  const targets = env.MPG_DIVISION_ID
    ? env.MPG_DIVISION_ID.split(",").map((s) => s.trim()).filter(Boolean)
    : [...divisionIds];
  console.log(`対象ディビジョン(${targets.length}): ${targets.join(", ") || "(なし)"}`);

  // 移籍関連エンドポイント（実リクエスト捕獲で確認済み）
  // - traders / transfersExperts / transfersLosers: 完了シーズンの移籍成績ランキング（本命）
  // - best-available-players: 移籍期間中のディビジョンでのみ意味がある。失敗時は skip
  const transferPlayerIds = new Set();
  for (const id of targets) {
    console.log(`division ${id} の移籍データを取得中...`);
    const jobs = [
      // 全取引の記録（フェーズ別の入札/落札・シーズン中の売買）。可視化の主データ
      ["history", `/division-history/division/${id}`, { method: "GET" }],
      ["traders", `/division-ranking/division/${id}/traders?ignoreLive=false`, { method: "GET" }],
      ["transfers-experts", `/division-ranking/division/${id}/transfersExperts?ignoreLive=false`, { method: "GET" }],
      ["transfers-losers", `/division-ranking/division/${id}/transfersLosers?ignoreLive=false`, { method: "GET" }],
      ["best-available-players", `/division/${id}/best-available-players`, { method: "GET" }],
    ];
    for (const [name, path, opts] of jobs) {
      try {
        const data = await api(path, token, clientVersion, opts);
        save(`${id}__${name}`, data);
        for (const r of data.transfersExperts ?? data.transfersLosers ?? []) {
          if (r?.playerId) transferPlayerIds.add(r.playerId);
        }
      } catch (e) {
        console.warn(`  skip ${name}: ${e.message.split("\n")[0]}`);
      }
    }
  }

  // 選手プールは現行シーズン分のみのため、離脱済みの選手は個別に取得する。
  // /championship-player/{id} は過去の選手も名前を返す（1件 1KB 未満）。
  const pooled = new Set();
  for (const cid of championshipIds) {
    try {
      for (const p of readSaved(`players-${cid}`)?.players ?? []) if (p?.id) pooled.add(p.id);
    } catch {
      /* プール未取得なら全件を個別取得する */
    }
  }
  const missing = [...transferPlayerIds].filter((id) => !pooled.has(id));
  if (missing.length > 0) {
    console.log(`プール未収録の選手 ${missing.length} 件を個別取得中...`);
    const extra = {};
    for (const pid of missing) {
      try {
        const p = await api(`/championship-player/${pid}`, token, clientVersion);
        extra[pid] = { id: p.id, firstName: p.firstName, lastName: p.lastName };
      } catch (e) {
        console.warn(`  skip ${pid}: ${e.message.split("\n")[0]}`);
      }
    }
    save("players-extra", extra);
  }

  console.log("完了。次は node src/visualize.mjs でござる。");
}

// 直接実行時のみ動かす（import しただけで API を叩かないように）
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

// self-check: node src/fetch.mjs --check
if (!isMain) {
  // モジュールとして読み込まれた場合は何もしない
} else if (process.argv.includes("--check")) {
  const sample = {
    leagues: [{ divisions: [{ id: "mpg_division_PHDHUA3Z_9_1" }, { id: "mpg_division_NS4H8KEN_2_1" }] }],
    tournaments: [{ id: "mpg_tournament_REPRISE26" }, { id: "mpg_team_P316LP9W_1_1_1" }],
  };
  const ids = extractDivisionIds(sample);
  console.assert(ids.length === 2, `division 以外を拾っている: ${ids}`);
  console.assert(ids.includes("mpg_division_PHDHUA3Z_9_1"), `division id 抽出失敗: ${ids}`);
  console.assert(toLeagueId("mpg_division_PHDHUA3Z_9_1") === "mpg_league_PHDHUA3Z", "league id 導出失敗");
  console.log("self-check OK");
} else {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
