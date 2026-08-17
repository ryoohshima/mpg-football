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

// mpg_division_PHDHUA3Z_9_1 -> mpg_league_PHDHUA3Z
// dashboard は現行シーズンしか返さないため、リーグ経由で過去シーズンを辿る
export function toLeagueId(divisionId) {
  const m = divisionId.match(/^mpg_division_([^_]+)_/);
  return m ? `mpg_league_${m[1]}` : null;
}

// mpg_division_PHDHUA3Z_9_1 -> { league:"PHDHUA3Z", season:9, division:1 }
export function parseDivisionId(divisionId) {
  const m = String(divisionId).match(/^mpg_division_(.+)_(\d+)_(\d+)$/);
  return m ? { league: m[1], season: Number(m[2]), division: Number(m[3]) } : null;
}

// league.divisionsIds は現行シーズン分のみ。ID の規則性と league.season（現在のシーズン番号）
// から過去シーズンの division id を組み立てる。存在しないものは取得時に 404 で弾かれる。
export function pastSeasonDivisionIds(divisionsIds, currentSeason) {
  const ids = new Set();
  for (const id of divisionsIds ?? []) {
    const p = parseDivisionId(id);
    if (!p) continue;
    for (let s = 1; s <= (currentSeason ?? p.season); s++) {
      ids.add(`mpg_division_${p.league}_${s}_${p.division}`);
    }
  }
  return [...ids];
}

// 移籍の日付から、その取引が属する実シーズンを求める。
// リーグ戦は8月開幕・翌年5月終了のため、1月の移籍は前年シーズンに属する。
// 例: 2026-01-06 の移籍 -> season 2025（2025-08 開幕のシーズン）
export function statsSeasonOf(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCMonth() + 1 >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

// history から (選手, シーズン) の組を集める。同じ組は1回だけ取得する
export function collectPlayerSeasons(history) {
  const pairs = new Map(); // "playerId|season" -> {playerId, season}
  const add = (id, date) => {
    const season = statsSeasonOf(date);
    if (id && season) pairs.set(`${id}|${season}`, { playerId: id, season });
  };
  for (const players of Object.values(history?.mercato ?? {})) {
    for (const p of Object.values(players ?? {})) add(p?.id, p?.wonBid?.bidDate);
  }
  for (const day of Object.values(history?.live ?? {})) {
    for (const s of day?.sales ?? []) add(s?.id, s?.saleDate);
  }
  for (const p of history?.restartingData?.purchases ?? []) add(p?.id, p?.purchaseDate);
  return [...pairs.values()];
}

// 64KB のレスポンスから表示に使う集計値だけを抜き出す（1件あたり約 200 バイト）
export function compactPlayerStats(raw) {
  const club = Object.values(raw?.stats?.clubs ?? {})[0];
  const s = club?.stats;
  if (!s) return null;
  const key = raw?.stats?.keySeasonStats ?? {};
  const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : undefined);
  return {
    matches: s.totalPlayedMatches ?? 0,
    started: s.totalStartedMatches ?? 0,
    minutes: s.totalMinutesPlayed ?? 0,
    goals: s.totalGoals ?? 0,
    assists: s.totalGoalAssist ?? 0,
    shots: s.totalScoringAtt ?? 0,
    onTarget: s.totalOnTargetScoringAtt ?? 0,
    yellow: s.totalYellowCard ?? 0,
    red: s.totalRedCard ?? 0,
    cleanSheet: s.totalCleanSheet ?? 0,
    goalsConceded: s.totalGoalsConceded ?? 0,
    rating: round(s.averageRating),
    points: key.averagePoints,
    starterPct: round(key.percentageStarter),
    quotation: key.quotation,
  };
}

// 同時実行数を制限して順に処理する（API への配慮と失敗の局所化）
async function mapWithLimit(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
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
  const currentSeasons = new Map(); // リーグ略号 -> 現在のシーズン番号
  const championshipOf = new Map(); // リーグ略号 -> championshipId（選手成績の取得に必要）
  for (const leagueId of new Set([...divisionIds].map(toLeagueId).filter(Boolean))) {
    try {
      const league = await api(`/league/${leagueId}`, token, clientVersion);
      save(leagueId, league);
      for (const id of extractDivisionIds(league)) divisionIds.add(id);
      for (const id of pastSeasonDivisionIds(league.divisionsIds, league.season)) divisionIds.add(id);
      const abbr = leagueId.replace(/^mpg_league_/, "");
      currentSeasons.set(abbr, league.season);
      if (league.gameSettings?.championshipId) championshipOf.set(abbr, league.gameSettings.championshipId);
    } catch (e) {
      console.warn(`  skip ${leagueId}: ${e.message.split("\n")[0]}`);
    }
  }

  const targets = env.MPG_DIVISION_ID
    ? env.MPG_DIVISION_ID.split(",").map((s) => s.trim()).filter(Boolean)
    : [...divisionIds];
  console.log(`対象ディビジョン(${targets.length}): ${targets.join(", ") || "(なし)"}`);

  // 存在しないシーズンは 404 で弾かれるため、失敗は skip して続行する
  const playerSeasons = new Map(); // "playerId|season" -> {playerId, season, championshipId}
  for (const id of targets) {
    console.log(`division ${id} の移籍データを取得中...`);
    const p = parseDivisionId(id);
    const isCurrentSeason = p && currentSeasons.get(p.league) === p.season;
    const jobs = [
      // 全取引の記録（フェーズ別の入札/落札・シーズン中の売買）。可視化の主データ
      ["history", `/division-history/division/${id}`, { method: "GET" }],
      // 監督名（teamsUsers）の解決に使う
      ["traders", `/division-ranking/division/${id}/traders?ignoreLive=false`, { method: "GET" }],
      // 移籍市場の選手一覧は移籍期間中の現行シーズンでのみ意味がある
      ...(isCurrentSeason
        ? [["best-available-players", `/division/${id}/best-available-players`, { method: "GET" }]]
        : []),
    ];
    for (const [name, path, opts] of jobs) {
      try {
        const data = await api(path, token, clientVersion, opts);
        save(`${id}__${name}`, data);
        if (name === "history") {
          const cid = championshipOf.get(p?.league) ?? 2;
          for (const ps of collectPlayerSeasons(data)) {
            playerSeasons.set(`${ps.playerId}|${ps.season}`, { ...ps, championshipId: cid });
          }
        }
      } catch (e) {
        console.warn(`  skip ${name}: ${e.message.split("\n")[0]}`);
      }
    }
  }

  // 選手成績（モーダル表示用）。1件 64KB のレスポンスから集計値だけを残す
  const pairs = [...playerSeasons.values()];
  if (pairs.length > 0) {
    console.log(`選手成績を取得中... (${pairs.length} 件)`);
    const stats = {};
    let done = 0;
    let failed = 0;
    await mapWithLimit(pairs, 8, async ({ playerId, season, championshipId }) => {
      try {
        const raw = await api(
          `/championship-player-stats/${playerId}/championship/${championshipId}/${season}`,
          token,
          clientVersion,
        );
        const c = compactPlayerStats(raw);
        if (c) stats[`${playerId}|${season}`] = c;
      } catch {
        failed++;
      }
      if (++done % 200 === 0) console.log(`  ${done}/${pairs.length}`);
    });
    save("player-stats", stats);
    console.log(`  成績あり ${Object.keys(stats).length} 件 / 取得失敗 ${failed} 件`);
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

  const parsed = parseDivisionId("mpg_division_PHDHUA3Z_9_1");
  console.assert(parsed.league === "PHDHUA3Z" && parsed.season === 9 && parsed.division === 1, "division id の分解失敗");

  const past = pastSeasonDivisionIds(["mpg_division_PHDHUA3Z_9_1"], 9);
  console.assert(past.length === 9, `過去シーズン分の生成数が不正: ${past.length}`);
  console.assert(past.includes("mpg_division_PHDHUA3Z_7_1"), "過去シーズンの id 生成失敗");

  const multi = pastSeasonDivisionIds(["mpg_division_X_1_1", "mpg_division_X_1_2"], 1);
  console.assert(multi.length === 2, `複数ディビジョンの扱いが不正: ${multi.length}`);

  // 8月開幕のため、1月の移籍は前年シーズンに属する
  console.assert(statsSeasonOf("2026-01-06T00:00:00Z") === 2025, "冬の移籍のシーズン判定が誤り");
  console.assert(statsSeasonOf("2025-08-20T00:00:00Z") === 2025, "夏の移籍のシーズン判定が誤り");
  console.assert(statsSeasonOf("2022-07-01T00:00:00Z") === 2022, "7月の移籍のシーズン判定が誤り");

  const ps = collectPlayerSeasons({
    mercato: { 1: { a: { id: "pA", wonBid: { bidDate: "2025-08-20T00:00:00Z" } } } },
    live: { 20260110: { sales: [{ id: "pA", saleDate: "2026-01-10T00:00:00Z" }] } },
    restartingData: { purchases: [{ id: "pB", purchaseDate: "2025-08-20T00:00:00Z" }] },
  });
  // pA は落札(2025)と売却(2026-01→2025)で同一シーズンのため 1 件に集約される
  console.assert(ps.length === 2, `(選手,シーズン)の重複排除が不正: ${ps.length}`);

  const compact = compactPlayerStats({
    stats: {
      clubs: { c1: { stats: { totalPlayedMatches: 37, totalGoals: 3, averageRating: 4.54054 } } },
      keySeasonStats: { averagePoints: 472, percentageStarter: 50 },
    },
  });
  console.assert(compact.matches === 37 && compact.goals === 3, "成績の抽出失敗");
  console.assert(compact.rating === 4.54, `評点の丸め失敗: ${compact.rating}`);
  console.assert(compactPlayerStats({ stats: { clubs: {} } }) === null, "成績なしの扱いが不正");
  console.log("self-check OK");
} else {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
