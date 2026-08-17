#!/usr/bin/env bash
# 入札判定の材料を先回りで収集する。
# 直近シーズンの相場を「競合の有無」で層別し、ポジション別に出す。
# データが無くても分析自体は続行できるよう、常に exit 0 で終える。
set +e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT" 2>/dev/null || exit 0

if [ ! -d data ] || [ -z "$(ls data/*__history.json 2>/dev/null)" ]; then
  echo "（data/ に履歴が無い。先に pnpm run fetch を実行すること）"
  exit 0
fi

node -e '
const fs = require("fs");
const POS = { 1: "GK", 2: "DF", 3: "MF", 4: "FW" };
const med = (a) => { const x = [...a].sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : "-"; };

const files = fs.readdirSync("data").filter((f) => f.endsWith("__history.json"));
const rows = [];
for (const f of files) {
  const m = f.match(/^mpg_division_(.+)_(\d+)_\d+__history\.json$/);
  if (!m) continue;
  const [, league, season] = m;
  const j = JSON.parse(fs.readFileSync("data/" + f, "utf8"));
  for (const [phase, players] of Object.entries(j.mercato ?? {})) {
    for (const p of Object.values(players ?? {})) {
      if (!p?.wonBid) continue;
      rows.push({
        league, season: +season, phase: +phase, pos: p.position,
        q: p.quotation, price: p.wonBid.price,
        over: p.wonBid.price - p.quotation,
        contested: (p.lostBids ?? []).length > 0,
        team: p.wonBid.teamId,
      });
    }
  }
}
if (!rows.length) { console.log("（落札データなし）"); process.exit(0); }

for (const lg of [...new Set(rows.map((r) => r.league))]) {
  const mine = rows.filter((r) => r.league === lg);
  const latest = Math.max(...mine.map((r) => r.season));
  const from = Math.max(Math.min(...mine.map((r) => r.season)), latest - 2);
  const recent = mine.filter((r) => r.season >= from);
  const range = from === latest ? `S${latest}` : `S${from}〜S${latest}`;
  console.log(`## ${lg} — 直近${latest - from + 1}シーズン(${range}) 落札 ${recent.length} 件`);

  // ポジション別・競合の有無で層別
  for (const pos of [1, 2, 3, 4]) {
    const g = recent.filter((r) => r.pos === pos);
    if (!g.length) continue;
    const solo = g.filter((r) => !r.contested);
    const cont = g.filter((r) => r.contested);
    console.log(
      `  ${POS[pos]}: 全${g.length}件` +
      ` | 競合なし ${solo.length}件 上乗せ中央値 +${med(solo.map((r) => r.over))}` +
      ` | 競合あり ${cont.length}件 上乗せ中央値 +${med(cont.map((r) => r.over))}`
    );
  }

  // シーズン別の推移（相場が動いているかの確認用）
  const seasons = [...new Set(mine.map((r) => r.season))].sort((a, b) => a - b);
  console.log("  シーズン別の上乗せ中央値: " +
    seasons.map((s) => `S${s} +${med(mine.filter((r) => r.season === s).map((r) => r.over))}`).join(" / "));

  // チーム別の確保数（最新シーズン）— 「売れ残り＝安全」の誤読を防ぐ
  const last = mine.filter((r) => r.season === latest);
  const byPos = {};
  for (const r of last) {
    byPos[r.pos] ??= {};
    byPos[r.pos][r.team] = (byPos[r.pos][r.team] ?? 0) + 1;
  }
  const summary = Object.entries(byPos).map(([pos, t]) => {
    const counts = Object.values(t);
    return `${POS[pos]} ${counts.reduce((a, b) => a + b, 0)}名/${counts.length}チーム`;
  });
  console.log(`  S${latest} の確保状況: ${summary.join(" | ")}`);
  console.log();
}

console.log("※ 競合なしの高額落札は相場ではなく落札者の過払い。基準に使わないこと。");
' 2>/dev/null || echo "（相場の算出に失敗。data/ の中身を確認すること）"

exit 0
