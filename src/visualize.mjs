// MPG 移籍データ可視化スクリプト（静的 HTML 生成）
//
// data/*__history.json から全取引を一覧化し、リーグ/シーズン・フェーズのタブで切り替える。
//   - mercato:    フェーズ別の落札（誰がいくらで獲得したか / 競合した入札）
//   - live:       シーズン中の売買（購入額と売却額の差＝損益）
//   - restarting: リスタート時の保有引き継ぎ
// 選手名・評価額は history に含まれるため、選手プールへの参照は不要。
//
// 使い方: node src/visualize.mjs && open dist/index.html

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const POSITIONS = { 1: "GK", 2: "DF", 3: "MF", 4: "FW" };

export const playerName = (p) => [p?.firstName, p?.lastName].filter(Boolean).join(" ") || p?.id || "";
const fmtDate = (s) => (s ? String(s).slice(0, 10) : "");
const readJson = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));

// mpg_division_PHDHUA3Z_9_1 -> { league:"PHDHUA3Z", season:9, division:1 }
export function parseDivisionId(divisionId) {
  const m = String(divisionId).match(/^mpg_division_(.+)_(\d+)_(\d+)$/);
  return m ? { league: m[1], season: Number(m[2]), division: Number(m[3]) } : null;
}

// リーグ戦は8月開幕のため、1月の移籍は前年シーズンに属する（fetch 側と同じ規則）
export function statsSeasonOf(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCMonth() + 1 >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

// teamsUsers（traders 等に含まれる）から teamId -> ユーザー名 の辞書を作る
export function buildTeamNames(sources) {
  const names = new Map();
  for (const src of sources) {
    for (const [teamId, user] of Object.entries(src?.teamsUsers ?? {})) {
      names.set(teamId, user?.username || user?.firstName || teamId);
    }
  }
  return names;
}

// mercato（フェーズ番号 -> 選手辞書）を落札レコードの配列に均す
export function flattenMercato(mercato) {
  const rows = [];
  for (const [phase, players] of Object.entries(mercato ?? {})) {
    for (const p of Object.values(players ?? {})) {
      if (!p?.wonBid) continue;
      rows.push({
        phase: Number(phase),
        playerId: p.id,
        player: playerName(p),
        position: p.position,
        quotation: p.quotation,
        teamId: p.wonBid.teamId,
        price: p.wonBid.price,
        date: p.wonBid.bidDate,
        statsSeason: statsSeasonOf(p.wonBid.bidDate),
        rivals: (p.lostBids ?? []).sort((a, b) => (b.price ?? 0) - (a.price ?? 0)),
      });
    }
  }
  return rows.sort((a, b) => a.phase - b.phase || (b.price ?? 0) - (a.price ?? 0));
}

// live（日付 -> {sales}）を売却レコードの配列に均す
export function flattenLiveSales(live) {
  const rows = [];
  for (const day of Object.values(live ?? {})) {
    for (const s of day?.sales ?? []) {
      rows.push({
        playerId: s.id,
        player: playerName(s),
        position: s.position,
        teamId: s.fromTeam,
        purchasePrice: s.purchasePrice,
        salePrice: s.salePrice,
        delta: (s.salePrice ?? 0) - (s.purchasePrice ?? 0),
        purchaseDate: s.purchaseDate,
        saleDate: s.saleDate,
        statsSeason: statsSeasonOf(s.saleDate),
      });
    }
  }
  return rows.sort((a, b) => String(a.saleDate).localeCompare(String(b.saleDate)));
}

const posTag = (p) => `<span class="pos p${p}">${POSITIONS[p] ?? "?"}</span>`;
const teamOf = (teams, id) => esc(teams.get(id) ?? id);

// 選手名をクリック可能にする。モーダルで成績と歴代の落札履歴を出す
function playerCell(row) {
  if (!row.playerId) return `<th scope="row">${esc(row.player)}</th>`;
  const season = row.statsSeason ?? "";
  // data-date は歴代表の中で「今見ている取引」を強調するために使う
  const date = fmtDate(row.date ?? row.purchaseDate);
  return `<th scope="row"><button class="player" data-id="${esc(row.playerId)}" data-season="${esc(season)}" data-date="${esc(date)}" data-name="${esc(row.player)}">${esc(row.player)}</button></th>`;
}

// 全ディビジョンの落札から、選手ごとの歴代（評価額・落札額）を組み立てる
export function buildPlayerHistory(entries, labelOf) {
  const byPlayer = new Map();
  for (const e of entries) {
    for (const r of e.mercato) {
      if (!r.playerId) continue;
      if (!byPlayer.has(r.playerId)) byPlayer.set(r.playerId, []);
      byPlayer.get(r.playerId).push({
        where: labelOf(e),
        phase: r.phase,
        quotation: r.quotation ?? null,
        price: r.price ?? null,
        team: e.teams.get(r.teamId) ?? r.teamId,
        date: fmtDate(r.date),
      });
    }
  }
  for (const list of byPlayer.values()) list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return Object.fromEntries(byPlayer);
}

// ポジション絞り込み。行の data-pos を CSS で出し分けるため、行を重複させない
export function posFilter(entry) {
  const counts = new Map();
  for (const r of entry.mercato) counts.set(r.position, (counts.get(r.position) ?? 0) + 1);
  const present = [1, 2, 3, 4].filter((p) => counts.has(p));
  if (present.length <= 1) return "";

  const buttons = [
    `<button class="tab pos-tab active" data-pos="0">全ポジション <span class="count">${entry.mercato.length}</span></button>`,
    ...present.map(
      (p) =>
        `<button class="tab pos-tab" data-pos="${p}">${posTag(p)} <span class="count">${counts.get(p)}</span></button>`,
    ),
  ].join("");
  return `<div class="tabs sub pos">${buttons}</div>`;
}

function rivalsText(rivals, teams) {
  if (!rivals || rivals.length === 0) return '<span class="muted">単独</span>';
  return rivals.map((b) => `${teamOf(teams, b.teamId)} <span class="muted">${esc(b.price)}</span>`).join(" / ");
}

function mercatoRows(list, teams) {
  return list
    .map((r) => {
      const over = (r.price ?? 0) - (r.quotation ?? 0);
      return `<tr data-pos="${r.position ?? 0}">
        <td>${posTag(r.position)}</td>
        ${playerCell(r)}
        <td>${teamOf(teams, r.teamId)}</td>
        <td class="num">${esc(r.quotation)}</td>
        <td class="num strong">${esc(r.price)}</td>
        <td class="num ${over > 0 ? "over" : over < 0 ? "under" : "muted"}">${over > 0 ? "+" : ""}${esc(over)}</td>
        <td class="rivals">${rivalsText(r.rivals, teams)}</td>
      </tr>`;
    })
    .join("");
}

const MERCATO_HEAD = `<thead><tr><th></th><th>選手</th><th>獲得監督</th><th class="num">評価額</th><th class="num">落札額</th><th class="num">差</th><th>競合入札</th></tr></thead>`;

// フェーズタブ + 各フェーズのテーブル。
// 「すべて」は全フェーズのパネルを同時表示するだけで、行を重複して持たない
export function mercatoPanel(rows, teams, key) {
  if (rows.length === 0) return "";
  const byPhase = new Map();
  for (const r of rows) {
    if (!byPhase.has(r.phase)) byPhase.set(r.phase, []);
    byPhase.get(r.phase).push(r);
  }
  const phases = [...byPhase.entries()].sort(([a], [b]) => a - b);

  const tabs = [
    `<button class="tab phase-tab active" data-target="all">すべて <span class="count">${rows.length}</span></button>`,
    ...phases.map(
      ([n, list]) =>
        `<button class="tab phase-tab" data-target="${key}-p${n}">フェーズ ${n} <span class="count">${list.length}</span></button>`,
    ),
  ].join("");

  const panels = phases
    .map(
      ([n, list]) =>
        `<div class="phase-panel active" id="${key}-p${n}">
           <h5>フェーズ ${n} <small>${list.length} 名</small></h5>
           <table>${MERCATO_HEAD}<tbody>${mercatoRows(list, teams)}</tbody></table>
         </div>`,
    )
    .join("");

  return `<div class="mercato">
    <h4>移籍市場での落札</h4>
    <div class="tabs sub">${tabs}</div>
    <div class="phase-panels">${panels}</div>
  </div>`;
}

function liveTable(rows, teams) {
  if (rows.length === 0) return "";
  const body = rows
    .map(
      (r) => `<tr data-pos="${r.position ?? 0}">
        <td>${posTag(r.position)}</td>
        ${playerCell(r)}
        <td>${teamOf(teams, r.teamId)}</td>
        <td class="num">${esc(r.purchasePrice)}</td>
        <td class="num strong">${esc(r.salePrice)}</td>
        <td class="num ${r.delta > 0 ? "over" : r.delta < 0 ? "under" : "muted"}">${r.delta > 0 ? "+" : ""}${esc(r.delta)}</td>
      </tr>`,
    )
    .join("");

  return `<h4>シーズン中の売却 <small>${rows.length} 件</small></h4>
    <table>
      <thead><tr><th></th><th>選手</th><th>売却した監督</th><th class="num">購入額</th><th class="num">売却額</th><th class="num">損益</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function restartTable(purchases, teams) {
  if (!purchases || purchases.length === 0) return "";
  const body = [...purchases]
    .sort((a, b) => (b.purchasePrice ?? 0) - (a.purchasePrice ?? 0))
    .map(
      (p) => `<tr data-pos="${p.position ?? 0}">
        <td>${posTag(p.position)}</td>
        <th scope="row">${esc(playerName(p))}</th>
        <td>${teamOf(teams, p.fromTeam)}</td>
        <td class="num">${esc(p.quotation)}</td>
        <td class="num strong">${esc(p.purchasePrice)}</td>
      </tr>`,
    )
    .join("");

  return `<h4>リスタート時の引き継ぎ <small>${purchases.length} 名</small></h4>
    <table>
      <thead><tr><th></th><th>選手</th><th>保有監督</th><th class="num">評価額</th><th class="num">購入額</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// タブ切り替え。依存を足さず素の JS で完結させる
// 表示する成績項目。[キー, ラベル, 単位]
const STAT_FIELDS = [
  ["matches", "出場", "試合"],
  ["started", "先発", "試合"],
  ["minutes", "出場時間", "分"],
  ["rating", "平均評点", ""],
  ["points", "平均ポイント", ""],
  ["goals", "得点", ""],
  ["assists", "アシスト", ""],
  ["shots", "シュート", ""],
  ["onTarget", "枠内シュート", ""],
  ["yellow", "警告", ""],
  ["red", "退場", ""],
  ["cleanSheet", "クリーンシート", ""],
  ["goalsConceded", "失点", ""],
  ["quotation", "評価額", ""],
];

const TAB_SCRIPT = `
const STATS = __STATS__;
const FIELDS = __FIELDS__;
const HISTORY = __HISTORY__;

const escHtml = (v) => String(v).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function statsHtml(key) {
  const s = STATS[key];
  if (!s) return '<p class="empty">このシーズンの成績データはありません</p>';
  // 値は数値のみ（fetch 側で集計値だけを抽出している）。念のため Number で固定する
  return '<div class="stat-grid">' + FIELDS
    .filter(([k]) => s[k] !== undefined && s[k] !== null)
    .map(([k, label, unit]) => \`<div class="stat"><dt>\${label}</dt><dd>\${Number(s[k])}<span class="unit">\${unit}</span></dd></div>\`)
    .join("") + '</div>';
}

function historyHtml(playerId, currentDate) {
  const list = HISTORY[playerId] || [];
  if (list.length === 0) return "";
  const rows = list.map((h) => {
    const diff = (h.price ?? 0) - (h.quotation ?? 0);
    const cls = diff > 0 ? "over" : diff < 0 ? "under" : "muted";
    const now = h.date === currentDate ? " current" : "";
    return \`<tr class="\${now.trim()}">
      <td>\${escHtml(h.where)}</td>
      <td class="muted">F\${Number(h.phase)}</td>
      <td>\${escHtml(h.team)}</td>
      <td class="num">\${h.quotation === null ? "-" : Number(h.quotation)}</td>
      <td class="num strong">\${h.price === null ? "-" : Number(h.price)}</td>
      <td class="num \${cls}">\${diff > 0 ? "+" : ""}\${diff}</td>
    </tr>\`;
  }).join("");
  return \`<h6>歴代の評価額と落札額 <small>\${list.length} 回</small></h6>
    <div class="hist-wrap"><table class="hist">
      <thead><tr><th>シーズン</th><th>F</th><th>獲得監督</th><th class="num">評価額</th><th class="num">落札額</th><th class="num">差</th></tr></thead>
      <tbody>\${rows}</tbody>
    </table></div>\`;
}

function openModal(playerId, season, name, date) {
  const key = playerId + "|" + season;
  document.getElementById("modal-title").textContent = name;
  document.getElementById("modal-season").textContent =
    season ? season + "-" + String(Number(season) + 1).slice(2) + " シーズン成績" : "";
  document.getElementById("modal-body").innerHTML = statsHtml(key) + historyHtml(playerId, date);
  document.getElementById("modal").classList.add("open");
}

function closeModal() {
  document.getElementById("modal").classList.remove("open");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

document.addEventListener("click", (e) => {
  const player = e.target.closest(".player");
  if (player) {
    openModal(player.dataset.id, player.dataset.season, player.dataset.name, player.dataset.date);
    return;
  }
  // 背景（オーバーレイ自身）か × ボタンのときだけ閉じる。中身のクリックでは閉じない
  if (e.target.id === "modal" || e.target.closest(".close")) {
    closeModal();
    return;
  }

  const tab = e.target.closest(".tab");
  if (!tab) return;
  tab.closest(".tabs").querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  tab.classList.add("active");

  // ポジション絞り込みは属性を変えるだけ。表示制御は CSS が行う
  if (tab.classList.contains("pos-tab")) {
    tab.closest(".season-panel").dataset.posfilter = tab.dataset.pos;
    return;
  }

  const target = tab.dataset.target;

  if (tab.classList.contains("phase-tab")) {
    // 「すべて」は全フェーズを同時表示する
    tab.closest(".mercato").querySelectorAll(".phase-panel").forEach((p) => {
      p.classList.toggle("active", target === "all" || p.id === target);
    });
  } else {
    document.querySelectorAll(".season-panel").forEach((p) => {
      p.classList.toggle("active", p.id === target);
    });
  }
});
`;

function main() {
  if (!existsSync(DATA)) {
    console.error("data/ が無いでござる。先に node src/fetch.mjs を実行してくだされ。");
    process.exit(1);
  }
  const files = readdirSync(DATA).filter((f) => f.endsWith(".json"));

  // 選手成績（あれば）。モーダル表示に使う
  const allStats = files.includes("player-stats.json") ? readJson("player-stats.json") : {};

  // リーグ名（mpg_league_*.json）を引けるようにする
  const leagueNames = new Map();
  for (const f of files.filter((x) => x.startsWith("mpg_league_"))) {
    const j = readJson(f);
    if (j?.name) leagueNames.set(f.replace(/^mpg_league_|\.json$/g, ""), j.name);
  }

  // ディビジョンごとに履歴を読み、リーグ+シーズンの新しい順に並べる
  const entries = files
    .filter((f) => f.endsWith("__history.json"))
    .map((f) => {
      const id = f.replace("__history.json", "");
      const p = parseDivisionId(id) ?? { league: id, season: 0, division: 0 };
      const h = readJson(f);
      const teams = buildTeamNames(
        files.filter((x) => x.startsWith(id) && !x.endsWith("__history.json")).map(readJson),
      );
      return {
        id,
        ...p,
        teams,
        mercato: flattenMercato(h.mercato),
        live: flattenLiveSales(h.live),
        restarting: h.restartingData?.purchases ?? [],
      };
    })
    .filter((e) => e.mercato.length > 0 || e.live.length > 0 || e.restarting.length > 0)
    .sort((a, b) => a.league.localeCompare(b.league) || b.season - a.season || a.division - b.division);

  const label = (e) => {
    const name = leagueNames.get(e.league) ?? e.league;
    const div = e.division > 1 ? ` D${e.division}` : "";
    return `${name} S${e.season}${div}`;
  };

  // 選手ごとの歴代（評価額・落札額）。全シーズンの落札から組み立てる
  const playerHistory = buildPlayerHistory(entries, label);

  const tabs = entries
    .map(
      (e, i) =>
        `<button class="tab season-tab${i === 0 ? " active" : ""}" data-target="s-${e.id}">${esc(label(e))} <span class="count">${e.mercato.length}</span></button>`,
    )
    .join("");

  const panels = entries
    .map((e, i) => {
      const parts = [
        mercatoPanel(e.mercato, e.teams, `s-${e.id}`),
        liveTable(e.live, e.teams),
        restartTable(e.restarting, e.teams),
      ].filter(Boolean);
      return `<div class="season-panel${i === 0 ? " active" : ""}" id="s-${e.id}" data-posfilter="0">
        <p class="lead">落札 ${e.mercato.length} 件 / シーズン中の売却 ${e.live.length} 件</p>
        ${posFilter(e)}
        ${parts.join("\n")}
      </div>`;
    })
    .join("\n");

  const totalMercato = entries.reduce((s, e) => s + e.mercato.length, 0);
  const totalLive = entries.reduce((s, e) => s + e.live.length, 0);

  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MPG 移籍取引一覧</title>
<style>
  :root{--bg:#fff;--ink:#1a1a1a;--muted:#6b7280;--line:#e5e7eb;--surface:#f3f4f6;--accent:#2563eb;
        --over:#dc2626;--under:#2563eb;
        --gk:#f59e0b;--df:#3b82f6;--mf:#10b981;--fw:#ef4444}
  @media(prefers-color-scheme:dark){:root{--bg:#0f1115;--ink:#e6e6e6;--muted:#9aa0a6;--line:#2a2d34;--surface:#1c1f26;--accent:#60a5fa;
        --over:#f87171;--under:#60a5fa;
        --gk:#fbbf24;--df:#60a5fa;--mf:#34d399;--fw:#f87171}}
  *{box-sizing:border-box}
  body{margin:0 auto;padding:24px;max-width:1080px;font:15px/1.6 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
  h1{font-size:22px;margin-bottom:2px}
  h4{font-size:13px;font-weight:600;margin:22px 0 6px;color:var(--muted)}
  h5{font-size:12px;font-weight:600;margin:14px 0 4px;color:var(--muted)}
  .phase-panel:first-child h5{margin-top:4px}
  small{color:var(--muted);font-weight:400}
  .tabs{display:flex;flex-wrap:wrap;gap:4px;margin:12px 0 4px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  .tabs.sub{border-bottom:none;padding-bottom:0;margin:6px 0 8px}
  .tab{font:inherit;font-size:13px;padding:4px 10px;border:1px solid var(--line);border-radius:999px;
       background:transparent;color:var(--muted);cursor:pointer}
  .tab:hover{background:var(--surface)}
  .tab.active{background:var(--accent);border-color:var(--accent);color:#fff}
  .tab .count{font-size:11px;opacity:.75;margin-left:2px}
  .season-panel,.phase-panel{display:none}
  .season-panel.active,.phase-panel.active{display:block}
  /* ポジション絞り込み: 行を重複させず data-pos で出し分ける */
  .season-panel[data-posfilter="1"] tbody tr:not([data-pos="1"]),
  .season-panel[data-posfilter="2"] tbody tr:not([data-pos="2"]),
  .season-panel[data-posfilter="3"] tbody tr:not([data-pos="3"]),
  .season-panel[data-posfilter="4"] tbody tr:not([data-pos="4"]){display:none}
  .tabs.pos{margin-top:10px}
  .pos-tab .pos{margin-right:2px}
  .pos-tab.active .pos{opacity:.9}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{padding:4px 8px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
  thead th{color:var(--muted);font-weight:500;font-size:12px}
  tbody th{font-weight:500}
  tbody tr:hover{background:var(--surface)}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .strong{font-weight:600}
  .over{color:var(--over)}
  .under{color:var(--under)}
  .muted{color:var(--muted)}
  .date{color:var(--muted);font-size:12px}
  .rivals{font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis}
  .pos{display:inline-block;min-width:26px;text-align:center;font-size:10px;font-weight:700;
       padding:1px 4px;border-radius:3px;color:#fff}
  .p1{background:var(--gk)}.p2{background:var(--df)}.p3{background:var(--mf)}.p4{background:var(--fw)}
  .lead{color:var(--muted);font-size:13px;margin:4px 0 0}
  .player{font:inherit;font-size:13px;font-weight:500;padding:0;border:none;background:none;color:var(--ink);
          cursor:pointer;border-bottom:1px dashed var(--muted);text-align:left}
  .player:hover{color:var(--accent);border-bottom-color:var(--accent)}
  /* モーダル */
  #modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:16px;
         background:rgba(0,0,0,.5);z-index:10}
  #modal.open{display:flex}
  .modal-box{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:20px;
             max-width:520px;width:100%;max-height:85vh;overflow:auto}
  .modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
  .modal-head h3{margin:0;font-size:17px}
  .modal-head p{margin:2px 0 0;font-size:12px;color:var(--muted)}
  .close{font:inherit;font-size:20px;line-height:1;padding:2px 8px;border:none;border-radius:6px;
         background:var(--surface);color:var(--muted);cursor:pointer}
  .close:hover{color:var(--ink)}
  #modal-body{margin:0}
  .stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}
  .stat{background:var(--surface);border-radius:6px;padding:7px 10px}
  .empty{color:var(--muted);font-size:13px;margin:0}
  #modal-body h6{font-size:12px;font-weight:600;color:var(--muted);margin:18px 0 6px}
  .hist-wrap{overflow-x:auto}
  table.hist{font-size:12px}
  table.hist td,table.hist th{padding:3px 7px}
  table.hist tr.current{background:var(--surface)}
  table.hist tr.current td:first-child{font-weight:600}
  .stat dt{font-size:11px;color:var(--muted)}
  .stat dd{margin:1px 0 0;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
  .stat .unit{font-size:11px;font-weight:400;color:var(--muted);margin-left:2px}
</style></head>
<body>
<h1>MPG 移籍取引一覧</h1>
<p class="lead">全 ${entries.length} シーズン・落札 ${totalMercato} 件 / 売却 ${totalLive} 件。「差」は落札額 − 評価額（<span class="over">赤=高値掴み</span> / <span class="under">青=安値落札</span>）。</p>
<div class="tabs">${tabs}</div>
${panels || "<p>取引記録が見つからなかったでござる。</p>"}
<div id="modal">
  <div class="modal-box">
    <div class="modal-head">
      <div><h3 id="modal-title"></h3><p id="modal-season"></p></div>
      <button class="close" aria-label="閉じる">×</button>
    </div>
    <dl id="modal-body"></dl>
  </div>
</div>
<script>${TAB_SCRIPT.replace("__STATS__", JSON.stringify(allStats)).replace("__FIELDS__", JSON.stringify(STAT_FIELDS)).replace("__HISTORY__", JSON.stringify(playerHistory))}</script>
</body></html>`;

  mkdirSync(join(ROOT, "dist"), { recursive: true });
  writeFileSync(join(ROOT, "dist", "index.html"), html);
  console.log(`生成完了: dist/index.html（${entries.length} シーズン / 落札 ${totalMercato} 件 / 売却 ${totalLive} 件）`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (!isMain) {
  // モジュールとして読み込まれた場合は何もしない
} else if (process.argv.includes("--check")) {
  const rows = flattenMercato({
    1: {
      a: {
        id: "a",
        firstName: "Virgil",
        lastName: "van Dijk",
        quotation: 29,
        position: 2,
        wonBid: { teamId: "t1", price: 40, bidDate: "2022-03-15T12:25:01Z" },
        lostBids: [{ teamId: "t2", price: 31 }, { teamId: "t3", price: 35 }],
      },
      b: { id: "b", lastName: "未落札", wonBid: null },
    },
    2: { c: { id: "c", lastName: "Kane", quotation: 41, position: 4, wonBid: { teamId: "t2", price: 85 } } },
  });
  console.assert(rows.length === 2, `落札のみ抽出できていない: ${rows.length}`);
  console.assert(rows[0].player === "Virgil van Dijk", `選手名の組み立て失敗: ${rows[0].player}`);
  console.assert(rows[0].rivals[0].price === 35, "競合入札が価格降順になっていない");
  console.assert(rows[1].phase === 2, "フェーズ順に並んでいない");

  const teams = buildTeamNames([{ teamsUsers: { t1: { username: "🌟 Gota" } } }]);
  const panel = mercatoPanel(rows, teams, "k1");
  console.assert((panel.match(/phase-tab/g) ?? []).length === 3, "フェーズタブ（すべて+2）が生成されていない");
  console.assert(panel.includes('id="k1-p2"'), "フェーズ 2 のパネルが無い");
  // 「すべて」は表示切替で賄うため、行を重複して持たない（1行につき data-name とセルで2回出る）
  console.assert((panel.match(/van Dijk/g) ?? []).length === 2, "落札行が重複して描画されている");
  console.assert((panel.match(/class="phase-panel active"/g) ?? []).length === 2, "フェーズパネル数が不正");

  const sales = flattenLiveSales({
    20220321: { sales: [{ lastName: "Noble", firstName: "Mark", salePrice: 5, purchasePrice: 8, fromTeam: "t1" }] },
  });
  console.assert(sales[0].delta === -3, `損益の計算失敗: ${sales[0].delta}`);
  console.assert(teams.get("t1") === "🌟 Gota", "監督名の解決失敗");

  const p = parseDivisionId("mpg_division_PHDHUA3Z_9_1");
  console.assert(p.league === "PHDHUA3Z" && p.season === 9, "division id の分解失敗");

  // 8月開幕のため 1月の移籍は前年シーズン（fetch 側と同じ規則）
  console.assert(statsSeasonOf("2026-01-06T00:00:00Z") === 2025, "シーズン判定が fetch と食い違う");
  console.assert(rows[0].statsSeason === 2021, `落札行のシーズン付与失敗: ${rows[0].statsSeason}`); // 2022-03 は 2021 シーズン

  // 選手はすべてクリック可能（成績が無くても歴代は出せる）
  const panel2 = mercatoPanel(rows, teams, "k2");
  console.assert(panel2.includes('data-id="a"') && panel2.includes('data-season="2021"'), "選手ボタンの属性が不足");
  console.assert((panel2.match(/class="player"/g) ?? []).length === 2, "全選手がボタン化されていない");

  // 歴代は全ディビジョンの落札を選手ごとに時系列でまとめる
  const hist = buildPlayerHistory(
    [
      { mercato: [{ playerId: "a", phase: 1, quotation: 29, price: 40, teamId: "t1", date: "2023-08-20T00:00:00Z" }], teams },
      { mercato: [{ playerId: "a", phase: 2, quotation: 31, price: 25, teamId: "t1", date: "2022-03-15T00:00:00Z" }], teams },
    ],
    () => "テストリーグ S1",
  );
  console.assert(hist.a.length === 2, `歴代の集約失敗: ${hist.a?.length}`);
  console.assert(hist.a[0].date === "2022-03-15", `時系列に並んでいない: ${hist.a[0].date}`);
  console.assert(hist.a[0].team === "🌟 Gota", "歴代の監督名が解決されていない");

  // ポジション絞り込み: 登場するポジションの分だけタブを出す
  const filter = posFilter({ mercato: [{ position: 2 }, { position: 4 }, { position: 4 }] });
  console.assert((filter.match(/pos-tab/g) ?? []).length === 3, "ポジションタブ数が不正（全て + DF + FW）");
  console.assert(filter.includes('data-pos="4"') && !filter.includes('data-pos="1"'), "不在ポジションのタブが出ている");
  console.assert(filter.includes('<span class="count">2</span>'), "ポジション別の件数が不正");
  // 1種類しか無い場合は絞り込む意味がないので出さない
  console.assert(posFilter({ mercato: [{ position: 3 }] }) === "", "単一ポジションでもタブが出ている");
  console.log("self-check OK");
} else {
  main();
}
