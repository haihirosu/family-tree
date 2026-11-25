# family-tree
Multilingual Family Tree Editor

## Ver.1

汎用的な家系図エディターをHTML/CSS/JavaScript（jQuery）で開発し、GitHub Pagesで利用します。

- 仕様確定: 2026-11-25
- 現在: 仕様書・Codex引継ぎ文・実装先を準備済み。アプリ実装は未開始です。
- 実装先: [`v1/`](v1/README.md)
- [詳細仕様書](docs/family-tree-v1-detailed-design.md)
- [Codexへの実装依頼文](docs/codex-v1-implementation-request.md)

## ディレクトリ

| パス | 用途 |
|---|---|
| `v1/` | Ver.1のアプリ（実装時に作成） |
| `vendor/` | 外部ライブラリの共通配置先（実装時に作成） |
| `shared/` | 必要に応じた自作共通処理 |
| `samples/` | 架空のサンプル・検証データ（実装時に作成） |
| `docs/` | 確定仕様・Codexへの引継ぎ |
| `test/` | 既存の接続確認用ページ |

実在人物の個人情報・家系データはこのリポジトリへ保存しません。利用者の家系JSONはブラウザー内で編集し、ダウンロードで保存する設計です。
