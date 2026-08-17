// MPG 移籍データ可視化スクリプト（静的 HTML 生成）
//
// data/*.json を読み込み、ディビジョンごとに以下を描画する。
//   - traders:           チームの資産価値の伸び（初期値 → 現在値、delta 順）
//   - transfersExperts:  儲かった移籍 上位（購入額 → 売却額）
//   - transfersLosers:   損した移籍 上位
// teamId はユーザー名に、playerId は選手名に解決する。
//
// 使い方: node src/visualize.mjs && open dist/index.html

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// 選手プール（players-*.json）から playerId -> 表示名 の辞書を作る
export function buildPlayerNames(pools) {
  const names = new Map();
  for (const pool of pools) {
    for (const p of pool?.players ?? []) {
      if (p?.id) names.set(p.id, [p.firstName, p.lastName].filter(Boolean).join(" ") || p.id);
    }
  }
  return names;
}

// teamsUsers から teamId -> ユーザー名 の辞書を作る
export function buildTeamNames(teamsUsers) {
  const names = new Map();
  for (const [teamId, user] of Object.entries(teamsUsers ?? {})) {
    names.set(teamId, user?.username || user?.firstName || teamId);
  }
  return names;
}

const readJson = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));
const fmtDate = (s) => (s ? String(s).slice(0, 10) : "");

// 選手プールは現行シーズン分のみのため、既にリーグを去った選手は解決できない。
// 捏造せず ID を読みやすく表示する。
export function playerLabel(playerId, players) {
  const name = players.get(playerId);
  if (name) return { text: name, unknown: false };
  const num = String(playerId).replace(/^mpg_championship_player_/, "");
  return { text: `選手 #${num}`, unknown: true };
}

// 左右に伸びる棒（正負両方向）。max は絶対値の最大。
function deltaBar(delta, max) {
  const w = max > 0 ? Math.round((Math.abs(delta) / max) * 50) : 0;
  const pos = delta >= 0;
  return `<span class="dbar">
    <span class="dbar-half left">${pos ? "" : `<span class="fill neg" style="width:${w * 2}%"></span>`}</span>
    <span class="dbar-half right">${pos ? `<span class="fill pos" style="width:${w * 2}%"></span>` : ""}</span>
  </span>`;
}

function tradersSection(data) {
  const rows = data.traders ?? [];
  if (rows.length === 0) return "";
  const teams = buildTeamNames(data.teamsUsers);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.delta ?? 0)));
  const maxVal = Math.max(1, ...rows.map((r) => Math.max(r.initialSquadValue ?? 0, r.currentSquadValue ?? 0)));

  const body = [...rows]
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
    .map((r) => {
      const init = Math.round(((r.initialSquadValue ?? 0) / maxVal) * 100);
      const curr = Math.round(((r.currentSquadValue ?? 0) / maxVal) * 100);
      return `<tr>
        <th scope="row">${esc(teams.get(r.teamId) ?? r.teamId)}</th>
        <td class="num">${esc(r.initialSquadValue)}</td>
        <td class="num">${esc(r.currentSquadValue)}</td>
        <td class="growth">
          <span class="track"><span class="fill base" style="width:${init}%"></span><span class="fill grow" style="width:${Math.max(0, curr - init)}%"></span></span>
        </td>
        <td class="num ${(r.delta ?? 0) >= 0 ? "up" : "down"}">${(r.delta ?? 0) >= 0 ? "+" : ""}${esc(r.delta)}</td>
        <td class="delta">${deltaBar(r.delta ?? 0, max)}</td>
      </tr>`;
    })
    .join("");

  return `<h3>チーム資産価値の伸び <small>${rows.length} チーム</small></h3>
    <table>
      <thead><tr><th>監督</th><th class="num">初期値</th><th class="num">現在値</th><th>推移</th><th class="num">増減</th><th>増減幅</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function transfersSection(rows, teamsUsers, players, title, limit = 10) {
  if (!rows || rows.length === 0) return "";
  const teams = buildTeamNames(teamsUsers);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.delta ?? 0)));

  const body = [...rows]
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
    .slice(0, limit)
    .map((r) => {
      const p = playerLabel(r.playerId, players);
      return `<tr>
        <th scope="row" class="${p.unknown ? "unknown" : ""}">${esc(p.text)}</th>
        <td>${esc(teams.get(r.teamId) ?? r.teamId)}</td>
        <td class="num">${esc(r.purchasePrice)}</td>
        <td class="num">${esc(r.salePrice)}</td>
        <td class="num ${(r.delta ?? 0) >= 0 ? "up" : "down"}">${(r.delta ?? 0) >= 0 ? "+" : ""}${esc(r.delta)}</td>
        <td class="delta">${deltaBar(r.delta ?? 0, max)}</td>
        <td class="date">${esc(fmtDate(r.purchaseDate))} → ${esc(fmtDate(r.saleDate))}</td>
      </tr>`;
    })
    .join("");

  return `<h3>${esc(title)} <small>上位 ${Math.min(limit, rows.length)} / ${rows.length} 件</small></h3>
    <table>
      <thead><tr><th>選手</th><th>監督</th><th class="num">購入</th><th class="num">売却</th><th class="num">損益</th><th>損益幅</th><th>期間</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function main() {
  if (!existsSync(DATA)) {
    console.error("data/ が無いでござる。先に node src/fetch.mjs を実行してくだされ。");
    process.exit(1);
  }
  const files = readdirSync(DATA).filter((f) => f.endsWith(".json"));
  const players = buildPlayerNames(files.filter((f) => f.startsWith("players-")).map(readJson));

  // ディビジョンごとに traders / experts / losers をまとめる
  const divisions = new Map();
  for (const f of files) {
    const m = f.match(/^(mpg_division_[^_]+_\d+_\d+)__(traders|transfers-experts|transfers-losers)\.json$/);
    if (!m) continue;
    if (!divisions.has(m[1])) divisions.set(m[1], {});
    divisions.get(m[1])[m[2]] = readJson(f);
  }

  const sections = [...divisions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, d]) => {
      const teamsUsers = d.traders?.teamsUsers ?? d["transfers-experts"]?.teamsUsers ?? {};
      const parts = [
        d.traders ? tradersSection(d.traders) : "",
        transfersSection(d["transfers-experts"]?.transfersExperts, d["transfers-experts"]?.teamsUsers ?? teamsUsers, players, "儲かった移籍"),
        transfersSection(d["transfers-losers"]?.transfersLosers, d["transfers-losers"]?.teamsUsers ?? teamsUsers, players, "損した移籍"),
      ].filter(Boolean);
      if (parts.length === 0) return "";
      return `<section><h2>${esc(id.replace(/^mpg_division_/, ""))}</h2>${parts.join("\n")}</section>`;
    })
    .filter(Boolean)
    .join("\n");

  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MPG 移籍データ</title>
<style>
  :root{--bg:#fff;--ink:#1a1a1a;--muted:#6b7280;--line:#e5e7eb;--surface:#f3f4f6;
        --base:#94a3b8;--grow:#3b82f6;--pos:#2563eb;--neg:#dc2626}
  @media(prefers-color-scheme:dark){:root{--bg:#0f1115;--ink:#e6e6e6;--muted:#9aa0a6;--line:#2a2d34;--surface:#1c1f26;
        --base:#64748b;--grow:#60a5fa;--pos:#60a5fa;--neg:#f87171}}
  *{box-sizing:border-box}
  body{margin:0 auto;padding:24px;max-width:1000px;font:15px/1.6 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
  h1{font-size:22px;margin-bottom:4px}
  h2{font-size:17px;margin:28px 0 4px;padding-top:20px;border-top:1px solid var(--line)}
  h3{font-size:14px;font-weight:600;margin:20px 0 6px;color:var(--muted)}
  small{color:var(--muted);font-weight:400}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{padding:5px 8px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
  thead th{color:var(--muted);font-weight:500;font-size:12px}
  tbody th{font-weight:500}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .up{color:var(--pos)}.down{color:var(--neg)}
  .date{color:var(--muted);font-size:12px}
  .growth{width:34%;min-width:120px}
  .track{display:flex;height:12px;background:var(--surface);border-radius:4px;overflow:hidden}
  .fill{display:block;height:100%}
  .fill.base{background:var(--base)}
  .fill.grow{background:var(--grow)}
  .delta{width:110px}
  .dbar{display:flex;height:12px;align-items:center}
  .dbar-half{flex:1;display:flex;height:100%;background:var(--surface)}
  .dbar-half.left{justify-content:flex-end;border-radius:4px 0 0 4px}
  .dbar-half.right{border-radius:0 4px 4px 0}
  .fill.pos{background:var(--pos);border-radius:0 4px 4px 0}
  .fill.neg{background:var(--neg);border-radius:4px 0 0 4px}
  .legend{color:var(--muted);font-size:12px;margin-top:2px}
  .legend b{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:middle}
  .unknown{color:var(--muted);font-weight:400}
  .note{color:var(--muted);font-size:12px;margin-top:24px;padding-top:12px;border-top:1px solid var(--line)}
</style></head>
<body>
<h1>MPG 移籍データ <small>スナップショット</small></h1>
<p class="legend">
  推移: <b style="background:var(--base)"></b> 初期値 / <b style="background:var(--grow)"></b> 増加分 ・
  損益: <b style="background:var(--pos)"></b> プラス / <b style="background:var(--neg)"></b> マイナス
</p>
${sections || "<p>移籍ランキングのデータが見つからなかったでござる。完了済みシーズンのディビジョンを取得してくだされ。</p>"}
<p class="note">「選手 #12345」はリーグを去った選手。MPG の選手プール API は現行シーズン分のみを返すため、過去の移籍相手の名前は解決できない。</p>
</body></html>`;

  mkdirSync(join(ROOT, "dist"), { recursive: true });
  writeFileSync(join(ROOT, "dist", "index.html"), html);
  console.log(`生成完了: dist/index.html（ディビジョン ${divisions.size} 件）`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (!isMain) {
  // モジュールとして読み込まれた場合は何もしない
} else if (process.argv.includes("--check")) {
  const names = buildPlayerNames([{ players: [{ id: "p1", firstName: "Kylian", lastName: "Mbappé" }] }]);
  console.assert(names.get("p1") === "Kylian Mbappé", `選手名の解決失敗: ${names.get("p1")}`);
  const teams = buildTeamNames({ t1: { username: "🌟 Gota", firstName: "Gota" }, t2: { firstName: "oga" } });
  console.assert(teams.get("t1") === "🌟 Gota" && teams.get("t2") === "oga", "チーム名の解決失敗");
  console.assert(deltaBar(-10, 20).includes("neg"), "負の delta が負方向に描画されていない");
  console.assert(deltaBar(10, 20).includes("pos"), "正の delta が正方向に描画されていない");
  const known = playerLabel("p1", names);
  const unknown = playerLabel("mpg_championship_player_101668", names);
  console.assert(known.text === "Kylian Mbappé" && !known.unknown, "既知選手のラベル失敗");
  console.assert(unknown.text === "選手 #101668" && unknown.unknown, `未収録選手のラベル失敗: ${unknown.text}`);
  console.log("self-check OK");
} else {
  main();
}
