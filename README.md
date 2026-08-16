# github-template

新規 GitHub リポジトリ作成時に共通利用する設定一式の Template Repository。
`.github/` 配下の community health files に加え、リポジトリ全体の足場（`.gitignore` / `.editorconfig` / `CLAUDE.md` 等）も含む。

## 使い方

### Web UI から

GitHub のリポジトリ画面右上 **`Use this template`** ボタンから新リポジトリを生成する。

### CLI から

```sh
gh repo create <new-repo-name> --template Ryo-Ohshima/github-template --private
```

## 含まれるファイル

### `.github/` 配下（GitHub 連携）

| パス | 用途 |
|---|---|
| `.github/PULL_REQUEST_TEMPLATE.md` | PR テンプレート（What / Why / Refs + コミット規約プレフィックス選択） |
| `.github/ISSUE_TEMPLATE/bug_report.md` | バグ報告テンプレート（日本語） |
| `.github/ISSUE_TEMPLATE/feature_request.md` | 機能要望テンプレート（日本語） |
| `.github/ISSUE_TEMPLATE/config.yml` | blank issue を無効化しテンプレ選択を強制 |
| `.github/CODEOWNERS` | PR レビュー自動割り当て（初期値 `@Ryo-Ohshima`） |
| `.github/release.yml` | リリースノート自動カテゴリ分類（コミット規約整合） |
| `.github/dependabot.yml` | npm + github-actions 週次自動更新 |
| `.github/workflows/claude.yml` | `@claude` メンションで Claude Code を起動（fork PR ガード付き、作業ブランチへは Draft PR を自動作成） |
| `.github/workflows/claude-code-review.yml` | PR 作成・更新時に Claude Code が自動レビュー（dependabot PR は対象外） |
| `.github/workflows/stale.yml` | 30 日無活動 PR を自動クローズ（Issue は対象外） |
| `.github/workflows/ci.yml.example` | Node.js 用 CI 雛形（リネーム+調整して使用） |

### ルート直下（リポジトリ全体の足場）

| パス | 用途 |
|---|---|
| `.gitignore` | macOS / IDE / .env / node_modules / dist / ログ等を網羅した汎用版 |
| `.editorconfig` | エディタ間のインデント・改行・文字コード統一 |
| `.gitattributes` | 改行コード LF 正規化、バイナリ判定 |
| `biome.jsonc` | Biome（linter + formatter）設定雛形。JS/TS 以外のスタックなら削除 |
| `CLAUDE.md` | プロジェクト個別の Claude Code 指示雛形（global CLAUDE.md を補完） |
| `tasks/` | Claude Code 作業記録用ディレクトリ（todo.md / lessons.md 配置先） |
| `.claude/settings.json` | プロジェクト個別の permission allowlist 雛形 |

## 新リポ生成後にやること

- [ ] **`CODEOWNERS`** のユーザー名を必要に応じて変更
- [ ] **`ci.yml.example`** を `ci.yml` にリネームし、プロジェクトのスクリプト構成に合わせて調整。Node.js 以外のスタックなら丸ごと置き換え
- [ ] **`claude.yml`** を使う場合は Repository Secret に `CLAUDE_CODE_OAUTH_TOKEN` を設定
- [ ] **`claude.yml`** を使う場合は `Settings → Actions → General → Workflow permissions` で **`Allow GitHub Actions to create and approve pull requests`** を有効化（オフのままだと Claude が PR 作成段階で `GitHub Actions is not permitted to create or approve pull requests` で失敗する）
- [ ] **`dependabot.yml`** で該当しないエコシステムのブロックを削除（例: TS リポなら github-actions のみ残す）
- [ ] **`release.yml`** のラベルが PR ラベル運用と整合しているか確認
- [ ] **`CLAUDE.md`** にプロジェクト固有の概要・スタック・開発コマンドを記述
- [ ] **`.gitignore`** にスタック固有のパターン（`*.env.production`, ビルド成果物名など）を追記
- [ ] **`biome.jsonc`** を使う場合は `pnpm add -D @biomejs/biome` し、package.json に `"lint": "biome check ."` を定義。JS/TS 以外のスタックなら削除

## `claude.yml` がエラーになるとき

### `Invalid API key · Fix external API key`

原因は主に 2 つ：

1. **input 名の取り違え** — OAuth トークンは `claude_code_oauth_token:` input、API キーは `anthropic_api_key:` input に渡す必要がある（混同すると Anthropic 側で拒否される）
2. **secret 値の改行混入・期限切れ** — secret 設定時に `echo` を使うと末尾改行が混入することがある

OAuth トークンの再発行と secret 更新は以下の手順で行う：

```sh
claude setup-token   # ブラウザで Max サブスク認証 → sk-ant-oat01-... が出力される
TOKEN='sk-ant-oat01-...'
printf '%s' "$TOKEN" | gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo <owner>/<repo>
```

`echo` ではなく `printf '%s'` を使うのがコツ（末尾改行を防ぐ）。

### `GitHub Actions is not permitted to create or approve pull requests`

Claude が変更を push した後の `gh pr create --draft` 段階で出る。`Settings → Actions → General → Workflow permissions` で **`Allow GitHub Actions to create and approve pull requests`** を有効化する。リポ作成直後はオフなので、新規リポでは必ず最初に有効化が必要。

### 動作確認

Issue で `@claude ping` をコメントし、`Actions` タブで workflow run の成功と Draft PR が作成されることを確認する。

## 設計方針

- スタック非依存で汎用的なものに限定（CI 本体は雛形のみ）
- 規約は [`claude-code/rules/git-guideline.md`](https://github.com/Ryo-Ohshima/claude-code) のコミットプレフィックスと整合
- すべてのテンプレ・メッセージは日本語
