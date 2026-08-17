---
name: bid-advisor
description: MPG の移籍市場で選手の入札額が妥当か、過去の落札データから判定する。Use when 入札額の妥当性を確認したいとき、この価格でいいか迷ったとき。トリガー語は「入札」「札」「いくらで入れるべき」「/bid-advisor」。
disable-model-invocation: true
allowed-tools: Bash(bash:*), Bash(node:*), Read
---

## Context

- 相場データ: !`bash ${CLAUDE_SKILL_DIR}/scripts/analyze.sh`

## Additional resources

- 判断軸の詳細と根拠は [tasks/bidding-guide.md](@tasks/bidding-guide.md) を参照
- 生データは `data/*__history.json`（`mercato` の各選手に `quotation` / `wonBid` / `lostBids`）

## Task（workflow）

1. 対象選手・ポジション・評価額・現在の入札額を確認する（不足していれば聞く）
2. `## Context` の相場から、対象ポジションの直近シーズンの上乗せ額を基準として押さえる
3. 対象選手の直近シーズンの成績（平均評点・出場数）を確認し、**評点帯に応じた倍率**を推奨額の土台にする
4. 対象選手の過去の落札を **競合の有無で分類**し、競合なしの高額落札は過払いとして基準から除外する
5. 好成績の選手には**中央値を超えて上積みする**。評点帯の目安は [REFERENCE.md](REFERENCE.md) を参照
6. 選手ごとに 現在の札 / 推奨額 / 根拠 を表で示し、優先順位・合計額・最低確保数を添える

## 規約

- **中央値を上限として扱わない**。中央値は低評点の選手を含む全体値であり、優秀な選手には不足する
- 競合なしの落札額を「相場」として扱わない。それは落札者の過払いの記録である
- 全期間の平均を使わない。相場は年々変動するため直近2〜3シーズンを重視する
- 落札総数だけで「余っている＝安全」と判断しない。チーム別の分布を見る
- 推奨額の根拠となるシーズン・件数を必ず示し、データに無い選手は推測で語らない

## User Input

$ARGUMENTS
