# InvestiMaker Asset Specification v1（草案 0.2）

2026-10-05 / 基本設計書 v0.1 および以後の合意事項に基づく

この文書は、InvestiMaker が扱う素材（Part）の構造・画像規格・解決規則・パッケージ形式を定める。キャラクター保存形式（JSON Schema v1）と UI 挙動は別文書で定義し、本書はそれらが参照する土台とする。

**【暫定】** と付いた値は実装・作画検証後に確定する。一覧は §13 にまとめる。

---

## 0. 規定の強度

- **MUST / MUST NOT**：違反した素材は読み込みを拒否する。
- **SHOULD / SHOULD NOT**：違反しても読み込むが、検証時に警告を出す。
- **MAY**：任意。

## 1. 用語と関係

| 用語 | 定義 |
|---|---|
| **Part** | ユーザーが選ぶ単位（「ロングコート」「前髪03」）。1つの `category` に属する。 |
| **Layer** | Part を構成する描画単位。1つの **Layer Slot** に置かれる。1 Part は 1 個以上の Layer を持つ。 |
| **Asset** | Layer の実画像。向き・ポーズ等の条件（`when`）ごとに複数持てる。 |
| **Mask** | Asset に対応する色領域画像。 |
| **ColorSlot** | Part が宣言する「色の意味」（main / lapel / button）。 |
| **Body** | 素体。Part の一種（`kind: "body"`）で、基準座標と fit の定義を持つ。 |
| **Context** | 描画時の状態（view / body / pose / state / fit / attach）。Asset 解決の入力。 |

```text
Package (.impart)
└─ Part ── category, colorSlots[], compatible, requires, conflicts, transform
   └─ Layer[] ── slot
      └─ Asset[] ── when{view, body, pose, state, fit, attach}, file, offset
         └─ Mask ── file, channels{r,g,b → ColorSlot}
```

## 2. 軸とカテゴリ

キャラクターの状態は 7 軸で表す。Part の `category` は必ずいずれかの軸に属する（MUST）。

| 軸 | 選択方式 | category（v1） |
|---|---|---|
| APPEARANCE | 固定（OUTFIT から上書き可） | `body` / `face.head` / `face.ears` / `face.eyes` / `face.eyebrows` / `face.nose` / `face.mouth` / `hair.front` / `hair.side` / `hair.back` / `hair.extra`* / `detail`* |
| OUTFIT | スロット式 | `outfit.inner` / `outfit.top` / `outfit.vest` / `outfit.outer` / `outfit.bottom` / `outfit.socks` / `outfit.shoes` / `outfit.glove` / `outfit.neck` / `outfit.eyewear` / `outfit.head` / `outfit.ear`* / `outfit.accessory`* |
| EXPRESSION | 単一選択 | Part を持たない（§6.3） |
| POSE | 単一選択 | Part を持たない（§6.2） |
| VIEW | 単一選択 | Part を持たない |
| ITEM | 複数選択 | `item`* |
| OVERLAY | 複数選択 | `overlay`*（赤面・汗・涙・血・汚れ・負傷等） |

\* は同一 category に複数の Part を同時装備できる。それ以外は 1 category につき 1 Part。

- VARIANT は軸の選択状態に名前を付けたものであり、素材規格には現れない。
- OUTFIT は default OUTFIT を 1 段だけ継承する。値は「未指定＝継承 / `null`＝外す / ID＝置換」。多段継承は v1 では禁止。

## 3. ID 規則

- ID は `[a-z0-9_]` のセグメントを `.` で連結した文字列（MUST）。全体で 96 文字以内。
- Part ID は `<namespace>.<name>` とする（MUST）。例：`im.coat_001`、`yos.special_costume_01`。
- namespace `im` は公式素材専用。ユーザー素材は使用してはならない（MUST NOT）。
- category は ID に含めない。分類を後から変えても ID が変わらないようにするため。
- Part ID は一度公開したら意味を変えない（MUST NOT）。見た目を大きく変える場合は新しい ID を発行する。
- ColorSlot ID・Layer ID は Part 内で一意（MUST）。

### 3.1 左右と向きの基準

- **`left` / `right`（腕・手・耳など身体部位）はキャラクター自身から見た左右**（MUST）。
- **VIEW の `diagonal_left` / `side_left` は画面上でキャラクターが向く方向**（MUST）。
- v1 で定義する VIEW ID：`front` / `diagonal_left` / `diagonal_right` / `side_left` / `side_right`。v1 の公式実装は `front` のみ。

## 4. キャンバスと画像規格

### 4.1 マスターキャンバス

- サイズは **1600 × 2400 px（2:3）【暫定】**。
- 原点は左上、単位は px、X は右、Y は下が正。
- 基準座標（頭頂・目線・足元など）は Body が `anchors` で宣言する（§7）。

### 4.2 PNG Asset

- 8bit RGBA、sRGB、非プリマルチプライ（MUST）。APNG は不可（MUST NOT）。
- キャンバス全体サイズ、または余白をトリミングして `offset: [x, y]` を付ける（MAY）。配置後にキャンバスからはみ出してはならない（MUST NOT）。
- トリミングを推奨する（SHOULD）。全面サイズの画像を数十枚重ねるとスマホでメモリが不足する。
- 線画・影・ハイライトは Asset 側に描く。色変更対象の領域は §5.3 の下地色で描く（MUST）。

### 4.3 Mask

- 対応する Asset と同じピクセルサイズ・同じ `offset`（MUST）。
- 8bit PNG。R / G / B の各チャンネルが 1 つの ColorSlot の**適用率**（0＝適用なし、255＝完全適用）を表す。
- **A チャンネルは v1 では使用しない【暫定】**。ブラウザの Canvas は内部でアルファを乗算して保持するため、A が低い画素で RGB の値が壊れる。4 スロット以上が必要な場合は Mask を複数枚持つ。
- 同一画素でのチャンネル合計は 255 以下（SHOULD）。
- 線画部分の Mask 値は 0（MUST）。線画は色変更の影響を受けない。

### 4.4 SVG Asset

- 素材ごとに PNG または SVG を選べる。1 Part 内での混在も可（MAY）。
- SVG は**キャンバス解像度でラスタライズした後、PNG と同一の処理を行う**（MUST）。色変更も Mask で行い、SVG 内の属性書き換えは行わない。
- `<script>`、`<foreignObject>`、イベント属性、外部参照（`href` / `url()` による外部リソース）、アニメーション要素を含んではならない（MUST NOT）。読み込み側は必ずサニタイズする（MUST）。
- v1 の公式実装は SVG を未対応としてよい（MAY）。

## 5. 色

### 5.1 ColorSlot の宣言（Part）

```json
"colorSlots": [
  { "id": "main",   "name": "本体",   "mode": "tint", "default": "#3A3F4B" },
  { "id": "lapel",  "name": "襟",     "mode": "tint", "default": "#2B2F38" },
  { "id": "button", "name": "ボタン", "mode": "tint", "default": "#C8A85A" }
]
```

| フィールド | 必須 | 内容 |
|---|---|---|
| `id` | MUST | Part 内で一意 |
| `name` | SHOULD | UI 表示名 |
| `mode` | MUST | `tint` / `multiply` / `fixed` |
| `default` | MUST | `#RRGGBB` |
| `link` | MAY | 共有カラーキー（§5.4） |

### 5.2 Mask の割り当て（Layer の Asset）

```json
"mask": { "file": "assets/front/body.mask.png",
          "channels": { "r": "main", "g": "lapel", "b": "button" } }
```

- `channels` の値は、その Part が宣言した ColorSlot ID（MUST）。
- 4 スロット以上を使う Asset は `masks: [ {...}, {...} ]` と配列で持つ（MAY）。
- Mask を持たない Asset は色変更されない。

### 5.3 合成式

計算は sRGB の 8bit 値を 0–1 に正規化したまま行う（MUST）。線形化はしない。実装間で結果を一致させるため。

画素の元色を `B`、スロット色を `C`、適用率を `w` とする。

- **`tint`（標準）**：`L = 0.2126·B.r + 0.7152·B.g + 0.0722·B.b` として
  - `L ≤ 0.5` のとき `out = C × (L / 0.5)`
  - `L > 0.5` のとき `out = C + (1 − C) × ((L − 0.5) / 0.5)`

  下地が **50% グレー（#808080）【暫定】** のとき、指定色そのものになる。それより暗い部分は影、明るい部分はハイライトになる。素材の色変更領域は 50% グレーを基準に無彩色で描く（MUST）。
- **`multiply`**：`out = B × C`。下地は白に近い明色で描く（SHOULD）。ハイライトは表現できない。
- **`fixed`**：色変更しない。UI にも出さない。将来の互換のための宣言。

最終色は `result = B × (1 − Σw) + Σ(w × out)`、アルファは `B` のまま（MUST）。

### 5.4 共有カラーキー

ColorSlot は `link` でキャラクター側の共有色を参照できる。

| キー | 用途 |
|---|---|
| `skin.base` | 肌 |
| `hair.base` / `hair.sub` | 髪のベース / 毛先・インナー等 |
| `eyes.left` / `eyes.right` | 瞳 |

- `link` を持つスロットは、既定で共有色に従う。ユーザーはインスタンス単位でリンクを解除し個別色を指定できる。
- 未定義のキーを参照した場合は `default` を使う（MUST）。
- 肌が露出する衣装 Layer（半袖の腕など）は、肌を衣装側に描かず素体の Layer に任せる（SHOULD）。

## 6. Layer と Asset 解決

### 6.1 Layer Slot と標準描画順【暫定】

Layer は必ず下表の Layer Slot のいずれかに属する（MUST）。番号ではなく Slot 名で指定し、描画順は本表が決める。奥から手前の順。

| グループ | Layer Slot（奥 → 手前） |
|---|---|
| G0 背景 | `background` → `effect.back` |
| G1 後方 | `outfit.head.back` → `hair.back` → `item.back` → `outfit.outer.back` |
| G2 腕（背面） | ポーズが「胴体の後ろ」と指定した腕の腕グループ |
| G3 胴体 | `body.base` → `overlay.body` → `outfit.socks` → `outfit.shoes` → `outfit.bottom` → `outfit.inner` → `outfit.top` → `outfit.shoes.over` → `outfit.vest` → `outfit.outer` → `item.waist` |
| G4 首 | `outfit.neck` |
| G5 頭部 | `face.head` → `face.detail` → `overlay.face` → `face.mouth` → `face.nose` → `face.eyes` → `hair.side` → `face.ears` → `outfit.ear` → `hair.front` → `face.eyebrows` → `outfit.eyewear` → `overlay.face.front` → `hair.extra` → `outfit.head` |
| G6 腕（前面） | ポーズが「胴体の前」と指定した腕の腕グループ |
| G7 前方 | `item.front` → `overlay.front` → `effect.front` |

**腕グループ**（`<side>` は `left` / `right`）：

`arm.<side>.skin` → `overlay.arm.<side>` → `arm.<side>.sleeve.inner` → `arm.<side>.sleeve.top` → `arm.<side>.sleeve.outer` → `arm.<side>.hand` → `arm.<side>.glove` → `item.hand.<side>` → `arm.<side>.hand.front`

- 腕は「腕（上腕＋前腕）」と「手」の 2 分割とする。上腕と前腕の分離は行わない。
- 腕グループを G2 / G6 のどちらに置くかは、ポーズ定義が腕ごとに指定する。
- 同一 Slot に複数 Layer がある場合、Layer の `zBias`（−9〜9、既定 0）の昇順、同値なら装備順で描く。
- Advanced Mode での順序変更はキャラクター側のデータであり、素材は関与しない。

### 6.2 ポーズ

POSE は 3 つの**領域**の状態の組である。名前付きポーズ（腕組み等）はこの組のプリセット。

| 領域 | Context キー | v1 の状態 |
|---|---|---|
| 胴体・脚 | `pose.torso` | `stand` |
| 左腕 | `pose.arm.left` | `down` |
| 右腕 | `pose.arm.right` | `down` |

Asset の `when.pose` は、**その Layer の Slot が属する領域**の状態と照合する。`arm.left.*` / `overlay.arm.left` / `item.hand.left` は左腕、右も同様、それ以外は胴体。これにより、腕のポーズを追加したときに描き足すのは腕と袖の Layer だけになる。

### 6.3 表情

EXPRESSION は Part を持たず、顔 Part の**状態**（`state`）の組として定義する。

```json
{ "id": "smile", "eyes": "smile", "eyebrows": "relaxed", "mouth": "smile_open" }
```

- 目・眉・口の Part は、状態ごとの Asset を `when.state` で持つ。
- 標準状態名【暫定】：
  - 目：`open` / `half` / `closed` / `smile` / `wide` / `glare`
  - 眉：`neutral` / `relaxed` / `angry` / `sad` / `raised`
  - 口：`closed` / `smile` / `smile_open` / `open` / `frown` / `shout`
- v1 の標準表情：`normal` / `smile` / `angry` / `sad` / `surprised` / `fear`。
- 公式の目・眉・口 Part は標準状態をすべて持つ（MUST）。ユーザー素材は一部でよい（MAY）。

### 6.4 `when` の書式

```json
"when": { "view": "front", "pose": "down", "fit": { "chest": "large" } }
```

| キー | 型 | 省略時 |
|---|---|---|
| `view` | 文字列または配列 | **省略不可（MUST）** |
| `body` | 文字列または配列 | Part の `compatible.body` すべて |
| `pose` | 文字列または配列 | すべてのポーズで有効 |
| `state` | 文字列または配列 | すべての状態で有効 |
| `attach` | 文字列または配列 | すべての装着位置で有効 |
| `fit` | `{次元: 値または配列}` | すべての fit で有効 |

**キーの省略は「この条件に依存しない」という作者の宣言**である。ポーズで形が変わる Layer（袖など）は `pose` を明示する（SHOULD）。

### 6.5 解決アルゴリズム

Layer ごとに次の順で Asset を決める（MUST）。実装はこの手順以外の推測で画像を選んではならない（MUST NOT）。

1. Context と `when` のすべてのキーが一致する Asset を候補とする。配列は「いずれかに一致」を意味する。
2. 候補が複数あれば、**具体度**が最も高いものを選ぶ（下記）。
3. 候補がなく、Part が `mirrorable: true` で、VIEW に左右対の相手がある場合、VIEW と左右領域を入れ替えた Context で 1–2 を行い、得られた画像をキャンバス中央の縦軸で反転して使う。
4. それでも候補がなければ、その Layer は**未解決**とする。

**具体度**は次の 5 要素の組で、左から順に比較する（MUST）。

`( body を指定したか, pose を指定したか, state を指定したか, attach を指定したか, fit で指定した次元の数 )`

- 前 4 要素は「指定あり＝1、省略＝0」。大きい方が具体的。
- **配列の要素数は具体度に影響しない**（MUST）。`"body": "A"` と `"body": ["A", "B"]` は同じ具体度である。
- `view` は必須キーなので比較に含めない。

**重複の禁止**：同一 Layer 内で、具体度が等しい 2 つの Asset が同じ Context に同時に一致しうる場合、その manifest は不正とする（MUST NOT）。「同時に一致しうる」とは、両者が共に指定しているすべてのキー（`view` と fit の各次元を含む）で値の集合が交わることをいう。読み込み時に検証して拒否するため、**実行時に同点は発生しない**。

- 未解決の Layer が `optional: true` なら描画を省く。それ以外なら **Part 全体を「非対応」とし、一部の Layer だけを描画してはならない**（MUST NOT）。
- 同じ入力に対して結果は常に同じでなければならない（MUST）。

結果として、fit 違いの画像がなければ fit 非依存の画像に、ポーズ違いがなければポーズ非依存の画像に落ちる。ただしそれは作者がキーを省略して「非依存」と宣言した場合に限る。

### 6.6 解決のテストケース

実装はすべてのケースで下表と同じ結果を返すこと（MUST）。`view` はすべて `front` とし、表では省略する。

| # | Asset X の `when` | Asset Y の `when` | Context | 結果 |
|---|---|---|---|---|
| T1 | （なし） | `pose: down` | pose=down | **Y**（pose 指定が勝つ） |
| T2 | （なし） | `pose: down` | pose=pocket | **X**（Y は不一致、X はポーズ非依存） |
| T3 | `pose: down` | `fit: {chest: large}` | pose=down, chest=large | **X**（pose は fit より上位） |
| T4 | `pose: down` | `pose: down, fit: {chest: large}` | pose=down, chest=large | **Y**（fit の次元数が多い） |
| T5 | `pose: down` | `pose: down, fit: {chest: large}` | pose=down, chest=small | **X**（Y は不一致） |
| T6 | `body: A` | `pose: down` | body=A, pose=down | **X**（body は pose より上位） |
| T7 | `body: [A, B], pose: down` | `body: A, pose: [down, pocket]` | — | **manifest 不正**（具体度が等しく、body=A・pose=down で両方一致） |
| T8 | `body: [A, B]` | `body: A` | — | **manifest 不正**（配列の短さは優先理由にならない） |
| T9 | `pose: down` | `pose: pocket` | pose=down | **X**（値が交わらないので重複ではない） |
| T10 | `fit: {chest: large}` | `fit: {waist: wide}` | — | **manifest 不正**（次元数が等しく、chest=large・waist=wide で両方一致） |
| T11 | `pose: down` | — | pose=pocket | **未解決**（`optional` でなければ Part 全体が非対応） |
| T12 | `pose: [down, pocket]` | `state: smile` | pose=down, state=smile | **X**（pose は state より上位） |

T7・T8 を意図どおりにしたい作者は、値の集合が交わらないよう書き分ける（例：X を `body: B`、Y を `body: A` にする）。

## 7. Body（素体）

`kind: "body"` の Part。category は `body`。骨格・シルエットが変わるものは別 Body とする。

```json
{
  "id": "im.body_adult_standard",
  "kind": "body",
  "category": "body",
  "views": ["front"],
  "fitDimensions": { "chest": ["small", "medium", "large"] },
  "anchors": {
    "front": {
      "head_top": [800, 180], "eye_line": [800, 420], "chin": [800, 560],
      "bust": [800, 900], "waist": [800, 1180], "knee": [800, 1780], "foot": [800, 2340]
    }
  },
  "colorSlots": [ { "id": "skin", "mode": "tint", "default": "#F2D3BD", "link": "skin.base" } ],
  "layers": [ "…body.base / arm.left.skin / arm.left.hand / …" ]
}
```

- `anchors` は VIEW ごとに必須（MUST）。COMPOSITION の全身〜顔アップと PORTRAIT の初期位置は anchors から算出する。素体が変わっても構図プリセットが使えるようにするため。座標値は例示。
- 手に持つ ITEM の基準点は `anchors.<view>.hand.<side>.<腕の状態>` として宣言する（v1.x）。
- `fitDimensions` は v1 では `chest` のみ【暫定】。次元を増やすと必要画像数が掛け算で増えるため、追加は慎重に行う。
- 肌色・筋肉表現・シワなど、シルエットを変えない差は ColorSlot または `detail` / `overlay` の Part で表す。

## 8. 互換性

```json
"compatible": { "body": ["im.body_adult_standard"] },
"requires":  [ { "type": "category", "category": "outfit.top" } ],
"conflicts": [
  { "type": "state", "path": "pose.arm.right", "value": "pocket" },
  { "type": "part",  "id": "im.bag_001" }
],
"hides": ["hair.extra"],
"mirrorable": false
```

| フィールド | 内容 |
|---|---|
| `compatible.body` | 対応する Body ID の配列（MUST、Body 自身を除く） |
| `requires` / `conflicts` | 条件の配列。`type` は `part`（`id`）/ `category`（`category`）/ `state`（`path` + `value`） |
| `hides` | 装備中に非表示にする Layer Slot の配列（MAY）。帽子が `hair.extra` を隠す等 |
| `mirrorable` | 左右反転での代用を許可（既定 `false`） |

- `state` の `path` は Context のキー（`view` / `pose.torso` / `pose.arm.left` / `pose.arm.right` / `expression`）。
- 対応 VIEW・ポーズは宣言せず、§6.5 の解決結果から導く。二重管理による食い違いを避けるため。
- 状態は 3 種に分類する：**不足**（Part ID が見つからない）/ **非対応**（解決できない）/ **競合**（`conflicts` に該当、または `requires` を満たさない）。いずれも全体エラーにはしない。UI 挙動は別文書で定める。

## 9. Transform

- Part は既定の配置補正 `transform` を持てる（MAY）。Part の全 Layer に一括で適用する。

```json
"transform": { "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "pivot": [800, 420] }
```

- 適用順は「`pivot` を中心に拡大縮小 → 回転（度、時計回り）→ 平行移動」（MUST）。`pivot` 省略時はキャンバス中央。
- 優先順位は **Part 既定 → キャラクターの装備インスタンス → 各軸（OUTFIT 等）の上書き**。インスタンスの値は Part 既定に対する差分として合成し、軸の上書きはインスタンスの値を置き換える。
- キャラクター側の補正は `view × ポーズ` を最小キーとして保持する。保存形式は JSON Schema v1 で定義する。

## 10. パッケージ形式（.impart）

```text
long_coat.impart            ← ZIP
├─ manifest.json            ← ルート直下、UTF-8（BOM なし）
├─ preview.png              ← 256×256
├─ LICENSE.txt              ← 任意
└─ assets/
   └─ front/
      ├─ back.png
      ├─ back.mask.png
      ├─ body.png
      └─ body.mask.png
```

- v1 では 1 パッケージ＝1 Part（MUST）。
- 含めてよい拡張子は `.json` / `.png` / `.svg` / `.txt` のみ（MUST）。それ以外を含むパッケージは拒否する。
- パスは相対パスのみ。`..`、絶対パス、シンボリックリンクは不可（MUST NOT）。
- manifest 内の文字列を URL として取得してはならない（MUST NOT）。ライセンスの URL は文字として表示するだけにする。
- 読み込み側は展開前に、展開後合計サイズ・ファイル数・画像の縦横 px を検査する（MUST）。上限の目安は合計 100MB、500 ファイル、画像 1 枚はマスターキャンバス以下【暫定】。
- `manifest.json` で参照されるファイルがすべて存在すること（MUST）。参照されないファイルは警告（SHOULD NOT）。

## 11. manifest 全体例

```json
{
  "format": "INVESTIMAKER_PART",
  "formatVersion": 1,
  "id": "im.coat_001",
  "version": "1.0.0",
  "kind": "part",
  "name": "ロングコート",
  "author": "InvestiMaker",
  "category": "outfit.outer",
  "tags": ["冬", "フォーマル"],
  "license": {
    "name": "InvestiMaker Standard License",
    "url": "",
    "commercial": true,
    "modify": true,
    "redistributable": true,
    "creditRequired": false,
    "creditText": ""
  },
  "compatible": { "body": ["im.body_adult_standard"] },
  "requires": [],
  "conflicts": [],
  "hides": [],
  "mirrorable": false,
  "colorSlots": [
    { "id": "main",   "name": "本体",   "mode": "tint", "default": "#3A3F4B" },
    { "id": "lapel",  "name": "襟",     "mode": "tint", "default": "#2B2F38" },
    { "id": "button", "name": "ボタン", "mode": "tint", "default": "#C8A85A" }
  ],
  "layers": [
    {
      "id": "back",
      "slot": "outfit.outer.back",
      "assets": [
        { "when": { "view": "front" },
          "file": "assets/front/back.png", "offset": [520, 600],
          "mask": { "file": "assets/front/back.mask.png", "channels": { "r": "main" } } }
      ]
    },
    {
      "id": "body",
      "slot": "outfit.outer",
      "assets": [
        { "when": { "view": "front" },
          "file": "assets/front/body.png", "offset": [540, 580],
          "mask": { "file": "assets/front/body.mask.png",
                    "channels": { "r": "main", "g": "lapel", "b": "button" } } },
        { "when": { "view": "front", "fit": { "chest": "large" } },
          "file": "assets/front/body_chest_l.png", "offset": [530, 580],
          "mask": { "file": "assets/front/body_chest_l.mask.png",
                    "channels": { "r": "main", "g": "lapel", "b": "button" } } }
      ]
    },
    {
      "id": "sleeve_l",
      "slot": "arm.left.sleeve.outer",
      "assets": [
        { "when": { "view": "front", "pose": "down" },
          "file": "assets/front/sleeve_l_down.png", "offset": [980, 640],
          "mask": { "file": "assets/front/sleeve_l_down.mask.png",
                    "channels": { "r": "main", "b": "button" } } }
      ]
    },
    {
      "id": "sleeve_r",
      "slot": "arm.right.sleeve.outer",
      "assets": [
        { "when": { "view": "front", "pose": "down" },
          "file": "assets/front/sleeve_r_down.png", "offset": [460, 640],
          "mask": { "file": "assets/front/sleeve_r_down.mask.png",
                    "channels": { "r": "main", "b": "button" } } }
      ]
    }
  ]
}
```

この例では、胸部 `large` のとき身頃だけが専用画像になり、他の Layer は共通画像を使う。右腕が `pocket` のポーズでは `sleeve_r` が未解決になり、コート全体が「非対応」と表示される。対応させるには `pose: "pocket"` の袖画像を 1 枚足せばよい。

### 11.1 必須フィールド

`format` / `formatVersion` / `id` / `version` / `kind` / `name` / `author` / `category` / `license` / `layers`（1 個以上）。Body 以外は `compatible.body` も必須。

- `formatVersion` が実装の対応範囲より新しい場合は読み込みを拒否する（MUST）。
- 未知のフィールドは無視し、エラーにしない（MUST）。将来拡張のため。
- `license` の各真偽値は作者の自己申告である。`redistributable: false` の Part は `.imchar`（素材同梱キャラクター）に含めない（MUST NOT）。

## 12. 検証項目（読み込み時）

1. ZIP の安全性（§10：パス、サイズ、拡張子）。
2. manifest の必須フィールドと ID 書式（§3、§11.1）。
3. `slot` が §6.1 に存在し、`category` が §2 に存在する。
4. `channels` が宣言済みの ColorSlot を指し、Mask と Asset のサイズが一致する。
5. `when` の重複がない（§6.5「重複の禁止」、§6.6 の T7・T8・T10）。
6. SVG のサニタイズ（§4.4）。
7. 同じ ID の Part が既にある場合は `version` を比較し、上書き前にユーザーへ確認する。

## 13. 未確定事項

| # | 項目 | 現在の暫定値 | 確定に必要なこと |
|---|---|---|---|
| 1 | マスターキャンバス | 1600×2400 | 仮素材での出力画質とスマホでのメモリ計測 |
| 2 | `tint` の基準下地 | 50% グレー | 仮素材で明色・暗色・肌色の発色を確認 |
| 3 | Mask の A チャンネル | 不使用（RGB 3 スロット） | Canvas / WebGL での実測 |
| 4 | 標準描画順 | §6.1 | 仮素材 1 セットで重なりを確認（特に靴と裾、眉と前髪、帽子と髪） |
| 5 | 表情の標準状態名 | §6.3 | 画風決定後に過不足を見直し |
| 6 | `fitDimensions` | `chest` のみ | 素体の種類と合わせて決定 |
| 7 | パッケージ上限 | 100MB / 500 ファイル | 実素材のサイズ感 |
| 8 | 帽子と髪の干渉 | `hides` のみ | 髪を帽子の形で切り抜く仕組みが要るか検討 |
| 9 | ITEM の装着仕様 | `attach` と手の anchors を予約 | v1.x で詳細化 |
