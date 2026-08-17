// MPG 移籍データ可視化スクリプト（静的 HTML 生成）
//
// data/*__history.json から全取引を一覧化する。
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
        player: playerName(p),
        position: p.position,
        quotation: p.quotation,
        teamId: p.wonBid.teamId,
        price: p.wonBid.price,
        date: p.wonBid.bidDate,
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
        player: playerName(s),
        position: s.position,
        teamId: s.fromTeam,
        purchasePrice: s.purchasePrice,
        salePrice: s.salePrice,
        delta: (s.salePrice ?? 0) - (s.purchasePrice ?? 0),
        purchaseDate: s.purchaseDate,
        saleDate: s.saleDate,
      });
    }
  }
  return rows.sort((a, b) => String(a.saleDate).localeCompare(String(b.saleDate)));
}

const posTag = (p) => `<span class="pos p${p}">${POSITIONS[p] ?? "?"}</span>`;
const teamOf = (teams, id) => esc(teams.get(id) ?? id);

// 競合入札を「監督名 価格」の羅列にする
function rivalsText(rivals, teams) {
  if (!rivals || rivals.length === 0) return '<span class="muted">単独</span>';
  return rivals.map((b) => `${teamOf(teams, b.teamId)} <span class="muted">${esc(b.price)}</span>`).join(" / ");
}

function mercatoTable(rows, teams) {
  if (rows.length === 0) return "";
  const byPhase = new Map();
  for (const r of rows) {
    if (!byPhase.has(r.phase)) byPhase.set(r.phase, []);
    byPhase.get(r.phase).push(r);
  }

  return [...byPhase.entries()]
    .sort(([a], [b]) => a - b)
    .map(([phase, list]) => {
      const body = list
        .map((r) => {
          const over = (r.price ?? 0) - (r.quotation ?? 0);
          return `<tr>
            <td>${posTag(r.position)}</td>
            <th scope="row">${esc(r.player)}</th>
            <td>${teamOf(teams, r.teamId)}</td>
            <td class="num">${esc(r.quotation)}</td>
            <td class="num strong">${esc(r.price)}</td>
            <td class="num ${over > 0 ? "over" : over < 0 ? "under" : "muted"}">${over > 0 ? "+" : ""}${esc(over)}</td>
            <td class="rivals">${rivalsText(r.rivals, teams)}</td>
            <td class="date">${esc(fmtDate(r.date))}</td>
          </tr>`;
        })
        .join("");

      return `<h4>フェーズ ${phase} <small>${list.length} 名</small></h4>
        <table>
          <thead><tr><th></th><th>選手</th><th>獲得監督</th><th class="num">評価額</th><th class="num">落札額</th><th class="num">差</th><th>競合入札</th><th>日付</th></tr></thead>
          <tbody>${body}</tbody>
        </table>`;
    })
    .join("\n");
}

function liveTable(rows, teams) {
  if (rows.length === 0) return "";
  const body = rows
    .map(
      (r) => `<tr>
        <td>${posTag(r.position)}</td>
        <th scope="row">${esc(r.player)}</th>
        <td>${teamOf(teams, r.teamId)}</td>
        <td class="num">${esc(r.purchasePrice)}</td>
        <td class="num strong">${esc(r.salePrice)}</td>
        <td class="num ${r.delta > 0 ? "over" : r.delta < 0 ? "under" : "muted"}">${r.delta > 0 ? "+" : ""}${esc(r.delta)}</td>
        <td class="date">${esc(fmtDate(r.purchaseDate))} → ${esc(fmtDate(r.saleDate))}</td>
      </tr>`,
    )
    .join("");

  return `<h4>シーズン中の売却 <small>${rows.length} 件</small></h4>
    <table>
      <thead><tr><th></th><th>選手</th><th>売却した監督</th><th class="num">購入額</th><th class="num">売却額</th><th class="num">損益</th><th>保有期間</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function restartTable(purchases, teams) {
  if (!purchases || purchases.length === 0) return "";
  const body = [...purchases]
    .sort((a, b) => (b.purchasePrice ?? 0) - (a.purchasePrice ?? 0))
    .map(
      (p) => `<tr>
        <td>${posTag(p.position)}</td>
        <th scope="row">${esc(playerName(p))}</th>
        <td>${teamOf(teams, p.fromTeam)}</td>
        <td class="num">${esc(p.quotation)}</td>
        <td class="num strong">${esc(p.purchasePrice)}</td>
        <td class="date">${esc(fmtDate(p.purchaseDate))}</td>
      </tr>`,
    )
    .join("");

  return `<h4>リスタート時の引き継ぎ <small>${purchases.length} 名</small></h4>
    <table>
      <thead><tr><th></th><th>選手</th><th>保有監督</th><th class="num">評価額</th><th class="num">購入額</th><th>購入日</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function main() {
  if (!existsSync(DATA)) {
    console.error("data/ が無いでござる。先に node src/fetch.mjs を実行してくだされ。");
    process.exit(1);
  }
  const files = readdirSync(DATA).filter((f) => f.endsWith(".json"));

  let totalMercato = 0;
  let totalLive = 0;
  const sections = files
    .filter((f) => f.endsWith("__history.json"))
    .sort()
    .map((f) => {
      const id = f.replace("__history.json", "");
      const h = readJson(f);
      // 監督名は traders / transfers-* の teamsUsers から引く
      const teams = buildTeamNames(
        files.filter((x) => x.startsWith(id) && !x.endsWith("__history.json")).map(readJson),
      );

      const mercato = flattenMercato(h.mercato);
      const live = flattenLiveSales(h.live);
      totalMercato += mercato.length;
      totalLive += live.length;

      const parts = [
        mercatoTable(mercato, teams),
        liveTable(live, teams),
        restartTable(h.restartingData?.purchases, teams),
      ].filter(Boolean);
      if (parts.length === 0) return "";

      return `<section>
        <h2>${esc(id.replace(/^mpg_division_/, ""))}
          <small>落札 ${mercato.length} 件 / 売却 ${live.length} 件</small></h2>
        ${parts.join("\n")}
      </section>`;
    })
    .filter(Boolean)
    .join("\n");

  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MPG 移籍取引一覧</title>
<style>
  :root{--bg:#fff;--ink:#1a1a1a;--muted:#6b7280;--line:#e5e7eb;--surface:#f3f4f6;
        --over:#dc2626;--under:#2563eb;
        --gk:#f59e0b;--df:#3b82f6;--mf:#10b981;--fw:#ef4444}
  @media(prefers-color-scheme:dark){:root{--bg:#0f1115;--ink:#e6e6e6;--muted:#9aa0a6;--line:#2a2d34;--surface:#1c1f26;
        --over:#f87171;--under:#60a5fa;
        --gk:#fbbf24;--df:#60a5fa;--mf:#34d399;--fw:#f87171}}
  *{box-sizing:border-box}
  body{margin:0 auto;padding:24px;max-width:1080px;font:15px/1.6 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
  h1{font-size:22px;margin-bottom:2px}
  h2{font-size:17px;margin:32px 0 4px;padding-top:20px;border-top:1px solid var(--line)}
  h4{font-size:13px;font-weight:600;margin:20px 0 6px;color:var(--muted)}
  small{color:var(--muted);font-weight:400}
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
  .lead{color:var(--muted);font-size:13px;margin-top:4px}
</style></head>
<body>
<h1>MPG 移籍取引一覧</h1>
<p class="lead">落札 ${totalMercato} 件 / シーズン中の売却 ${totalLive} 件。「差」は落札額 − 評価額（<span class="over">赤=高値掴み</span> / <span class="under">青=安値落札</span>）。</p>
${sections || "<p>取引記録が見つからなかったでござる。完了済みシーズンのディビジョンを取得してくだされ。</p>"}
</body></html>`;

  mkdirSync(join(ROOT, "dist"), { recursive: true });
  writeFileSync(join(ROOT, "dist", "index.html"), html);
  console.log(`生成完了: dist/index.html（落札 ${totalMercato} 件 / 売却 ${totalLive} 件）`);
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
  });
  console.assert(rows.length === 1, `落札のみ抽出できていない: ${rows.length}`);
  console.assert(rows[0].player === "Virgil van Dijk", `選手名の組み立て失敗: ${rows[0].player}`);
  console.assert(rows[0].rivals[0].price === 35, "競合入札が価格降順になっていない");

  const sales = flattenLiveSales({
    20220321: { sales: [{ lastName: "Noble", firstName: "Mark", salePrice: 5, purchasePrice: 8, fromTeam: "t1" }] },
  });
  console.assert(sales[0].delta === -3, `損益の計算失敗: ${sales[0].delta}`);

  const teams = buildTeamNames([{ teamsUsers: { t1: { username: "🌟 Gota" } } }]);
  console.assert(teams.get("t1") === "🌟 Gota", "監督名の解決失敗");
  console.log("self-check OK");
} else {
  main();
}
