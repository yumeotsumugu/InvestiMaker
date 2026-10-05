# InvestiMaker — TRPG向けキャラクタークリエイターツール 基本設計書 v0.1

2026-10-05

> **この文書の位置づけ**：`InvestiMaker_設計書_v0.1.docx` の内容を Markdown に起こしたもの。背景理解用であり、作成後に方針が変わっている。食い違う箇所は `docs/specifications/InvestiMaker_Asset_Specification_v1.md`（仕様書）が優先する。主な変更点：
>
> - VARIANT は継承を持たず、7 軸（APPEARANCE / OUTFIT / EXPRESSION / POSE / VIEW / ITEM / OVERLAY）の選択状態に名前を付けたものになった（本書 §7 は旧方針）。
> - レイヤーは固定順の一覧ではなく、Part → Layer → Layer Slot の構造になった（本書 §5 は旧方針）。
> - 色変更は Mask 方式になった。

「用意された高品質な2Dパーツを組み合わせ、TRPGでそのまま使える立ち絵・差分・アイコンを作る。」

## 1. プロジェクト概要

InvestiMaker は、TRPGで使用する2Dキャラクター立ち絵を作成するブラウザベースのキャラクタークリエイター。既製パーツの組み合わせを基本としつつ、表情・衣装・ポーズ・持ち物・ユーザー追加パーツ・レイヤー編集・用途別書き出しまでを一つのツールで扱う。

| 項目 | 内容 |
| --- | --- |
| 正式名称 | InvestiMaker \| TRPG向けキャラクタークリエイターツール |
| 主用途 | TRPGの全身立ち絵、バストアップ、キャラクターアイコン、表情・衣装・ポーズ差分の制作 |
| 基本方式 | 2Dレイヤー合成。PNGを標準、SVGは選択対応 |
| 保存 | キャラクター設定をJSONで保存・復元 |
| 対象 | PL / KP / シナリオ作者 / 立ち絵素材制作者 |
| 非目標 | Live2D、3D、自由骨格アニメーションを中核機能にしない |

## 2. 設計原則

- TRPG用途を最優先し、『作る』だけでなく『セッションで使える画像にする』までを一連の体験にする。
- v1で実装しない機能も、将来追加を妨げないデータ構造・素材規格を先に定義する。
- 年齢・体格・胸部・顔年齢など、細かなキャラクター設定を再現できる余地を持たせる。
- 年齢の数値と外見を固定しない。25歳の老け顔、45歳の若々しい顔なども作れる設計にする。
- 既製素材とユーザー追加素材を同じレイヤーシステムで扱う。
- ユーザー追加パーツに実行コードを許可せず、画像＋宣言的メタデータを基本とする。
- 他サービスの画像・コード・固有UIを流用せず、素材・UI・仕様を独自制作する。

## 3. データモデル

『キャラクター本体』『現在状態』『見せ方』『出力』を分離する。差分は可能な限りBASEからの変更点のみを保持する。

| 階層 | 役割 | 主な内容 |
| --- | --- | --- |
| CHARACTER | 誰なのか | 素体、顔、髪、身体特徴、基本衣装、基本アクセサリー |
| VARIANT / STATE | 今どうなっているか | 表情、衣装差分、ポーズ、向き、持ち物、負傷等 |
| COMPOSITION | どう見せるか | 全身、膝上、腰上、胸上、顔アップ、位置、ズーム |
| PORTRAIT | アイコン化 | 丸、四角、角丸、背景、枠、人物位置 |
| EXPORT | どう保存するか | サイズ、形式、透過、保存名テンプレート、一括出力 |

```json
{
  "app": "InvestiMaker",
  "formatVersion": 1,
  "character": {},
  "variants": [],
  "composition": {},
  "portrait": {},
  "export": {}
}
```

## 4. キャラクター編集項目

| カテゴリ | 将来想定する項目 | 方針 |
| --- | --- | --- |
| BODY | 性別表現、年齢帯、身長、体格、肩幅、胸部、腰、脚、筋肉、肌 | 素体差分＋一部パラメータ |
| FACE | 輪郭、耳、目、眉、鼻、口、顔年齢、シワ、クマ、頬 | 年齢と独立して調整 |
| HAIR | 前髪、横髪、後髪、追加髪、長さ、ベース色、毛先、インナー、メッシュ | 複数カラースロット |
| DETAIL | ホクロ、そばかす、傷、ひげ、化粧、赤面等 | 左右指定・位置差分 |
| CLOTHING | インナー、シャツ、ベスト、アウター、ボトムス、靴下、靴 | 重ね着可能 |
| ACCESSORY | 帽子、メガネ、ピアス、ネックレス、ネクタイ等 | 左右・前後を考慮 |
| POSE | 正面、左右斜め、横、腕組み、ポケット等 | 向きごとの対応素材 |
| HAND / ITEM | 左右手ポーズ、スマホ、本、バッグ、傘、カメラ等 | 前後関係を管理 |
| EXPRESSION | 通常、笑顔、怒り、悲しみ、驚き、恐怖、発狂、負傷等 | 差分として保存 |

## 5. 素材・レイヤー設計

標準素材はPNG。必要な素材のみSVGを選択可能とする。すべての素材は共通キャンバスと基準座標に合わせる。

```text
background
back_effect
back_hair
body
lower_clothes
inner
shirt
vest
outer
neck_accessory
face
eyes / eyebrows / nose / mouth / face_detail
front_hair
hand_back
item
hand_front
glasses
head_accessory
front_effect
```

Advanced Modeではレイヤー順をドラッグ変更可能にする。各レイヤーは表示/非表示、ロック、不透明度、X/Y位置、拡大縮小、回転、左右反転を持てる。通常モードでは自動レイヤー順を使用する。

## 6. 向き・ポーズ・互換性

正面・斜め・横は単純変形ではなく、原則として向きごとの専用素材として扱う。素材には対応素体・向き・ポーズ・必要条件・競合条件を宣言できる。

```json
"compatible": {
  "body": ["adult_normal_01"],
  "view": ["front", "diagonal_left"]
},
"requires": [],
"conflicts": ["pose.right_hand.pocket"]
```

## 7. 差分システム

同一キャラクターを複製するのではなく、BASEを継承するVARIANT方式を基本とする。

```text
BASE: 探索者A
├─ 通常
├─ 笑顔
├─ 私服
├─ 冬服
├─ 戦闘時
└─ 負傷

冬服 = BASE + {
  "outer": "coat_03",
  "neckAccessory": "muffler_01"
}
```

BASE側の髪色などを変更した場合、差分側で明示的に上書きしていない項目には変更を継承する。

## 8. お気に入り・プリセット

| 機能 | 用途 |
| --- | --- |
| FAVORITES | 髪型・目・服・アクセサリー等、個別パーツのお気に入り |
| PRESET | スーツ、制服、冬服、カラーパレット等の組み合わせ保存 |
| VARIANT | 特定キャラクター専用の表情・衣装・ポーズ差分 |
| RECENT | 最近使ったパーツ |

ランダム生成は全体だけでなく、顔だけ・服だけ・色だけ等のカテゴリ単位にも対応できる設計とする。

## 9. ユーザー追加パーツ

特殊シナリオ専用衣装や独自アクセサリー等を追加できるよう、パーツパッケージ規格を定義する。仮称拡張子は .impart。実体はZIP＋manifest.json＋画像群とする。

```text
special_costume.impart
├─ manifest.json
├─ preview.png
└─ assets/
   ├─ front.png
   ├─ diagonal_left.png
   └─ diagonal_right.png
```

```json
{
  "format": "INVESTIMAKER_PART",
  "formatVersion": 1,
  "id": "author.special_costume_01",
  "name": "特殊衣装",
  "author": "Example",
  "category": "clothing.outer",
  "assetType": "png",
  "colorSlots": 2,
  "compatible": {
    "body": ["adult_normal_01"],
    "view": ["front"]
  }
}
```

JavaScript、HTML、実行ファイル、外部URLからの動的読込は許可しない。ユーザーSVGを許可する場合はサニタイズを必須とする。

## 10. TRPG向け画像出力

| 出力 | 内容 |
| --- | --- |
| Standing | 全身 / 膝上 / 腰上 / 胸上 / 顔アップ |
| Portrait | 丸 / 四角 / 角丸 / 背景透過 / 背景色 / 枠付き |
| Expression Set | 通常・笑顔・怒り等の表情差分一括 |
| Variant Set | 衣装・ポーズ・表情差分一括 |
| TRPG Preset | 立ち絵＋アイコン＋選択差分をまとめて出力 |

Portraitではキャラクター本体を変更せず、ズーム・X/Y位置・背景・枠を保存する。ココフォリア等のチャット欄やダイスロール時に見やすい小型アイコン用途を想定する。

## 11. 保存ファイル名テンプレート

保存名には {} プレースホルダーを利用可能にする。テンプレート自体もプリセット保存できる。

| プレースホルダー | 意味 | 例 |
| --- | --- | --- |
| {name} | キャラクター名 | シータ |
| {variant} | 差分名 | 冬服 |
| {expression} | 表情 | smile |
| {pose} | ポーズ | normal |
| {view} | 向き | front |
| {crop} | 出力範囲 | bust |
| {type} | standing / portrait 等 | portrait |
| {size} | 出力px | 512 |
| {date} | 出力日 | 20261005 |
| {index} | 連番 | 01 |

```text
テンプレート:
{name}_{variant}_{expression}_{type}_{size}

出力例:
シータ_冬服_smile_portrait_512.png
```

未設定プレースホルダーの扱い、OSで使用できない文字の置換、重複時の連番付与、文字数上限を正式仕様で定義する。

## 12. JSON保存仕様

- formatVersionを必須とし、将来のマイグレーションに備える。
- 素材はファイル名ではなく安定したpart IDで参照する。
- ユーザー追加素材には作者名前空間を含むIDを推奨する。
- キャラクター本体とEXPORT/PORTRAIT設定を分離する。
- 差分はBASEとの差分のみ保存できる構造を採用する。
- 存在しない素材IDは全体エラーにせず『不足素材』として表示する。
- 旧バージョンJSONを可能な範囲で自動変換する。

## 13. UI構成案

```text
HEADER
  InvestiMaker / New / Load / Save / Undo / Redo

LEFT: CATEGORY
  BODY / FACE / HAIR / CLOTHING / ACCESSORY
  POSE / ITEM / EXPRESSION

CENTER: PREVIEW
  Character Canvas
  Full / Knee / Waist / Bust / Face

RIGHT: PARTS / SETTINGS
  Parts Grid / Color / Fine Adjustments / Favorites

ADVANCED
  Layers / Compatibility / Position / Scale / Rotate

EXPORT
  Variant / Portrait / Export
```

通常利用者には簡単な着せ替えUIを見せ、レイヤー操作・位置補正・互換性情報はAdvanced Modeへ分離する。

## 14. 実装フェーズ

| Phase | 内容 | 完成条件 |
| --- | --- | --- |
| 0: 規格 | キャンバス、座標、レイヤー、ID、manifest、JSON | 素材1セットを規格通り作れる |
| 1: Prototype | 素体1、顔1、髪1、服1、靴1、合成、PNG出力 | 1キャラがブラウザ上で完成 |
| 2: Creator | パーツ選択、色、Undo/Redo、Favorites、Save/Load | 通常のキャラクリが成立 |
| 3: TRPG | 表情差分、衣装差分、全身～顔、Portrait | セッション用素材一式を出せる |
| 4: Custom | ユーザー追加パーツ、manifest検証、レイヤー操作 | 特殊衣装等を安全に追加 |
| 5: Expansion | 向き、ポーズ、持ち物、年齢・体格拡充 | 細かな再現性を高める |

## 15. v1候補 / 将来対応

| v1候補 | 将来対応 |
| --- | --- |
| 正面・標準素体 | 斜め・横向き |
| 基本的な顔・髪・服 | 年齢別・体格別・胸部等の細分化 |
| 基本表情 | 発狂・負傷等の高度差分 |
| PNG素材 | SVG素材 |
| JSON保存/読込 | 旧形式マイグレーション強化 |
| 全身～顔のクロップ | ポーズ別カメラプリセット |
| Portrait背景・形状 | 高度な枠・装飾テンプレート |
| Favorites / Preset | 共有プリセット・パッケージ |

『将来対応』は後付けで無理やり足すのではなく、Phase 0の規格時点でデータ構造・ID・互換性フィールドを確保する。

## 16. Phase 0で次に確定する事項

- マスターキャンバスサイズと基準座標
- 標準素体の頭身・姿勢・基準年齢帯
- 身体パーツをどこまで分割するか
- 標準レイヤー順とレイヤーグループ
- PNG/SVGの制作ルール（余白、透過、色スロット）
- part ID / category ID / body ID / view ID の命名規則
- .impart（仮）の正式仕様
- JSON Schema v1
- ファイル名テンプレートの正式プレースホルダー
- ユーザー素材のライセンス表示・作者情報の扱い
- 不足素材・非互換素材・競合素材がある場合のUI挙動

END — InvestiMaker Basic Design v0.1
