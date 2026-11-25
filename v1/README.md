# Family Tree Ver.1

汎用・多言語の家系図エディターVer.1の実装先です。

- 仕様確定: 2026-11-25
- 状態: 仕様とCodex引継ぎ準備済み。アプリ実装は未開始です。
- 実装エントリーポイント: `v1/index.html`（実装時に作成）
- [詳細仕様書](../docs/family-tree-v1-detailed-design.md)
- [Codexへの実装依頼文](../docs/codex-v1-implementation-request.md)

HTML/CSS/JavaScriptはこのディレクトリ配下へ配置します。外部ライブラリはルート`vendor/`、架空データはルート`samples/`、必要になった自作共通処理はルート`shared/`を使用します。

人物や家系の実データをこのリポジトリへ保存しないでください。実装時は架空データだけを使います。
