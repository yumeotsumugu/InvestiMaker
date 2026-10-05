# InvestiMaker

「用意された高品質な2Dパーツを組み合わせ、TRPGでそのまま使える立ち絵・差分・アイコンを作る。」

TRPG 用の 2D キャラクター立ち絵・差分・アイコンを、既製パーツの組み合わせで作るブラウザツールです。サーバーを持たない完全クライアントサイドのアプリで、第三者が自作パーツ（`.impart`）を追加できる公開規格を持つ予定です。

## 現在の段階

このリポジトリは製品ではなく、素材規格（[仕様書](docs/specifications/InvestiMaker_Asset_Specification_v1.md)）の未確定事項を確定するための検証用実装です。**Phase 0 は完了し、仕様書は検証結果を反映した RC1 になっています。**

- 仮素材 1 セット（スクリプトで生成した単純な図形）
- 仕様書どおりの Asset 解決・描画順・色合成・検証（`src/core/`）
- それを操作して確かめる検証ページ（`src/lab/`）
- 結果をまとめた[検証レポート](docs/reports/Phase0_Verification_Report.md)

**Phase 1-A（完了）** では、キャラクターの保存形式を設計しました。まだキャラクタークリエイターの UI はありません。

- [Character Schema v1（RC1）](docs/specifications/InvestiMaker_Character_Schema_v1.md) と `schemas/character.schema.json`
- 保存・読込・検証・編集の実装（`src/core/character/`）
- [Phase 1-A 検証レポート](docs/reports/Phase1A_Verification_Report.md)

**Phase 1-B（完了）** では、Character を正本とする最小 UI を作りました。新規作成 → Part 選択 → 色変更 → Transform → JSON 保存 → JSON 読込 → PNG 出力 を一通り行えます。デザインや使い勝手は最小限です。

- 本体の最小 UI（`src/app/`）
- [Phase 1-B 検証レポート](docs/reports/Phase1B_Verification_Report.md)

**Phase 1-C（進行中）** では、最小 UI を実際に使える Creator UI にします。1-C-1（設計）が完了し、1-C-2（実装）は検証済みで判断待ちです。次は 1-C-3（操作検証）です。

- [UI/UX 設計書](docs/design/InvestiMaker_Phase1C_UIUX_Design.md)
- [ワイヤーフレームと操作判断](docs/design/Phase1C1_Wireframes.md)
- Creator UI（`src/app/`）と [Phase 1-C-2 検証レポート](docs/reports/Phase1C2_Verification_Report.md)

## 起動方法

### 使う（インストール不要）

**`index.html` を開くだけです。** ダブルクリックで、Chrome か Edge で開いてください。インストールも、コマンドの実行も要りません。

`index.html` は、アプリと素材をすべて 1 つにまとめたファイルです。ほかのファイルを必要としないので、**`index.html` だけを人に渡しても、そのまま使えます。** 通信もしません。

（開発する人へ：`index.html` は生成物です。`src/app/` や素材を変えたら、`npm run build:standalone` で作り直します。）

### 開発する

Node.js 24 以降が必要です（`tools/` の TypeScript を Node の型除去で直接実行するため）。

```sh
npm install
npm run dev        # http://127.0.0.1:5173/dev.html が開発中の Creator UI。/minimal.html は Phase 1-B の最小 UI、/lab.html は検証ページ
npm test           # 単体テストと規格適合性テスト（§6.6 の T1〜T12、§5.3 の色計算の参照ベクタを含む）
npm run typecheck  # 型検査
```

### 仮素材の再生成

`assets/development/` は生成物です。手で編集せず、スクリプトから再生成します（同じ入力なら同じ出力）。

```sh
npm run gen:assets                                   # 既定 1600×2400 → assets/development/
npm run gen:assets -- --width 1200 --height 1800 --out assets/bench/1200x1800
npm run gen:assets:sizes                             # 1200×1800 / 1600×2400 / 2000×3000 を assets/bench/ に生成
```

`assets/bench/` は git 管理外です。検証ページで `?set=bench/2000x3000` のように指定すると、そのサイズの素材で合成します。

### レポート用の画像と計測

```sh
npm run report:images   # 発色・描画順の比較画像を docs/reports/images/ に生成（ブラウザ不要）
npm run bench:browser   # ヘッドレスの Chrome / Edge で検証ページを開き、合成時間などを計測
```

`npm run smoke:creator` は Creator UI を、`npm run smoke:minimal` は Phase 1-B の最小 UI を、ヘッドレスのブラウザで実際に操作して確かめます。

`bench:browser` とスモークテストはローカルにインストール済みの Chrome または Edge を使います（`BROWSER_PATH` で指定可）。通信先は自分の PC 内（127.0.0.1）だけです。

## 構成

```text
docs/specifications/  仕様書（唯一の正）。素材規格と、キャラクターの保存形式
docs/design/          基本設計書 v0.1（背景理解用）、Phase 1-C の UI/UX 設計書とワイヤーフレーム
docs/instructions/    Phase 0 の作業指示書
docs/reports/         検証レポートと比較画像
src/core/             manifest 型・検証・Asset 解決・描画順・色合成・互換性（DOM 非依存。製品版に持ち越す）
src/app/              InvestiMaker の Creator UI（Character が唯一の正本）
src/minimal/          Phase 1-B の最小 UI（Character 操作のリファレンスとして残してある）
src/web/              素材の読み込みと Canvas 合成（本体と検証ページの共用）
src/lab/              検証ページ（規格・描画・性能の検証環境）
assets/development/   生成した仮素材（.impart を展開した形）
assets/official/      （今回は空）
schemas/              JSON Schema（キャラクターの保存形式）
tools/                仮素材の生成、レポート用画像の生成、ブラウザ計測
tests/core/           単体テスト
tests/conformance/    規格適合性テスト
tests/character/      キャラクターの保存形式のテスト（round-trip、不足 Part、3 状態、配置補正）
tests/app/            Creator UI の操作のテスト（DOM なし）
tests/minimal/        Phase 1-B の最小 UI の操作のテスト
```

## 方針

- 実行時に外部通信をしません（CDN・外部フォント・解析タグなし）。
- 他サービスの画像・コード・UI を流用しません。
- 作業規則は [CLAUDE.md](CLAUDE.md) を参照してください。
