# InvestiMaker Phase 1-C UI/UX Design Specification v0.1

TRPG向けキャラクタークリエイターツール

2026-10-05

Phase 1-B で成立した最小UIを、実際に使える Creator UI へ移行するための設計書

> `InvestiMaker_Phase1C_UIUX_Design_v0.1.docx` の内容を Markdown に起こしたもの。Phase 1-C-1 のワイヤーフレームと操作判断は `Phase1C1_Wireframes.md` にある。

## 0. 文書の位置づけ

本書は、Phase 1-B で成立した Character を正本とする最小UIを、InvestiMaker の製品UIへ発展させるための UI/UX 設計を定める。Asset Specification v1（RC1）および Character Schema v1（RC1）の意味論は変更せず、ユーザーが内部仕様を意識せずにキャラクターを作成できる操作体系を設計する。

Phase 1-C の主目的は「見た目を整えること」ではなく、開発者向けの操作単位を、利用者向けの概念へ翻訳することである。

| 項目 | 状態 |
| --- | --- |
| Asset Specification v1 | RC1 / 変更しない |
| Character Schema v1 | RC1 / 変更しない |
| Phase 1-B Minimal UI | 完了 / 検証用として維持 |
| Phase 1-C | Creator UI / UX の設計・実装 |

## 1. Phase 1-C のゴール

ユーザーが JSON、Part ID、Instance ID、Layer、Transform の内部構造を知らなくても、次の操作を自然に完了できる状態を作る。

- 新しいキャラクターを作る。
- 素体・顔・髪・服・装飾をカテゴリから選ぶ。
- 髪・瞳・肌・衣装などの色を変更する。
- 表情・ポーズ・向きを変更する。
- 必要な場合だけ詳細な配置補正を行う。
- 作業内容を保存・読み込みできる。
- 現在のキャラクターを透過PNGとして出力できる。

Phase 1-C 完了時点では、VARIANT / PORTRAIT / 高度なEXPORTを完成させる必要はない。まず CREATE と CUSTOMIZE を製品レベルへ引き上げる。

## 2. 製品フロー

InvestiMaker 全体の利用フローは、将来的に次の5段階とする。

```text
CREATE  →  CUSTOMIZE  →  VARIANT  →  PORTRAIT  →  EXPORT
```

| 段階 | 役割 | Phase 1-C |
| --- | --- | --- |
| CREATE | 新規キャラクター、基本素体、初期設定 | 実装対象 |
| CUSTOMIZE | 外見・服・色・表情・ポーズ・装飾 | 実装対象 |
| VARIANT | 表情・衣装・ポーズ等の組合せを名前付きで保存 | 入口のみ / 後続 |
| PORTRAIT | バストアップ・顔アイコンの構図調整 | 後続 |
| EXPORT | 画像・一括出力・TRPG向けプリセット | Phase 1-C は単一PNGのみ |

## 3. 基本レイアウト

デスクトップを主対象とし、3ペイン構成を基本とする。現在の Phase 1-B UI の情報配置を活かしつつ、左側を「Part一覧」ではなく「ユーザーが選ぶカテゴリ」、右側を「選択対象の編集」に再構成する。

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ InvestiMaker        キャラクター名              保存  読込  設定          │
├──────────────┬───────────────────────────────┬───────────────────────────┤
│ カテゴリ      │                               │ 編集パネル                 │
│              │          PREVIEW              │                           │
│ 素体          │                               │ 選択中：前髪03             │
│ 顔            │                               │ 色 / 装備 / 詳細           │
│ 髪            │                               │                           │
│ 服            │                               │ 必要時のみ Advanced        │
│ 装飾          │                               │                           │
│ 表情          │                               │                           │
│ ポーズ        │                               │                           │
├──────────────┴───────────────────────────────┴───────────────────────────┤
│ CREATE        CUSTOMIZE        VARIANT        PORTRAIT        EXPORT     │
└──────────────────────────────────────────────────────────────────────────┘
```

## 4. ヘッダー

- 左端に InvestiMaker のブランド名を表示する。
- 中央付近に Character.name を直接編集できる領域を置く。
- 右側に保存、読み込み、設定等の全体操作を置く。
- VALID / UNRESOLVED 等の内部状態は常時大きく見せず、問題がある場合にステータス表示または通知として見せる。
- Part ID、Instance ID、requirements 等は通常モードでは表示しない。

## 5. 左ペイン：カテゴリナビゲーション

左ペインは Asset Specification の category をそのまま羅列しない。利用者が理解しやすい大分類へまとめ、その中で必要な小分類を選ぶ。

| 大分類 | 主な内容 |
| --- | --- |
| 素体 | 体型、肌、見た目年齢に関係する基本要素 |
| 顔 | 輪郭、目、眉、鼻、口、耳、ほくろ・詳細 |
| 髪 | 前髪、横髪、後髪、追加髪 |
| 服 | トップス、ボトムス、アウター、靴、靴下、首元等 |
| 装飾 | 眼鏡、帽子、耳飾り、アクセサリー |
| 表情 | 目・眉・口の状態。将来は表情プリセットも扱う |
| ポーズ | 胴体、左右腕。名前付きポーズは組合せプリセット |
| その他 | ITEM / OVERLAY 等 |

hair.front / outfit.top のような内部 category 名は、Advanced Mode やデバッグ情報を除きユーザーへ露出しない。

## 6. Part 選択UI

Part は文字列IDではなくサムネイルを中心に選ぶ。通常の単一選択categoryでは、別Partを選ぶと既存Partを置き換える。複数選択categoryでは追加・解除を明示する。

- カードにはサムネイルと表示名を基本とする。
- 選択中のPartは視覚的に明確にする。
- 未対応・競合・不足は選択不能または警告付きとして理由を表示する。
- 内部IDは通常表示しない。Advanced Modeでは確認可能にしてよい。
- 正式素材が増えた段階で検索・タグ・お気に入りを追加できる構造にするが、Phase 1-Cでは必須にしない。

## 7. 中央：Preview

- 1600×2400 の内部キャンバスをアスペクト比を維持して縮小表示する。
- 透過背景はチェッカー等で視認可能にする。
- Part・色・State の変更は可能な限り即時反映する。
- Preview 自体は Character の第二の状態を持たない。Character → evaluate → plan → render の結果を表示する。
- Phase 1-CではドラッグによるTransform編集を必須としない。

## 8. 右ペイン：編集パネル

右ペインは現在選択している対象に応じて内容を切り替える。常に全設定を並べない。

| 選択対象 | 表示する主な操作 |
| --- | --- |
| Part | 装備状態、ColorSlot、共有色リンク、詳細設定 |
| 素体 | fit、共有肌色等 |
| 表情 | 目・眉・口、将来はプリセット |
| ポーズ | 胴体・左腕・右腕、将来は名前付きプリセット |
| VIEW | 利用可能な向き |
| Advanced | Transform、pivot、内部情報 |

## 9. 色変更

色は Character Schema の sharedColors / Equipment Instance colors / linked をそのまま利用し、UI側に別の色モデルを作らない。

- 肌・髪・瞳など共有色に向くものは、利用者には『髪色』『左目』『右目』等の意味名で見せる。
- リンク中のColorSlotは共有色変更に追従する。
- 個別色に切り替える操作は『このパーツだけ色を変える』等の表現を優先する。
- リンク解除時に見た目を変えない既存挙動を維持する。

## 10. State：表情・ポーズ・VIEW

Phase 1-Bの生のselect群を、利用目的ごとのUIへ分ける。Character Schema上の state は正本のまま維持する。

- 表情：目・眉・口を個別に選べる。将来、3要素の組合せを表情プリセットとして提供する。
- ポーズ：胴体・左腕・右腕を個別に選べる。将来、組合せを『腕組み』『手を振る』等の名前付きプリセットとして提供する。
- VIEW：素材対応状況が分かる形で選択する。描画Layerが0件になる状態ではExport不可であることをUIでも明示する。

## 11. Advanced Mode

通常利用者に不要な内部操作は Advanced Mode に隔離する。Phase 1-Cでは最低限の入口とTransform編集を対象とする。

- Transform：X / Y / Scale X / Scale Y / Rotation。
- 条件別Transform：現在のVIEW・POSEを基に補正を作成・削除できる。
- pivotはPhase 1-Cで操作方法を検討する。既定値そのものはRC1仕様から変更しない。
- Part ID / Instance ID / category / warning details は必要に応じてAdvancedで表示可能。
- Advancedを閉じてもデータは保持される。

## 12. 保存・読み込み・出力

| 操作 | Phase 1-C の挙動 |
| --- | --- |
| 保存 | Character JSON をダウンロード。requirements は保存時に再生成 |
| 読み込み | INVALID は拒否、UNRESOLVED は保持して読み込み |
| PNG | 現在状態を1600×2400透過PNGで1枚出力 |
| 0 Layer | Character状態は変えず、Exportの事前条件として出力不可 |

## 13. エラー・警告の見せ方

仕様上の状態と、ユーザーに見せるメッセージを分離する。

| 内部状態 | UIの基本挙動 |
| --- | --- |
| VALID | 通常表示。原則としてステータスを強調しない |
| UNRESOLVED / 描画可能 | 注意を表示。編集・保存・PNG出力を許可 |
| UNRESOLVED / 描画不能 | 原因を表示。保存は可能、PNG出力は無効 |
| INVALID | 読み込みを拒否し、現在のCharacterを維持 |
| 0 Layer | 『描画できる素材がありません』等を表示し、PNG出力を無効 |

## 14. UI状態とCharacter状態の境界

Phase 1-Bで成立した原則を維持する。製品UIになっても Character を唯一の正本とする。

```text
UI が保持してよい例
- 現在開いている大分類
- 選択中の Equipment Instance
- 開いているサブパネル
- Advanced Mode の開閉
- Transform の適用範囲選択

Character に入れるべき例
- 装備Part
- 色
- fit
- VIEW / POSE / EXPRESSION
- Transform
- 装備順
```

## 15. 技術方針

- Phase 1-C-1の設計確定まではUIフレームワークを導入しない。
- Phase 1-C-2の実装も、現在の規模で問題がなければDOM + TypeScriptを継続してよい。
- フレームワーク導入は、状態管理・コンポーネント再利用・画面数の増加による実益が明確になった時点で再評価する。
- src/core/ はDOM非依存を維持する。
- src/web/ はブラウザ依存の共通処理、src/app/ は製品UI、src/lab/ は検証環境という責務を維持する。

## 16. Phase 1-C の分割

| 段階 | 内容 | 成果物 |
| --- | --- | --- |
| 1-C-1 | UI/UX Design | 本設計書、ワイヤーフレーム、画面遷移・操作判断 |
| 1-C-2 | Creator UI Implementation | CREATE / CUSTOMIZE の製品UI |
| 1-C-3 | Usability Verification | 操作検証、修正、Phase 2への判断 |

## 17. Phase 1-C-1 完了条件

1. メイン画面の3ペイン構成が確定している。
2. カテゴリ構成とPart選択方法が確定している。
3. 通常モードとAdvanced Modeの境界が確定している。
4. 色・表情・ポーズ・VIEWの操作位置が確定している。
5. 保存・読込・PNG出力・警告の表示方針が確定している。
6. CREATE / CUSTOMIZE の操作フローをワイヤーフレームで確認できる。
7. Phase 1-C-2の実装指示書を作成できるだけの判断が揃っている。

## 18. Phase 1-C ではまだ実装しないもの

- VARIANTの本実装
- PORTRAIT / アイコン構図編集
- 複数画像・ZIP・CCFOLIA向け一括Export
- OUTFIT inheritanceの製品UI
- カスタム.impart導入UI
- 高度なLayer並び替え
- Undo / Redo
- IndexedDBによる自動保存
- スマートフォン向け完成レイアウト
- 正式素材制作

## 19. 次の作業

この設計書 v0.1 を基に、Phase 1-C-1 ではメイン画面のワイヤーフレームを作成して比較する。レイアウトと操作体系を確定した後、Phase 1-C-2 の実装指示書を作成し、既存の src/app/ を段階的に製品UIへ置き換える。
