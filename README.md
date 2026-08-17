# mpg-football

[MPG（Mon Petit Gazon）](https://mpg.football/) の移籍（mercato）データを取得し、ビジュアル化するプロジェクト。

## 概要

MPG のページが内部で利用している API から移籍データを取得し、JSON として保存、静的 HTML ページでチャート表示する。

- **スナップショット型**: 実行時点の移籍状況を取得・可視化する（時系列蓄積はしない）
- **最小構成**: DB・バックエンド・スケジューラなし。JSON ファイルがデータ層

## アーキテクチャ

```
fetch スクリプト（Node.js）
  .env の MPG_TOKEN（Auth0 アクセストークン）
    → /dashboard で現行シーズンのディビジョンを取得
    → /league/{id} で過去シーズンのディビジョンも収集
    → /division-ranking/division/{id}/{traders|transfersExperts|transfersLosers}
    → /championship-players-pool/{id}/details（選手名の解決用）
  → data/*.json に保存
        ↓
ビジュアル化（静的 HTML）
  JSON を読み込み dist/index.html を生成
```

## 取得できるデータ

| 種別 | 内容 |
|---|---|
| `traders` | チームの資産価値の伸び（初期値 / 現在値 / 増減） |
| `transfersExperts` | 儲かった移籍（購入額 → 売却額 → 損益） |
| `transfersLosers` | 損した移籍 |
| `best-available-players` | 移籍市場の選手（移籍期間中のディビジョンのみ） |

移籍ランキングは**完了済みシーズン**のディビジョンでのみ返る。未開始シーズンは 500 になるため skip される。

## 技術スタック

- Node.js v22+（組み込み fetch を使用、外部依存は最小限）
- 静的 HTML + チャートライブラリ（可視化）

## セットアップ

```sh
# 認証情報を設定（コミット禁止）
cp .env.example .env
# .env に MPG のログイン情報を記入
```

## 使い方

```sh
# 移籍データを取得して data/ に保存
pnpm run fetch

# 可視化ページを生成して開く
pnpm run visualize && open dist/index.html

# ロジックの自己チェック
pnpm run check
```

## 注意事項

- MPG の API は非公式利用のため、仕様変更で動かなくなる可能性がある
- `.env`（アクセストークン）は絶対にコミットしない。トークンは数時間で失効する
- 選手プール API は現行シーズンの選手しか返さないため、過去の移籍相手でリーグを去った選手は名前を解決できず「選手 #ID」と表示される
- 取得データは私的利用の範囲に留める
