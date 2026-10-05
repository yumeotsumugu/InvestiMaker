# InvestiMaker Asset Specification v1（RC1）

2026-10-05 / 草案 0.2 に Phase 0 検証の結果を反映

この文書は、InvestiMaker が扱う素材（Part）の構造・画像規格・解決規則・パッケージ形式を定める。キャラクター保存形式（JSON Schema v1）と UI 挙動は別文書で定義し、本書はそれらが参照する土台とする。

草案 0.2 からの変更点は §15、決定の根拠は `docs/reports/Phase0_Verification_Report.md` にある。確定した事項・保留する事項・再検証する事項は §14 にまとめる。

---

## 0. 規定の強度

- **MUST / MUST NOT**：違反した素材は読み込みを拒否する。
- **SHOULD / SHOULD NOT**：違反しても読み込むが、検証時に警告を出す。
- **MAY**：任意。

**曖昧な記述を実装側が解釈して補ってはならない**（MUST NOT）。本書が意味を定めていない書き方は、不正として拒否する。Asset 解決（§6.5）と同じ考え方を manifest 全体に適用する。ただし未知のフィールドは将来拡張のために無視する（§11.1）。

## 1. 用語と関係

| 用語 | 定義 |
| --- | --- |
| **Part** | ユーザーが選ぶ単位（「ロングコート」「前髪03」）。1つの `category` に属する。 |
| **Layer** | Part を構成する描画単位。1つの **Layer Slot** に置かれる。1 Part は 1 個以上の Layer を持つ。 |
| **Asset** | Layer の実画像。向き・ポーズ等の条件（`when`）ごとに複数持てる。 |
| **Mask** | Asset に対応する色領域画像。 |
| **ColorSlot** | Part が宣言する「色の意味」（main / lapel / button）。 |
| **Body** | 素体。Part の一種（`kind: "body"`）で、基準座標と fit の定義を持つ。 |
| **Context** | 描画時の状態（view / body / pose / state / fit / attach）。Asset 解決の入力。 |
| **Pose Definition** | ポーズの状態の定義（§6.2）。InvestiMaker 側の共通定義で、素材は定義しない。 |

```text
Package (.impart)
└─ Part ── category, canvas, colorSlots[], compatible, requires, conflicts, transform
   └─ Layer[] ── slot
      └─ Asset[] ── when{view, body, pose, state, fit, attach}, file, offset
         └─ Mask ── file, channels{r,g,b → ColorSlot}
```

## 2. 軸とカテゴリ

キャラクターの状態は 7 軸で表す。Part の `category` は必ずいずれかの軸に属する（MUST）。

| 軸 | 選択方式 | category（v1） |
| --- | --- | --- |
| APPEARANCE | 固定（OUTFIT から上書き可） | `body` / `face.head` / `face.ears` / `face.eyes` / `face.eyebrows` / `face.nose` / `face.mouth` / `hair.front` / `hair.side` / `hair.back` / `hair.extra`\* / `detail`\* |
| OUTFIT | スロット式 | `outfit.inner` / `outfit.top` / `outfit.vest` / `outfit.outer` / `outfit.bottom` / `outfit.socks` / `outfit.shoes` / `outfit.glove` / `outfit.neck` / `outfit.eyewear` / `outfit.head` / `outfit.ear`\* / `outfit.accessory`\* |
| EXPRESSION | 単一選択 | Part を持たない（§6.3） |
| POSE | 単一選択 | Part を持たない（§6.2） |
| VIEW | 単一選択 | Part を持たない |
| ITEM | 複数選択 | `item`\* |
| OVERLAY | 複数選択 | `overlay`*（赤面・汗・涙・血・汚れ・負傷等） |

\* は同一 category に複数の Part を同時装備できる。それ以外は 1 category につき 1 Part。

- VARIANT は軸の選択状態に名前を付けたものであり、素材規格には現れない。
- OUTFIT は default OUTFIT を 1 段だけ継承する。値は「未指定＝継承 / `null`＝外す / ID＝置換」。多段継承は v1 では禁止。

## 3. ID 規則

- ID は `[a-z0-9_]` のセグメントを `.` で連結した文字列（MUST）。全体で 96 文字以内。
- Part ID は `<namespace>.<name>` とし、**セグメントはちょうど 2 個**（MUST）。例：`im.coat_001`、`yos.special_costume_01`。`a.b.c` は不正。
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

- サイズは **1600 × 2400 px（2:3）**。
- 原点は左上、単位は px、X は右、Y は下が正。
- 基準座標（頭頂・目線・足元など）は Body が `anchors` で宣言する（§7）。
- Part は、前提にしたキャンバスサイズを `canvas: [1600, 2400]` として宣言する（MUST）。マスターキャンバスと一致しない Part は読み込みを拒否する（MUST）。サイズの違う素材を黙って重ねないため。

### 4.2 PNG Asset

- 8bit RGBA、sRGB、非プリマルチプライ（MUST）。APNG は不可（MUST NOT）。
- キャンバス全体サイズ、または余白をトリミングして `offset: [x, y]` を付ける。`offset` は 0 以上の整数の組（MUST）。省略時は `[0, 0]`。
- 配置後にキャンバスからはみ出してはならない（MUST NOT）。
- **公式素材は余白をトリミングする（MUST）。** ユーザー素材もトリミングを推奨する（SHOULD）。全面サイズの画像は、トリミングした場合の 10 倍以上のメモリを使う（Phase 0 の実測で、52 枚が 55 MB に対し 762 MB）。
- 線画・影・ハイライトは Asset 側に描く。色変更対象の領域は §5.3 の下地色で描く（MUST）。

### 4.3 Mask

- 対応する Asset と同じピクセルサイズ・同じ `offset`（MUST）。
- 8bit PNG。R / G / B の各チャンネルが 1 つの ColorSlot の**適用率**（0＝適用なし、255＝完全適用）を表す。
- **A チャンネルは使用しない。** Mask の A は全画素 255 とする（SHOULD）。ブラウザの Canvas は内部でアルファを乗算して保持するため、A が低い画素では RGB の階調が A+1 段に減る（A が 128 未満では元の値で読める画素がなくなる）。4 スロット以上が必要な場合は Mask を複数枚持つ（§5.2）。
- 同一画素でのチャンネル合計は 255 以下（SHOULD）。超えた場合の計算は §5.3 で定める。
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
| --- | --- | --- |
| `id` | MUST | Part 内で一意 |
| `name` | SHOULD | UI 表示名 |
| `mode` | MUST | `tint` / `multiply` / `fixed` |
| `default` | MUST | `#RRGGBB` |
| `link` | MAY | 共有カラーキー（§5.4） |

`colorSlots` は省略できる（MAY）。省略した Part は色変更領域を持たない。

### 5.2 Mask の割り当て（Layer の Asset）

```json
"mask": { "file": "assets/front/body.mask.png",
          "channels": { "r": "main", "g": "lapel", "b": "button" } }
```

- `channels` のキーは `r` / `g` / `b` のみ（MUST）。それ以外のキー（`a` など）を持つ manifest は不正とする。
- `channels` の値は、その Part が宣言した ColorSlot ID（MUST）。
- 4 スロット以上を使う Asset は `masks: [ {...}, {...} ]` と配列で持つ（MAY）。全 Mask の全チャンネルを 1 つの適用率の集合として扱う。
- **`mask` と `masks` を同時に書いてはならない**（MUST NOT）。両方を持つ manifest は不正とする。
- Mask を持たない Asset は色変更されない。

### 5.3 合成式

計算は sRGB の 8bit 値を 0–1 に正規化したまま行う（MUST）。線形化はしない。

画素の元色を `B`、スロット色を `C`、適用率を `w` とする。基準下地の明度を **`p = 128 / 255`** とする。

- **`tint`（標準）**：`L = 0.2126·B.r + 0.7152·B.g + 0.0722·B.b` として
  - `L ≤ p` のとき `out = C × (L / p)`
  - `L > p` のとき `out = C + (1 − C) × ((L − p) / (1 − p))`

  下地が **50% グレー（#808080）** のとき、指定色そのものになる。それより暗い部分は影、明るい部分はハイライトになる。素材の色変更領域は 50% グレーを基準に無彩色で描く（MUST）。
- **`multiply`**：`out = B × C`。下地は白に近い明色で描く（SHOULD）。ハイライトは表現できない。`tint` 用に描いた素材をそのまま `multiply` にすると全体が約半分の明るさになるため、下地は合成モードごとに描き分ける。
- **`fixed`**：色変更しない。UI にも出さない。将来の互換のための宣言。

最終色は `result = B × (1 − Σw) + Σ(w × out)`、アルファは `B` のまま（MUST）。

- **`Σw > 1` の画素**は、各 `w` を `Σw` で割って合計を 1 に収めてから上の式を適用する（MUST）。
- **8bit への丸め**は四捨五入とし、ちょうど 0.5 は切り上げる：`floor(v × 255 + 0.5)`（MUST）。
- アルファが 0 の画素は変更しない。

### 5.4 共有カラーキー

ColorSlot は `link` でキャラクター側の共有色を参照できる。

| キー | 用途 |
| --- | --- |
| `skin.base` | 肌 |
| `hair.base` / `hair.sub` | 髪のベース / 毛先・インナー等 |
| `eyes.left` / `eyes.right` | 瞳 |

- `link` を持つスロットは、既定で共有色に従う。ユーザーはインスタンス単位でリンクを解除し個別色を指定できる。
- 未定義のキーを参照した場合は `default` を使う（MUST）。
- 肌が露出する衣装 Layer（半袖の腕など）は、肌を衣装側に描かず素体の Layer に任せる（SHOULD）。

## 6. Layer と Asset 解決

### 6.1 Layer Slot と標準描画順

Layer は必ず下表の Layer Slot のいずれかに属する（MUST）。番号ではなく Slot 名で指定し、描画順は本表が決める。奥から手前の順。

| グループ | Layer Slot（奥 → 手前） |
| --- | --- |
| G0 背景 | `background` → `effect.back` |
| G1 後方 | `outfit.head.back` → `hair.back` → `item.back` → `outfit.outer.back` |
| G2 腕（背面） | Pose Definition が `placement: "back"` と定めた腕の腕グループ |
| G3 胴体 | `body.base` → `overlay.body` → `outfit.socks` → `outfit.shoes` → `outfit.bottom` → `outfit.inner` → `outfit.top` → `outfit.shoes.over` → `outfit.vest` → `outfit.outer` → `item.waist` |
| G4 首 | `outfit.neck` |
| G5 頭部 | `face.head` → `face.detail` → `overlay.face` → `face.mouth` → `face.nose` → `face.eyes` → `hair.side` → `face.ears` → `outfit.ear` → `face.eyebrows` → `hair.front` → `face.eyebrows.over` → `outfit.eyewear` → `overlay.face.front` → `hair.extra` → `outfit.head` |
| G6 腕（前面） | Pose Definition が `placement: "front"` と定めた腕の腕グループ |
| G7 前方 | `item.front` → `overlay.front` → `effect.front` |

**腕グループ**（`<side>` は `left` / `right`）：

`arm.<side>.skin` → `overlay.arm.<side>` → `arm.<side>.sleeve.inner` → `arm.<side>.sleeve.top` → `arm.<side>.sleeve.outer` → `arm.<side>.hand` → `arm.<side>.glove` → `item.hand.<side>` → `arm.<side>.hand.front`

- 腕は「腕（上腕＋前腕）」と「手」の 2 分割とする。上腕と前腕の分離は行わない。
- 腕グループを G2 / G6 のどちらに置くか、同じグループに両腕が入るときの順序は、Pose Definition が決める（§6.2）。
- **眉は前髪の後ろ（`face.eyebrows`）が標準。** 前髪の上に眉を見せたい素材だけが `face.eyebrows.over` を使う。公式素材は `face.eyebrows` を使う（SHOULD）。
- **靴は 2 つの Slot を使い分ける。** 裾の下に入る靴は `outfit.shoes`、裾より前に来る靴（ブーツ等）は `outfit.shoes.over`。
- 同一 Slot に複数 Layer がある場合、Layer の `zBias`（−9〜9、既定 0）の昇順、同値なら装備順で描く。
- Advanced Mode での順序変更はキャラクター側のデータであり、素材は関与しない。

### 6.2 ポーズと Pose Definition

POSE は 3 つの**領域**の状態の組である。名前付きポーズ（腕組み等）はこの組のプリセット。

| 領域 | Context キー |
| --- | --- |
| 胴体・脚 | `pose.torso` |
| 左腕 | `pose.arm.left` |
| 右腕 | `pose.arm.right` |

Asset の `when.pose` は、**その Layer の Slot が属する領域**の状態と照合する。`arm.left.*` / `overlay.arm.left` / `item.hand.left` は左腕、右も同様、それ以外は胴体。これにより、腕のポーズを追加したときに描き足すのは腕と袖の Layer だけになる。

各領域が取れる状態は **Pose Definition** が定める。Pose Definition は InvestiMaker 側の共通定義であり、素材（`.impart`）が定義・変更することはできない（MUST NOT）。

```json
{ "id": "pocket", "region": "arm.right", "placement": "front", "order": 20 }
```

| フィールド | 内容 |
| --- | --- |
| `id` | 状態名。`when.pose` と Context が使う値 |
| `region` | `torso` / `arm.left` / `arm.right`。`(region, id)` の組で一意 |
| `placement` | 腕の領域のみ。腕グループの置き場所。`back`＝胴体の後ろ（G2）、`front`＝胴体の前（G6） |
| `order` | 腕の領域のみ。同じグループ（G2 または G6）に両腕が入るときの順序。昇順に奥から描き、同値なら left → right |

**v1 の Pose Definition**：

| region | id | placement | order | 備考 |
| --- | --- | --- | --- | --- |
| `torso` | `stand` | — | — | |
| `arm.left` | `down` | `back` | 10 | |
| `arm.right` | `down` | `back` | 20 | |
| `arm.left` | `pocket` | `front` | 10 | 公式素材は v1 では未提供 |
| `arm.right` | `pocket` | `front` | 20 | 公式素材は v1 では未提供 |

- Context のポーズは、必ず Pose Definition にある状態でなければならない（MUST）。
- **`when.pose` に、その Layer の領域の Pose Definition にない状態を書いてはならない**（MUST NOT）。そのような manifest は不正とする。定義のないポーズは置き場所も順序も決まらず、描画の意味が定まらないためである。領域ごとに照合するので、胴体の Layer に `down` を書くのも不正である。
- 状態の追加は本書の改訂で行う。追加された状態を使う素材は、その状態を知らない古い実装では不正として拒否される。

### 6.3 表情

EXPRESSION は Part を持たず、顔 Part の**状態**（`state`）の組として定義する。

- 目・眉・口の Part は、状態ごとの Asset を `when.state` で持つ。
- 標準状態名【画風決定後に再検証】：
  - 目：`open` / `half` / `closed` / `smile` / `wide` / `glare`
  - 眉：`neutral` / `relaxed` / `angry` / `sad` / `raised`
  - 口：`closed` / `smile` / `smile_open` / `open` / `frown` / `shout`
- v1 の標準表情【画風決定後に再検証】：

| id | eyes | eyebrows | mouth |
| --- | --- | --- | --- |
| `normal` | `open` | `neutral` | `closed` |
| `smile` | `smile` | `relaxed` | `smile_open` |
| `angry` | `glare` | `angry` | `frown` |
| `sad` | `half` | `sad` | `frown` |
| `surprised` | `wide` | `raised` | `open` |
| `fear` | `wide` | `sad` | `shout` |

- 公式の目・眉・口 Part は標準状態をすべて持つ（MUST）。ユーザー素材は一部でよい（MAY）。
- 目の `closed` と口の `smile` は、上の標準表情では使われない。ユーザーが状態を個別に選ぶときのために残す。

### 6.4 `when` の書式

```json
"when": { "view": "front", "pose": "down", "fit": { "chest": "large" } }
```

| キー | 型 | 省略時 |
| --- | --- | --- |
| `view` | 文字列または配列 | **省略不可（MUST）** |
| `body` | 文字列または配列 | Part の `compatible.body` すべて |
| `pose` | 文字列または配列 | すべてのポーズで有効 |
| `state` | 文字列または配列 | すべての状態で有効 |
| `attach` | 文字列または配列 | すべての装着位置で有効 |
| `fit` | `{次元: 値または配列}` | すべての fit で有効 |

**キーの省略は「この条件に依存しない」という作者の宣言**である。ポーズで形が変わる Layer（袖など）は `pose` を明示する（SHOULD）。配列は 1 個以上の要素を持つ（MUST）。

### 6.5 解決アルゴリズム

Layer ごとに次の順で Asset を決める（MUST）。実装はこの手順以外の推測で画像を選んではならない（MUST NOT）。

1. Context と `when` のすべてのキーが一致する Asset を候補とする。配列は「いずれかに一致」を意味する。
2. 候補が複数あれば、**具体度**が最も高いものを選ぶ（下記）。
3. 候補がなく、Part が `mirrorable: true` で、VIEW に左右対の相手がある場合、VIEW と左右領域を入れ替えた Context で 1–2 を行い、得られた画像をキャンバス中央の縦軸で反転して使う。
4. それでも候補がなければ、その Layer は**未解決**とする。

**各キーが照合する値**：

| `when` のキー | 照合する値 |
| --- | --- |
| `view` | Context の VIEW |
| `body` | 素体の Part ID。省略時は、素体が Part の `compatible.body` に含まれるときに一致 |
| `pose` | その Layer の Slot が属する領域の状態（§6.2） |
| `state` | Part の category で決まる表情の状態。`face.eyes` は目、`face.eyebrows` は眉、`face.mouth` は口。**それ以外の category の Part は状態を持たない** |
| `attach` | その装備インスタンスの装着位置（§14 の保留事項） |
| `fit` | 素体の fit の各次元の値 |

- **`when` が指定したキーに対して Context 側に値がない場合、その Asset は一致しない**（MUST）。状態を持たない Part での `state`、素体が宣言していない fit の次元、装着位置を持たないインスタンスでの `attach` がこれに当たる。
- **`when.fit` の次元と値は、対応する素体の `fitDimensions` と照合する。**
  - `compatible.body` に列挙した**どの素体にも存在しない**次元・値を使った manifest は不正とする（MUST NOT）。その Asset はどの Context にも一致しないためである。
  - 一部の素体にだけ存在する次元・値は有効である。その Asset は、その素体との組み合わせでだけ解決の対象になる。
  - Body 自身の `when.fit` は、自分の `fitDimensions` と照合する。
  - この検証には素体の manifest が要る。`compatible.body` に読み込まれていない素体があって判定できないときは、拒否せず警告にとどめる。

**具体度**は次の 5 要素の組で、左から順に比較する（MUST）。

`( body を指定したか, pose を指定したか, state を指定したか, attach を指定したか, fit で指定した次元の数 )`

- 前 4 要素は「指定あり＝1、省略＝0」。大きい方が具体的。
- **配列の要素数は具体度に影響しない**（MUST）。`"body": "A"` と `"body": ["A", "B"]` は同じ具体度である。
- `view` は必須キーなので比較に含めない。

**重複の禁止**：同一 Layer 内で、具体度が等しい 2 つの Asset が同じ Context に同時に一致しうる場合、その manifest は不正とする（MUST NOT）。「同時に一致しうる」とは、両者が共に指定しているすべてのキー（`view` と fit の各次元を含む）で値の集合が交わることをいう。読み込み時に検証して拒否するため、**実行時に同点は発生しない**。

- 未解決の Layer が `optional: true` なら描画を省く。それ以外なら **Part 全体を「非対応」とし、一部の Layer だけを描画してはならない**（MUST NOT）。
- 素体が Part の `compatible.body` に含まれない場合、Part は「非対応」とする（MUST）。
- 同じ入力に対して結果は常に同じでなければならない（MUST）。Asset の並び順に依存してはならない。

結果として、fit 違いの画像がなければ fit 非依存の画像に、ポーズ違いがなければポーズ非依存の画像に落ちる。ただしそれは作者がキーを省略して「非依存」と宣言した場合に限る。

### 6.6 解決のテストケース

実装はすべてのケースで下表と同じ結果を返すこと（MUST）。`view` はすべて `front` とし、表では省略する。Context は、その Layer を解決するときに `when` の各キーが照合する値である。

| # | Asset X の `when` | Asset Y の `when` | Context | 結果 |
| --- | --- | --- | --- | --- |
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

T12 は具体度の順序を確かめるための抽象的なケースである。v1 では、状態を持つ category（目・眉・口）の Layer は胴体の領域に属し、その状態は `stand` だけなので、実際の素材でこの組み合わせは現れない。

テストの入力は `tests/conformance/fixtures/resolve/` に manifest の断片として置く。

## 7. Body（素体）

`kind: "body"` の Part。category は `body`。骨格・シルエットが変わるものは別 Body とする。

```json
{
  "id": "im.body_adult_standard",
  "kind": "body",
  "category": "body",
  "canvas": [1600, 2400],
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
- `fitDimensions` は v1 では `chest` のみ【素体の種類と合わせて再検証】。次元を増やすと必要画像数が掛け算で増えるため、追加は慎重に行う。
- 肌色・筋肉表現・シワなど、シルエットを変えない差は ColorSlot または `detail` / `overlay` の Part で表す。
- ポーズによって見えなくなる Layer（ポケットに入れた手など）は、`optional: true` にしてそのポーズの Asset を持たないことで表す。

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
| --- | --- |
| `compatible.body` | 対応する Body ID の配列（MUST、Body 自身を除く） |
| `requires` / `conflicts` | 条件の配列。`type` は `part`（`id`）/ `category`（`category`）/ `state`（`path` + `value`） |
| `hides` | 装備中に非表示にする Layer Slot の配列（MAY）。帽子が `hair.extra` を隠す等 |
| `mirrorable` | 左右反転での代用を許可（既定 `false`） |

- `state` の `path` は Context のキー（`view` / `pose.torso` / `pose.arm.left` / `pose.arm.right` / `expression`）。`expression` は標準表情の ID と照合し、状態を個別に選んでいて標準表情に当たらないときは一致しない。
- 対応 VIEW・ポーズは宣言せず、§6.5 の解決結果から導く。二重管理による食い違いを避けるため。
- 状態は 3 種に分類する：**不足**（Part ID が見つからない）/ **非対応**（解決できない、または素体が `compatible.body` にない）/ **競合**（`conflicts` に該当、または `requires` を満たさない）。いずれも全体エラーにはしない。非対応と競合の両方に当たる Part は非対応とする。

**判定の規則**（MUST）：

- `part` / `category` 条件は、**装備中で見つかった Part**（自分自身を除く）に対して判定する。相手が非対応や競合で描画されないかどうかは問わない。
- 競合になるのは、条件を**宣言した側の Part だけ**である。A が `conflicts` に B を書いても、B は競合にならない。
- 競合の Part は、解決できていれば描画できる。描画を止めるか、警告だけにするかは UI 挙動の文書で定める。
- 非対応の Part は 1 枚も描画しない（§6.5）。
- `hides` は、その Part が**実際に描画されるときだけ**適用する。非対応などで描画されない Part の `hides` は効かない。
- `hides` は Slot 単位で、その Slot の全 Layer を非表示にする。形に合わせた切り抜きは v1 では行わない（§14）。

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
- 読み込み側は展開前に、展開後合計サイズ・ファイル数・画像の縦横 px を検査する（MUST）。上限の目安は合計 100MB、500 ファイル、画像 1 枚はマスターキャンバス以下【実素材で再検証】。
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
  "canvas": [1600, 2400],
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

`format` / `formatVersion` / `id` / `version` / `kind` / `name` / `author` / `category` / `canvas` / `license` / `layers`（1 個以上）。Body 以外は `compatible.body` も必須。Body は `views` と `anchors` も必須。

- `formatVersion` が実装の対応範囲より新しい場合は読み込みを拒否する（MUST）。
- 未知のフィールドは無視し、エラーにしない（MUST）。将来拡張のため。ただし `channels` のキーは例外で、`r` / `g` / `b` 以外は不正とする（§5.2）。
- `license` の各真偽値は作者の自己申告である。`redistributable: false` の Part は `.imchar`（素材同梱キャラクター）に含めない（MUST NOT）。

## 12. 検証項目（読み込み時）

1. ZIP の安全性（§10：パス、サイズ、拡張子）。
2. manifest の必須フィールドと ID 書式（§3、§11.1）。`canvas` がマスターキャンバスと一致する（§4.1）。
3. `slot` が §6.1 に存在し、`category` が §2 に存在する。
4. `channels` のキーが `r` / `g` / `b` だけで、宣言済みの ColorSlot を指す。`mask` と `masks` が同時に書かれていない（§5.2）。Mask と Asset のサイズが一致する。
5. `when` の重複がない（§6.5「重複の禁止」、§6.6 の T7・T8・T10）。
6. SVG のサニタイズ（§4.4）。
7. 同じ ID の Part が既にある場合は `version` を比較し、上書き前にユーザーへ確認する。

8. `when.pose` が、その Layer の領域の Pose Definition にある（§6.2）。
9. `when.fit` の次元と値が、対応する素体のいずれかの `fitDimensions` にある（§6.5）。素体が読み込まれてから検証する。

警告（SHOULD 違反）：ColorSlot の `name` がない、腕領域の Layer が `pose` を省略している、`when.body` が `compatible.body` にない、未読み込みの素体があって `when.fit` を判定できない、参照されないファイルがある。

## 13. 適合性

実装が本書に適合しているかは、2 つの水準に分けて判定する。規格そのものをブラウザの都合で曖昧にしないためである。

### 13.1 Core 適合（厳密一致）

画像の復号と描画を含まない、純粋な計算の適合性。**結果は参照結果と完全に一致しなければならない**（MUST）。

| 対象 | 入力 | 出力 | 参照 |
| --- | --- | --- | --- |
| manifest 検証 | manifest | 受理 / 拒否 | §12 |
| Asset 解決 | Layer と Context | 選ばれる Asset / 未解決 / manifest 不正 | §6.6、`tests/conformance/fixtures/resolve/` |
| 描画計画 | 装備中の Part と Context | 描画順、不足・非対応・競合、`hides` | §6.1、§6.2、§8 |
| 色計算 | 非プリマルチプライ 8bit RGBA の画素と Mask の画素、スロットの色とモード | 8bit RGBA の画素 | §5.3、`tests/conformance/fixtures/color/` |

色計算の入力は「復号済みの画素値」である。同じ画素値を与えれば、どの実装も 1 段の違いもなく同じ値を返す。

### 13.2 Renderer 適合（許容差つき）

PNG の復号から最終画像までを含む、描画全体の適合性。ブラウザの Canvas 2D は内部でアルファを乗算して 8bit で保持するため、半透明画素の RGB は元の値に戻らない。したがって Renderer には許容差を認める。

参照結果は、PNG を非プリマルチプライのまま復号し、13.1 の色計算と通常合成（source-over）を浮動小数で行って 8bit に丸めたものとする。

- **不透明な画素（参照結果のアルファが 255）**：RGB の各値が参照結果と ±2 以内（MUST）。
- **半透明な画素**：アルファを乗算した値（`RGB × A / 255`）とアルファが、参照結果と ±2 以内（MUST）。非プリマルチプライの RGB そのものは比較しない。

Phase 0 の実測（Chrome 154、Canvas 2D、仮素材 1600×2400）では、不透明画素の差は最大 2、アルファを乗算した値の差は半透明の画素を含めて最大 2、非プリマルチプライ RGB の差は半透明の縁で最大 48 だった。許容差の値は正式素材で再検証する（§14）。

PNG を自前で復号して非プリマルチプライのまま処理する Renderer は、参照結果と完全に一致させることができる（MAY）。

## 14. 決定事項と残課題

草案 0.2 の「未確定事項」9 件を、Phase 0 の検証結果に基づいて整理した。

### 14.1 確定事項

| 項目 | 決定 | 該当節 |
| --- | --- | --- |
| マスターキャンバス | 1600 × 2400 px。Part は `canvas` で宣言する | §4.1 |
| トリミング | 公式素材は MUST、ユーザー素材は SHOULD | §4.2 |
| Mask のチャンネル | RGB の 3 スロット。A は使用しない。4 スロット以上は `masks` | §4.3、§5.2 |
| `tint` の基準下地 | 50% グレー（#808080）、境界 `p = 128/255`。丸めと `Σw > 1` の扱いを規定 | §5.3 |
| 標準描画順 | §6.1 の表。眉は前髪の後ろが標準で、前に出す素材は `face.eyebrows.over`。靴は `outfit.shoes` と `outfit.shoes.over` の 2 Slot | §6.1 |
| Pose Definition | 腕グループの置き場所と順序を共通定義として持つ | §6.2 |
| 曖昧な記述の扱い | 解釈で補わず拒否する（`mask` と `masks` の併記、`channels` の未知のキー、Pose Definition にないポーズ、どの素体にもない fit） | §0、§5.2、§6.2、§6.5 |
| 適合性 | Core は厳密一致、Renderer は許容差つき | §13 |

### 14.2 v1 で保留する事項

| 項目 | v1 での扱い | 再開の条件 |
| --- | --- | --- |
| 帽子と髪の干渉 | `hides`（Slot 単位の非表示）のみ。髪を帽子の形で切り抜く仕組みは持たない | 実際の画風で、帽子から髪がはみ出す問題が顕在化したら v1.x で検討 |
| ITEM の装着仕様 | `when.attach`、`item.*` の Slot、手の anchors を予約するだけ | v1.x で詳細化 |
| `mirrorable` による反転 | 規定（§6.5 手順 3）はあるが、公式実装は未対応でよい | 正面以外の VIEW を実装するとき |
| SVG Asset | 規定（§4.4）はあるが、公式実装は未対応でよい | 需要が確認できたとき |
| 機能互換性（Capability）の宣言 | 持たない。実装が知らないポーズを使う素材は「manifest 不正」として拒否される（§6.2） | Phase 1 の最初に検討する。`formatVersion` は manifest の構造・意味論が変わったときだけ上げ、ポーズ・Slot・fit 次元・合成方式・VIEW などの追加は、素材が必要な機能を宣言する仕組みで扱う。知らない機能を要求された実装は「不正」ではなく「新しい InvestiMaker が必要」と表示できるようにする |
| 検証結果の 3 状態 | 素体が未読み込みで `when.fit` を判定できないときは警告にとどめる（§6.5） | Phase 1 で、検証結果を「有効 / 不正 / 未確定」の 3 状態として持つ。`.impart` 単体の検証では未確定とし、必要な素体を読み込んだ後に再検証して確定する。未確定の素材をそのまま通常利用できる状態にはしない |
| WebGL での Mask 読み出し | 未検証。A チャンネルを使わない決定には影響しない | 色変更を GPU に移すとき |

### 14.3 正式素材制作時に再検証する事項

| 項目 | 現在の値 | 確かめること |
| --- | --- | --- |
| 出力画質 | 1600 × 2400 | 実際の画風で描いた素材を、セッションツール上で確認する |
| スマホでの性能 | PC で初回合成 120 ms、色変更 22〜36 ms、メモリ見積もり 55 MB（仮素材 27 Layer） | Phase 1 の性能試験として実機で計測し、最適化の要否を判断する |
| `tint` の下地の描き方 | 規格は 50% グレー基準のみを定める | 暗色で線画が塗りに埋もれる、黒でハイライトが強すぎる、白でハイライトが消える。下地の推奨レンジ（影とハイライトの深さ）と線画色の方針を **Authoring Guide** で定める |
| 表情の標準状態名と標準表情 | §6.3 | 画風決定後に過不足を見直す |
| `fitDimensions` | `chest` のみ | 素体の種類と合わせて決める。fit 非依存と宣言した外衣が、fit 違いの内側を覆えるかを素材ごとに確認する |
| パッケージ上限 | 100 MB / 500 ファイル | 実素材のサイズ感。VIEW とポーズが増えた衣装 1 着のファイル数 |
| Renderer の許容差 | ±2 | 正式素材と複数のブラウザで実測する |
| 頭部まわりの重なり | §6.1 | 横髪と耳、襟と首、後ろ身頃と後髪は仮素材になく未検証 |

## 15. 草案 0.2 からの変更

検証レポートの変更提案 P1〜P16 を反映した。P6・P7、P13、P16 は提案から内容を変えている。

| 提案 | 反映先 | 内容 |
| --- | --- | --- |
| P1 | §5.3 | `tint` の境界を 0.5 から `p = 128/255` に変更 |
| P2 | §5.3 | 8bit への丸めを四捨五入（0.5 は切り上げ）と規定 |
| P3 | §4.3、§5.3 | `Σw > 1` は比例配分で 1 に収める |
| P4 | §6.5、§6.6 | `when.state` の照合先を category で規定。T12 に注記 |
| P5 | §6.5、§12 | Context に値がないキーは一致しない。**対応するどの素体にもない fit の次元・値は不正として拒否**（提案は警告） |
| P6・P7 | §1、§6.1、§6.2、§12 | **Pose Definition を正式に追加**（提案は「定義の置き場所を決める」まで）。`placement` と `order` を持つ共通定義で、素材は定義しない。**Pose Definition にないポーズを `when.pose` に書いた manifest は不正として拒否** |
| P8 | §6.3 | 標準表情 6 種の状態の組を表にした |
| P9 | §6.5、§8 | 素体が `compatible.body` にない Part は非対応 |
| P10 | §8 | 条件の判定対象、競合になる側、競合の Part の描画を規定 |
| P11 | §8 | `hides` は描画される Part のものだけ適用 |
| P12 | §3 | Part ID はちょうど 2 セグメント |
| P13 | §13 | **Core 適合（厳密一致）と Renderer 適合（許容差つき）に分離**（提案は一律の許容差） |
| P14 | §4.1、§11.1、§12 | `canvas` を必須フィールドに追加 |
| P15 | §4.2、§5.1 | `offset` は 0 以上の整数で省略時 `[0, 0]`。`colorSlots` は省略可 |
| P16 | §0、§5.2、§12 | **`mask` と `masks` の併記、`channels` の `r` / `g` / `b` 以外のキーは不正として拒否**（提案は合算と警告） |

提案以外の変更：

- §4.2：トリミングを、公式素材では MUST に引き上げた。
- §6.1：眉の標準位置を前髪の後ろに変更し、`face.eyebrows.over` を追加した。
- §13（旧）：未確定事項一覧を、§14 の確定事項・保留事項・再検証事項に置き換えた。【暫定】の表記は、再検証する項目を示す注記に置き換えた。
