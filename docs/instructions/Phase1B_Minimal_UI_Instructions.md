# InvestiMaker Phase 1-B 作業指示書

Minimal Creator UI & Character Schema RC1 Validation

対象：このリポジトリで作業する Claude Code
作成日：2026-10-05

---

## 0. 目的

Character Schema v1 草案 0.2 を正本として、InvestiMaker の**最小限のキャラクター作成 UI**を実装する。

ユーザー操作から、

> 新規作成 → Part 選択 → 色変更 → Transform → プレビュー → JSON 保存 → JSON 読込 → PNG 出力

を一通り成立させ、Character Schema v1 を RC1 にできるか判断する。

Phase 1-B は完成版 UI の設計フェーズではない。UX・デザインシステム・レスポンシブ対応等は必要最低限とし、**保存形式と Core API が実製品の操作に耐えるかの検証を優先する。**

## 1. ブランチ

`phase1-minimal-ui` を main から作成する。Phase 1-B 完了までは main へマージしない。

## 2. UI 技術

**素の DOM + TypeScript で実装する。** React / Vue / Svelte 等の UI フレームワークは導入しない。

理由は、今回扱う正本が Character 1 個であり、Phase 1-B の目的がフレームワーク選定ではなく Character Schema の検証だから。Phase 1-B 終了後、実製品 UI を拡張する段階で改めて技術選定してよい。Vite 等、既存の開発環境はそのまま利用する。

## 3. `src/lab/` と `src/app/`

既存の `src/lab/` は **Phase 0 / 1-A 検証環境として残す。** 原則として Character ベースへ全面移行しない。既存テスト・ベンチマーク・比較機能を壊さないため、必要最小限の修正だけ許可する。

製品側の最小 UI を `src/app/` として新設する。

```text
src/core/       共通ロジック
src/lab/        規格・描画・性能の検証環境
src/app/        InvestiMaker本体
```

`src/app/` では **Character を唯一の正本**とする。UI 専用の「装備 Part ID 配列」などを第二の正本として持たない。

## 4. 仮素材

`assets/development/` の `dev` namespace 素材を使用する。

ただし「Part 選択」を実際に検証するため、**同一 category の選択肢を最低 2 種類用意する。** 最低限、`hair.front` と `outfit.top` を 2 種類以上用意すること。既存素材を含めて 2 種類になればよい。

新規素材は**デザイン品質を目的としない単純な仮素材**でよい。形や模様を変え、「選択が切り替わったこと」が目視できれば十分。

`overlay` や `item` 等の複数装備 category については、既存 fixture で検証可能なら追加素材を必須としない。正式素材の制作は Phase 1-B の範囲外。

## 5. 最小 UI

1 画面でよい。最低限、以下の領域を持つ。

### Character

- 新規作成
- Character 名
- JSON 保存
- JSON 読込
- PNG 出力
- VALID / UNRESOLVED / INVALID 表示

### Preview

1600×2400 の内部キャンバスを、画面に収まるサイズへ縮小表示する。描画自体は Core を使用し、UI 独自の Asset 解決を実装しない。

### Parts

利用可能 Part を category 単位で表示する。最低限、次を識別可能にする。

- 現在装備している Part
- 選択可能 Part
- 装備
- 外す
- 不足 Part
- 非対応
- 競合
- category 重複の注意

完成版のカード UI や検索機能は不要。

### Colors

選択した Equipment Instance について、ColorSlot・共有色・linked / unlinked・個別色を操作できる。

リンク解除時に現在表示色をコピーする既存仕様を必ず `operations.ts` 経由で使用する。Character Schema で確定した挙動を UI 側で再実装しない。

### State

最低限、VIEW・torso pose・left arm pose・right arm pose・eyes・eyebrows・mouth・fit を変更できる。実際に選択できる値は、現在の実装が知っている定義から生成することを優先する。

## 6. Character の扱い

`src/app/` の正本は常に `Character` 1 個とする。

UI 操作は可能な限り `operations.ts` の純粋関数を使用する。描画前評価は `evaluate.ts` を使用する。描画計画は既存 Core を使用する。基本フローは次のとおり。

```text
DOM event
   ↓
Character operation
   ↓
Character
   ↓
evaluate
   ↓
plan
   ↓
render
```

DOM から直接 Character 内部を場当たり的に書き換えない。

## 7. JSON 保存・読込

### 保存

Character Schema v1 草案 0.2 準拠 JSON を出力する。`requirements` は保存時に必ず再生成する。未知フィールドを保持する既存挙動を壊さない。

### 読込

JSON を選択して、deserialize → validate → evaluate → UI 反映 → Preview まで行う。

- INVALID なら現在編集中の Character を置き換えない。
- UNRESOLVED なら読み込みを許可する。
- Part 不足でも Instance 情報を失わないこと。

## 8. Transform

Phase 1-B では**数値入力のみ**実装する。ドラッグ、ハンドル操作、マウスによる回転・拡縮等は実装しない。

最低限、X・Y・Scale X・Scale Y・Rotation を編集できる。`pivot` は Schema 上保持・適用できるようにするが、Phase 1-B UI で編集可能にすることは必須としない。

### Core

Asset 仕様の順序「pivot を中心に scale → rotation → translation」を実描画へ反映する。

### 条件別 Transform

Phase 1-B で `overrides` の正式なキー構造を設計・実装する。最低単位は既定どおり VIEW × POSE とする。

ただし 3 領域の pose を単純連結した巨大な文字列キーにすることを前提にしない。**機械的に検証しやすく、将来 VIEW や Pose が増えても拡張できる構造**を選定すること。具体的な Schema は実装・検証結果から提案してよい。

重要なのは、基本 `transform`・現在の VIEW・torso pose・left arm pose・right arm pose から、その状態に適用する補正が**決定論的に一意に決まること**。条件別補正が存在しない場合は基本 `transform` だけを使用する。

ここで決定した形式は Character Schema 草案 0.3 候補とする。

## 9. UNRESOLVED と Export

次の暫定挙動を実装して検証する。

- **描画可能な UNRESOLVED** → 警告を表示し、PNG 出力を許可。例：コートが missing → 他の Part は描画可能 → PNG 出力可能。
- **描画意味論自体が決められない UNRESOLVED** → PNG 出力不可。例：実装が知らない pose → 腕の placement / order が決められない → PNG 出力不可。

Phase 1-B 終了時に、この挙動を正式採用するか判断する。INVALID は編集対象として読み込まず、PNG 出力もしない。

## 10. PNG 出力

現在の Character State をそのまま 1600×2400 の PNG として出力する。背景透過、現在の状態 1 枚だけでよい。

全身 / バストアップ / アイコン、背景色、円形、ZIP、表情一括出力等はまだ実装しない。

## 11. category 重複

通常 UI では、Asset 仕様上 1 個だけの category について、新しい Part を選択したら既存 Part を外す操作を基本とする。

ただし外部 JSON から重複状態を読み込んだ場合は、勝手に修正せず、両方描画し、注意表示する。Character Schema 草案 0.2 の規定をそのまま UI でも確認する。

## 12. 今回やらないもの

```text
正式デザイン
スマホ最適化
レスポンシブ完成
UIフレームワーク導入
ドラッグTransform
Undo / Redo
IndexedDB
VARIANT
OUTFIT inheritance
PORTRAIT
COMPOSITION
アイコン出力
背景編集
CCFOLIA一括出力
ZIP
.imchar
カスタムPart導入UI
Advanced Layer UI
検索
お気に入り
正式Capability仕様
migration
正式素材制作
```

「便利そうだから」という理由で Phase 1-B へ追加しないこと。

## 13. テスト

既存 236 件を壊さない。新たに最低限、次を自動テストする。

- 新規 Character 生成
- Part A → Part B 切替
- unequip → equip で Instance と順序維持
- 色変更
- link → unlink
- State 変更
- Transform 基本値の描画反映
- 条件別 Transform
- JSON 保存 → 読込
- JSON 読込後の画像一致
- missing Part を含む読込
- missing Part を含む PNG 出力可否
- unknown pose で PNG 出力不可
- category 重複を保持
- INVALID 読込で現在 Character を破壊しない

UI 操作そのものについては、既存環境で可能ならヘッドレス Chrome によるスモークテストを行う。

## 14. 検証レポート

`docs/reports/Phase1B_Verification_Report.md` を作成する。最低限、次を記録する。

1. 実装した範囲
2. 最小 UI の操作フロー
3. Character を正本として一周できたか
4. Transform の検証結果
5. `overrides` に採用した構造と他案を採用しなかった理由
6. UNRESOLVED Export の検証
7. Schema 草案 0.2 で使いにくかった点
8. Schema 変更案
9. RC1 にできるかの実装側評価
10. Phase 1-C 以降への持ち越し

## 15. 完了条件

1. `src/app/` に Character を正本とする最小 UI が存在する。
2. 新規作成 → Part 選択 → 色変更 → Transform → JSON 保存 → JSON 読込 → PNG 出力 を実ブラウザ経路で完走できる。
3. 保存前後で Character の意味と描画結果が一致する。
4. missing Part を含む Character を情報損失なく扱える。
5. Transform が Core の実描画に反映され、条件別補正の形式が決まっている。
6. UNRESOLVED 時の PNG 出力可否を実際に検証できている。
7. 既存 Phase 0 / 1-A テストを含む全テストが通る。
8. Phase 1-B 検証レポートが完成している。
9. Character Schema v1 を RC1 にできるか判断できる状態になっている。

## Phase 1-B 終了時

この段階では**自動的に RC1 へ上げない。** 結果を持ち帰り、次を見て一緒に判定する。

- `overrides` の最終形
- UI から実際に使って気づいた Schema 上の問題
- UNRESOLVED Export
- Character Schema を変更した箇所
- RC1 にできると考えるか

問題なければその時点で Character Schema v1 → RC1、Phase 1-B → COMPLETE としてタグを切る。
