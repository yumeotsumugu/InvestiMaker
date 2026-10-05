# InvestiMaker — 作業規則

TRPG 用 2D キャラクター立ち絵を既製パーツの組み合わせで作る、完全クライアントサイドのブラウザツール。

## 唯一の正

素材規格は `docs/specifications/InvestiMaker_Asset_Specification_v1.md`（仕様書）が**唯一の正**。キャラクターの保存形式は同じフォルダの `InvestiMaker_Character_Schema_v1.md`（RC1）が定める。`docs/design/` の基本設計書は背景理解用で、食い違う箇所は仕様書が優先する。

## 守ること

- **仕様書を黙って書き換えない。** 矛盾・不足・実現困難な点は、実装側で妥当な解釈を選んで進め、`docs/reports/` の検証レポート「仕様への変更提案」に記録する。仕様書の修正は人間が判断する。
- **仕様書にない推測でフォールバックしない。** 特に Asset 解決（§6.5）は、規定の手順以外で画像を選ばない。
- **他サービスの画像・コード・UI を流用しない。** 仮素材はすべて `tools/` のスクリプトで生成する。
- **実行時に外部通信をしない。** CDN、外部フォント、解析タグは使わない。
- 依存パッケージは最小限。追加するときは理由をコミットメッセージに書く。
- コミットは可。リモートの作成と push は指示があるまで行わない。

## 構成

- `src/core/` — DOM に依存しない純粋な関数（manifest 型・検証・Asset 解決・描画順・色合成・互換性）。製品版に持ち越す。
- `src/core/character/` — キャラクターの保存形式（型・検証・保存と読込・評価・編集）。読み込みは Part の manifest を参照しない。
- `src/app/` — InvestiMaker の Creator UI。3 つのページ（CREATE / CUSTOMIZE / EXPORT）に分かれ、どのページも `main.ts` を読む。編集中の Character はセッションストレージでページ間を運ぶ（`store.ts`）。Character が唯一の正本で、UI 用の第二の正本を持たない。編集は core の operations、評価は evaluate、描画計画は plan を使う。表示名は `labels.ts`、利用者向けの文は `messages.ts` に置き、内部の語（UNRESOLVED、Part ID など）を通常の画面に出さない。
- `src/minimal/` — Phase 1-B の最小 UI。Character 操作のリファレンスとして残してある。
- `src/web/` — 素材の読み込みと Canvas 合成（本体と検証ページの共用）。
- `src/lab/` — 検証ページ（使い捨て。素の DOM）。
- `tools/` — 仮素材の生成・レポート用画像の生成・ブラウザ計測。Node の型除去で `.ts` を直接実行する。
- `tests/core/` 単体テスト、`tests/conformance/` 規格適合性テスト（§6.6 の T1〜T12 ほか）。
- `assets/development/` — 生成物。手で編集せず `npm run gen:assets` で再生成する。

## コマンド

- `npm run dev` 検証ページ / `npm test` テスト / `npm run typecheck` 型検査
- `npm run build:site` 配布用のページ（リポジトリ直下の `index.html`・`customize.html`・`export.html` と `app/`）を作り直す。これらは生成物で、手で編集しない。「ZIP を解凍して `index.html` を開くだけ」で動くこと、GitHub Pages にそのまま置けることが要件。開発用のページは `dev/`。**`src/app/`・`src/web/`・`src/core/`・素材を変えたら、コミットの前に作り直す。**
- `npm run gen:assets` 仮素材の再生成（`-- --width 1200 --height 1800 --out <dir>` でサイズ変更）

## コードの約束

- import は拡張子 `.ts` まで書く。型は `import type`。`enum` など実行時コードを生む TS 構文は使わない（Node の型除去で動かすため）。
