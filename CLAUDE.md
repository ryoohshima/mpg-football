# プロジェクト固有の Claude Code 指示

このファイルは本プロジェクトに固有のルール・コンテキストを Claude Code に伝えるためのものでござる。
全プロジェクト共通のガイドラインは `~/.claude/CLAUDE.md` に記載されており、本ファイルはそれを補完する形で記述するでござる。

## プロジェクト概要

[MPG（Mon Petit Gazon）](https://mpg.football/) の移籍（mercato）データを非公式 API から取得し、静的 HTML でビジュアル化するプロジェクト。
スナップショット型（時系列蓄積なし）・最小構成（DB / バックエンド / スケジューラなし、JSON ファイルがデータ層）。

## 技術スタック

- 言語: JavaScript（Node.js v22+、組み込み fetch 使用）
- フレームワーク: なし（静的 HTML + チャートライブラリで可視化）
- パッケージマネージャ: pnpm（依存が必要になった時点で導入）

## ディレクトリ構成

```
.
├── src/           # fetch / 可視化生成スクリプト
├── data/          # 取得した移籍データ JSON（gitignore 済み・非公開データ）
├── dist/          # 生成された可視化 HTML（gitignore 済み）
└── tasks/         # Claude Code 作業記録（todo.md / lessons.md）
```

## 開発コマンド

```sh
# 移籍データ取得
node src/fetch.mjs

# 可視化ページ生成
node src/visualize.mjs
```

## このリポジトリ固有の注意事項

- MPG の API は非公式利用。エンドポイント・認証方式は推測で決め打ちせず、実際のページのネットワークリクエストから確認したものを使う
- `.env` に MPG ログイン情報を置く。絶対にコミットしない（gitignore 済み）
- 取得データは私的利用の範囲に留める

## 参照ドキュメント

- [README.md](./README.md)（アーキテクチャ・使い方）
