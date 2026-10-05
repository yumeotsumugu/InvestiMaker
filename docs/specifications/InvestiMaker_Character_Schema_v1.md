# InvestiMaker Character Schema v1（RC1）

2026-10-05 / Phase 1-A の設計と、Phase 1-B（最小 UI）での実装と検証に基づく

草案からの経緯は §12、決定の根拠は `docs/reports/Phase1A_Verification_Report.md` と `docs/reports/Phase1B_Verification_Report.md` にある。

この文書は、InvestiMaker で作ったキャラクター 1 体を保存する形式を定める。素材（Part）の規格は `InvestiMaker_Asset_Specification_v1.md`（以下「Asset 仕様」）が定め、本書はそれを参照する。

確定した事項と残る課題は §11 にまとめる。

---

## 0. 規定の強度と基本方針

MUST / SHOULD / MAY の意味は Asset 仕様 §0 と同じである。

- **正本は State と Equipment である。** そこから導出できる情報（`requirements`）は正本ではない。
- **Part の manifest がなくても、Character は読み書きできなければならない**（MUST）。読み込みは manifest を参照しない。
- **読み込んだ情報を、解釈できないという理由で捨ててはならない**（MUST NOT）。読み込まれていない Part の Instance、Part が宣言していないスロットの色、未知のフィールドはすべて保持して書き戻す。
- 曖昧な記述を実装側が解釈して補わない点は Asset 仕様と同じである。構造が仕様に合わない Character は不正として拒否する。

## 1. 用語

| 用語 | 定義 |
| --- | --- |
| **Character** | 保存の単位。キャラクター 1 体。 |
| **Equipment Instance** | 「このキャラクターがその Part をどう使っているか」。Part ID への参照と、色・配置補正などの設定を持つ。 |
| **装備中 / 外している** | Instance の `equipped` が `true` / `false`。外していても Instance と設定は残る。 |
| **環境** | 読み込み時に利用できるもの。読み込み済みの Part、実装が知っている Pose Definition と VIEW。 |
| **Requirements** | このキャラクターを完全に再現するために環境側に必要なものの一覧。 |

## 2. 全体構造

```json
{
  "format": "INVESTIMAKER_CHARACTER",
  "formatVersion": 1,
  "id": "0f6f2a3e-6c1d-4b8e-9a51-2f7d3c4b5a60",
  "name": "夢生ツムグ",
  "canvas": [1600, 2400],
  "appearance": {
    "body": "00000000-0000-4000-8000-000000000020",
    "fit": { "chest": "medium" }
  },
  "sharedColors": {
    "skin.base": "#F2D3BD",
    "hair.base": "#202028",
    "eyes.left": "#405070",
    "eyes.right": "#405070"
  },
  "equipment": [
    { "instanceId": "00000000-0000-4000-8000-000000000020", "partId": "im.body_01", "equipped": true, "colors": {} },
    {
      "instanceId": "00000000-0000-4000-8000-000000000021",
      "partId": "author.special_coat",
      "equipped": true,
      "colors": { "main": { "color": "#7A1F2B" }, "lapel": { "color": "#101014" } },
      "transform": { "x": 4, "y": -12 }
    },
    {
      "instanceId": "00000000-0000-4000-8000-000000000022",
      "partId": "im.hair_01",
      "equipped": true,
      "colors": { "base": { "linked": false, "color": "#5A3E2B" } }
    }
  ],
  "state": {
    "view": "front",
    "pose": { "torso": "stand", "arm.left": "down", "arm.right": "down" },
    "expression": { "eyes": "smile", "eyebrows": "relaxed", "mouth": "smile_open" }
  },
  "composition": {},
  "requirements": {
    "parts": ["author.special_coat", "im.body_01", "im.hair_01"],
    "view": ["front"],
    "pose": { "arm.left": ["down"], "arm.right": ["down"], "torso": ["stand"] },
    "fit": { "chest": ["medium"] },
    "state": { "eyebrows": ["relaxed"], "eyes": ["smile"], "mouth": ["smile_open"] }
  }
}
```

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `format` | MUST | `"INVESTIMAKER_CHARACTER"` |
| `formatVersion` | MUST | `1`（§9） |
| `id` | MUST | キャラクターの識別子。UUID（§3） |
| `name` | MUST | 表示名。200 文字以内。空文字列でもよい |
| `canvas` | MUST | 座標系の基準になるキャンバスサイズ。v1 は `[1600, 2400]` だけ（§2.1） |
| `appearance` | MUST | 素体への参照と fit（§4） |
| `sharedColors` | MUST | 共有カラー（§6）。空でもよい |
| `equipment` | MUST | Equipment Instance の配列（§5）。並びが装備順の正本 |
| `state` | MUST | VIEW / POSE / EXPRESSION（§7） |
| `composition` | MAY | 予約。v1 は中身を解釈せず保持する |
| `requirements` | MAY | 導出できるキャッシュ（§8） |

文字コードは UTF-8（BOM なし）とする。キーの順序と空白に意味はない。

### 2.1 canvas

- Character は、座標系の基準にしたキャンバスサイズを `canvas: [1600, 2400]` として宣言する（MUST）。配置補正（`transform`）の値は画素であり、キャンバスが決まらないと意味が定まらないためである。
- **v1 では `[1600, 2400]` 以外の Character は不正とする**（MUST）。Asset 仕様 §4.1 のマスターキャンバスと同じ値である。
- 将来キャンバスの規格を変える場合は、保存データの移行（migration）で扱う。

## 3. ID

- `id` と `instanceId` は UUID とし、`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` の形で小文字の 16 進数で書く（MUST）。
- 新しく作るときは UUID v4（乱数）を使う（SHOULD）。識別子に時系列の意味は持たせない。読み込み側は UUID のバージョンを検査しない（MUST NOT）。意味は「一意な識別子」であることだけである。
- `instanceId` はキャラクター内で一意（MUST）。重複する Character は不正とする。
- `partId` は Asset 仕様 §3 の Part ID（`<namespace>.<name>`）。
- ポーズ・VIEW・状態名・fit の次元と値・共有カラーキー・スロット ID は、Asset 仕様 §3 の ID 書式（`[a-z0-9_]` のセグメントを `.` で連結）に従う（MUST）。**値が既知かどうかは構造の検証では問わない**（§10）。

## 4. appearance

```json
"appearance": { "body": "<素体の instanceId>", "fit": { "chest": "medium" } }
```

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `body` | MUST | 素体の Equipment Instance の `instanceId` |
| `fit` | MAY | fit の次元 → 値。省略時は空（どの次元も指定しない） |

- `body` は `equipment` にある Instance を指し、その Instance は `equipped: true` でなければならない（MUST）。そうでない Character は不正とする。
- 素体は Part の一種なので、色や配置補正は他の Part と同じく Equipment Instance に持つ。`appearance.body` は「どの Instance が素体か」を示すだけである。
- 素体を manifest なしで特定できるようにするため、Part の `kind` には頼らず、Character 側に明示的な参照を持つ。
- `fit` に書いていない次元は、Asset 解決の Context に値がないものとして扱う（Asset 仕様 §6.5。その次元を `when.fit` に指定した Asset は一致しない）。

顔・髪などの APPEARANCE 軸の Part も、すべて `equipment` に Instance として持つ。`appearance` に Part の一覧は置かない。

## 5. Equipment Instance

```json
{
  "instanceId": "00000000-0000-4000-8000-000000000021",
  "partId": "author.special_coat",
  "equipped": true,
  "colors": { "main": { "color": "#7A1F2B" }, "lining": { "linked": false, "color": "#C8A85A" } },
  "transform": { "x": 4, "y": -12, "scaleX": 1.02, "scaleY": 1.02, "rotation": 1.5, "pivot": [800, 900] },
  "overrides": {}
}
```

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `instanceId` | MUST | UUID。キャラクター内で一意 |
| `partId` | MUST | Part ID |
| `equipped` | MUST | 装備中なら `true`、外しているなら `false` |
| `colors` | MAY | スロット ID → 色の指定（§6）。省略時は空 |
| `transform` | MAY | 条件によらない基本の配置補正（§5.5）。`x` / `y` / `scaleX` / `scaleY` / `rotation` は数値、`pivot` は `[x, y]` |
| `overrides` | MAY | 状態ごとの上書き（§5.5）。`transform` 以外のキーは予約で、中身を解釈せず保持する |

### 5.1 装備順

- **`equipment` の並びが装備順の正本である**（MUST）。Asset 仕様 §6.1 の「同値なら装備順で描く」は、この並びの先頭側を奥として適用する。
- 外している Instance も並びの中に位置を持つ。
- **外した Part を付け直すときは、同じ Instance を再利用し、`equipment` の中の位置も変えない**（MUST）。「外す」は削除ではなく、色や配置補正と同じく装備順も覚えておく対象だからである。
- 手前に装備し直したい場合は、並びを変えるか、Instance を削除して新しく装備する。
- 並び替えは `equipment` の並びを変えることで表す。

### 5.2 同じ Part の複数装備

- 同じ `partId` を持つ Instance を複数置ける（MAY）。それぞれが別の色・配置補正を持つ。
- 1 つの category に装備できる Part の数（Asset 仕様 §2）は、Part の manifest がないと分からない。**category の重複は Character を不正にしない**（MUST NOT）。
- 1 Part だけ装備できる category に複数の Part が装備されている場合、実装は**どちらも無効にせず、両方を描画し、注意として知らせる**（MUST）。読み込み時に片方を外すなど、環境に依存する判定で Character の意味を変えてはならない。
- 通常の操作で重複装備が起きないようにするのは UI の役割である。外部で編集された JSON などで重複が生じた場合も、データは保持する。

### 5.3 外している Instance

- `equipped: false` の Instance は描画されず、Requirements にも入らない。色などの設定は保持する。
- 外すことと、Instance を削除することは別の操作である。削除すると設定は失われる。
- 外している Instance の数に上限は設けない。通常の付け外しでは同じ Instance が再利用されるので増えない。不要になった Instance は削除する。
- 素体の Instance は外せず、削除もできない（§4）。

### 5.4 読み込まれていない Part

- Instance の内容は、Part の manifest に依存しない。Part が読み込まれていなくても、Instance は**そのままの内容で**読み込み、保存しなければならない（MUST）。
- 読み込まれていない Part は、描画計画の上で「不足」になる（Asset 仕様 §8）。他の Part の描画は妨げない。
- 後から Part を読み込めば、同じ `instanceId` の Instance がそのまま使われる。

### 5.5 配置補正

```json
"transform": { "x": 10, "y": -20 },
"overrides": {
  "transform": [
    { "when": { "pose": { "arm.right": "pocket" } }, "transform": { "x": 30 } },
    { "when": { "view": "front", "pose": { "arm.left": "down", "arm.right": "pocket" } }, "transform": { "x": 50, "rotation": 5 } }
  ]
}
```

**基本の補正**（`transform`）

- 条件によらず使う配置補正。適用順は「`pivot` を中心に拡大縮小 → 回転（度、時計回り）→ 平行移動」、`pivot` 省略時はキャンバス中央である（Asset 仕様 §9）。
- Part 既定の補正に対する**差分**として合成する。合成の計算は Asset 仕様 §9 が定める（位置と回転は加算、拡大縮小は乗算、`pivot` は Instance 側を優先）。

**条件ごとの補正**（`overrides.transform`）

特定の VIEW やポーズのときだけ使う補正を、配列で持つ。

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `when` | MUST | 適用する条件。`view`（VIEW ID）と `pose`（領域 → 状態）を書ける。少なくとも 1 つのキーを書く |
| `transform` | MUST | その条件のときに使う配置補正 |

- **条件は、書いたキーだけを照合する。** 書かないキーには依存しない（Asset 仕様 §6.4 の `when` と同じ考え方）。`pose` は領域ごとに 1 つのキーと数える。3 領域すべてを書く必要はない。
- **現在の状態に当てはまる補正のうち、条件のキーの数が最も多いものを使う**（MUST）。キーの数は「`view` があれば 1」＋「`pose` に書いた領域の数」。
- **当てはまる補正があるとき、それは基本の `transform` を置き換える**（MUST）。値を混ぜない。その補正に書いていない項目は「補正なし」（位置 0、拡大率 1、回転 0）であり、基本の `transform` から引き継がない。その状態でどう配置するかが、1 件を見れば確定するようにするためである。後から基本の `transform` を変えても、調整済みの状態はずれない。
- Part 既定の補正との合成（Asset 仕様 §9）は、置き換えた後の補正に対して行う。
- 当てはまる補正がなければ、基本の `transform` を使う。それもなければ補正なし。
- **どちらを使うか決まらない組み合わせは不正とする**（MUST NOT）。条件のキーの数が等しい 2 つの補正が、同じ状態に同時に当てはまりうる場合、その Character は不正である。「同時に当てはまりうる」とは、両方が書いているすべてのキーで値が一致する（または共通のキーがない）ことをいう。これは JSON だけで判定でき、読み込み時に拒否するので、**ある状態に適用される補正は必ず 1 つに決まる**。配列の並び順は結果に影響しない。
- `when` に `view` と `pose` 以外のキーを書いた Character は不正とする（MUST NOT）。知らないキーを無視すると、「笑顔のときだけ」が「常に」になるように、条件の意味が変わってしまうためである。未知のフィールドを保持する原則（§9）は、意味を決める条件式である `when` には適用しない。条件に使えるキーを増やすときは、Capability または `formatVersion` との関係をその時点で定める。
- `when` の値が、実装の知らない VIEW やポーズであってもよい。その条件は単に当てはまらない。
- 読み込まれていない Part の Instance が持つ補正も、そのまま保持する（§5.4）。

例の場合：右腕が `pocket` で左腕が `down`、VIEW が `front` なら 2 つ目（キー 3 つ）を使う。右腕が `pocket` で左腕が別の状態なら 1 つ目（キー 1 つ）を使い、結果は `x: 30, y: 0` である（`x: 40` でも `y: -20` でもない）。右腕が `down` なら基本の `{ "x": 10, "y": -20 }` を使う。

UI は、ある条件の補正を初めて作るときに、基本の `transform` の値を写して始めるとよい（SHOULD）。作った瞬間に見た目が変わらないようにするためである。

## 6. 色

### 6.1 共有カラー

```json
"sharedColors": { "skin.base": "#F2D3BD", "hair.base": "#202028" }
```

- キーは共有カラーキー（Asset 仕様 §5.4）、値は `#RRGGBB`。
- 実装が知らないキーも保持する（MUST）。Asset 仕様にキーが追加されたとき、古い実装で保存し直しても失われないようにするため。
- キーがない共有色を参照するスロットは、Part の `default` を使う（Asset 仕様 §5.4）。

### 6.2 Instance の色

```json
"colors": {
  "main":  { "color": "#7A1F2B" },
  "skin":  { "linked": false, "color": "#C68642" },
  "base":  { "linked": true,  "color": "#5A3E2B" }
}
```

スロット ID ごとに次の 2 つを持つ。どちらも省略できる。

| フィールド | 内容 |
| --- | --- |
| `linked` | 共有色に従うか。省略時は `true`。Part の ColorSlot が `link` を持たないときは意味を持たない |
| `color` | 個別色 `#RRGGBB` |

表示する色は次の順で決める（MUST）。

1. Part の ColorSlot が `link` を持ち、`linked` が `false` でない → 共有色。その共有色がなければ ColorSlot の `default`。
2. それ以外 → `color`。なければ ColorSlot の `default`。

- **リンク中でも `color` は保持する。** リンクを戻しても個別色は消えない。
- **リンクを解除する操作は、その時点で表示されている色を `color` にコピーする**（MUST）。解除した瞬間に見た目が変わらないようにするため。それまで保持していた個別色は上書きされる。
- Part が宣言していないスロット ID の指定も保持する（MUST）。Part の更新でスロットが減った場合や、Part が読み込まれていない場合に失われないようにするため。
- 色は大文字に正規化して保存する（SHOULD）。読み込みは大文字・小文字のどちらも受け付ける（MUST）。

## 7. state

```json
"state": {
  "view": "front",
  "pose": { "torso": "stand", "arm.left": "down", "arm.right": "down" },
  "expression": { "eyes": "open", "eyebrows": "neutral", "mouth": "closed" }
}
```

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `view` | MUST | VIEW ID（Asset 仕様 §3.1） |
| `pose` | MUST | 領域 → 状態。`torso` / `arm.left` / `arm.right` は必須。Pose Definition の `(region, id)` に対応する（Asset 仕様 §6.2） |
| `expression` | MUST | `eyes` / `eyebrows` / `mouth` の状態名（Asset 仕様 §6.3） |

- **ポーズは領域ごとに保存する。** 名前付きポーズ（腕組み等）は保存しない。左右の腕は独立している。
- **表情は顔の状態そのものを保存する。** `smile` などの名前付き表情は保存しない。状態の組が標準表情に一致するかどうかは、読み込み側が照合して求める。互換性の条件（Asset 仕様 §8 の `path: "expression"`）も、その照合結果を使う。
- 名前付きのポーズと表情は、状態の組を一括で設定する操作（プリセット）として UI 側で扱う。

## 8. requirements

このキャラクターを完全に再現するために環境側に必要なものの一覧である。語彙は Asset 仕様と共通にする。

| フィールド | 内容 | 導出元 |
| --- | --- | --- |
| `parts` | 装備中の Part ID。重複なし、昇順 | `equipment` のうち `equipped: true` |
| `view` | VIEW ID | `state.view` |
| `pose` | 領域 → 状態の配列 | `state.pose` |
| `fit` | 次元 → 値の配列 | `appearance.fit` |
| `state` | `eyes` / `eyebrows` / `mouth` → 状態名の配列 | `state.expression` |

値を配列にしているのは、将来 1 つの保存データが複数の状態（差分）を持つようになったときに、同じ形で書けるようにするためである。

**`requirements` は導出できるキャッシュであり、正本ではない。**

- 書き出すときは、必ず現在の State と Equipment から作り直す（MUST）。
- 読み込むときは、意味の決定に使ってはならない（MUST NOT）。内容が現在の State と Equipment に一致しなくても、形が崩れていても、Character を不正としない。一致しないことを知らせてよい（MAY）。
- 省略してよい（MAY）。
- 用途は、Character を開かずに「何が必要か」を一覧できるようにすることである（ファイルを配る前の確認、不足 Part の案内など）。

外している Instance の Part は `parts` に入れない。Requirements は「完全に再現するために必要なもの」であり、外している Part はそれに当たらない。素材を同梱する形式（`.imchar`）で必要になる一覧は、別の概念として扱う。

正式な Capability の仕様（必要な InvestiMaker のバージョンの表現など）は本書では定めない。

## 9. 前方互換性

- `formatVersion` が実装の対応範囲より新しい Character は、読み込みを拒否する（MUST）。中身は解釈しない。
- **未知のフィールドは無視せず、保持する**（MUST）。全階層（トップレベル、`appearance`、`state`、Equipment Instance、色の指定）で、読み込んだ値をそのまま書き戻す。古い実装で開いて保存しただけで、新しい実装が書いた情報が消えることを防ぐためである。
- v1 のまま追加できるのは、**追加されても既存の意味が変わらない任意フィールド**に限る。必須フィールドの追加、既存フィールドの意味の変更、既定値の変更は `formatVersion` を上げる。
- **`formatVersion` の不一致と、機能の不足は別のものとして扱う。**
  - `formatVersion` が新しい → Character は読めない（INVALID、理由は `format-version-unsupported`）。
  - 実装が知らないポーズ・VIEW、環境にない Part・fit → Character は読める（UNRESOLVED）。

## 10. 検証と 3 状態

Character の状態は次の 3 つのいずれかである。

| 状態 | 意味 | 何で決まるか |
| --- | --- | --- |
| **INVALID** | Character JSON そのものが仕様違反 | **JSON だけ**。環境には左右されない |
| **UNRESOLVED** | JSON は正しいが、必要なものを環境が提供できない | JSON と環境 |
| **VALID** | JSON が正しく、必要なものが環境に揃っている | JSON と環境 |

**環境に依存する判定は、決して INVALID を生まない**（MUST）。同じ JSON が、読み込む順序や Part の有無によって INVALID になったり VALID になったりしてはならない。読み込まれていない Part は UNRESOLVED の原因であって、INVALID の原因ではない。

### 10.1 INVALID になる条件

- JSON として読めない、またはオブジェクトでない。
- §2〜§7 の必須フィールドがない、型や書式が合わない。
- `formatVersion` が実装の対応範囲より新しい。
- `canvas` が `[1600, 2400]` でない。
- `instanceId` が重複している。
- 条件ごとの配置補正に、どちらを使うか決まらない組み合わせがある、条件が空である、または `when` に知らないキーがある（§5.5）。
- `appearance.body` が `equipment` にない Instance を指している、またはその Instance が `equipped: false` である。

`schemas/character.schema.json` は、このうち構造の部分を表す。`instanceId` の重複、`appearance.body` の参照先、条件ごとの配置補正の重複は JSON Schema では表せないため、実装の検証器が確かめる。

### 10.2 UNRESOLVED になる条件

Requirements のうち、環境が満たせないものがあるとき。

| 原因 | 内容 |
| --- | --- |
| Part の不足 | 装備中の Instance の Part が読み込まれていない |
| 未知の VIEW | 実装が知らない VIEW ID |
| 未知のポーズ | 実装の Pose Definition にない `(region, id)` |
| 素体にない fit | 素体の `fitDimensions` にない次元・値（素体が読み込まれているときだけ判定する） |
| 素体の種別 | `appearance.body` が指す Part が読み込まれているが、Body ではない |

UNRESOLVED の Character も、読み込み・編集・保存ができる（MUST）。描画できる部分は描画してよいが、実装が知らないポーズを含む場合は描画順を決められないので描画しない。

### 10.2.1 画像の書き出し

UNRESOLVED の Character の画像を書き出せるかどうかは、次のとおりとする（MUST）。

- **描画できる UNRESOLVED**（Part の不足、素体にない fit、知らない VIEW）：注意を表示したうえで、書き出せる。不足している Part が描かれないだけで、他は通常どおり描画する。
- **描画の意味が決まらない UNRESOLVED**（実装が知らないポーズ）：書き出せない。腕グループの置き場所と順序が決まらないためである。

加えて、**描画される Layer が 1 枚もないときは書き出せない**（MUST）。これは書き出しの事前条件であり、Character の状態（VALID / UNRESOLVED）は変えない。素材のない VIEW を選んで全 Part が非対応になった場合などがこれに当たる。プレビューは空でよい。

### 10.3 状態に影響しない注意

次は VALID のまま、注意として知らせる。

- 外している Instance の Part が読み込まれていない。
- Part が宣言していないスロットの色を持っている（保持する）。
- 1 Part だけ装備できる category に、複数の Part を装備している（§5.2。両方描画する）。
- 保存されていた `requirements` が現在の内容と一致しない、または形が崩れている。

### 10.4 描画時の状態との関係

Asset 仕様 §8 の「不足 / 非対応 / 競合」は Part ごとの描画時の状態であり、本書の 3 状態とは別の軸である。Part が非対応や競合であっても、Character は VALID でありうる（例：右腕が `pocket` のとき、`pocket` の袖を持たないコートは非対応になるが、Character に問題はない）。

## 11. 決定事項と残課題

### 11.1 確定事項

| 項目 | 決定 | 該当節 |
| --- | --- | --- |
| 装備の持ち方 | 順序付きの Equipment Instance 配列が正本。素体も Instance で、`appearance.body` が指す | §4、§5 |
| キャンバスサイズの宣言 | `canvas` をトップレベルの必須フィールドにする。v1 は `[1600, 2400]` 以外を不正とする | §2.1 |
| 付け直したときの装備順 | 同じ Instance を再利用し、`equipment` の中の位置を変えない | §5.1 |
| category の重複 | 不正にしない。両方を描画し、注意として知らせる。環境に依存する判定で Character の意味を変えない | §5.2 |
| 条件ごとの配置補正の形 | `overrides.transform` に `{ when, transform }` の配列。条件は `view` と `pose` の領域ごとの状態で、書いたキーだけを照合する | §5.5 |
| 条件ごとの補正の意味 | 基本の `transform` を**置き換える**（差分ではない） | §5.5 |
| 補正の選び方 | 当てはまるうち、条件のキーの数が最も多いもの。数が同じで同時に当てはまりうる組は不正。Asset 仕様の具体度とは揃えない | §5.5 |
| `when` の知らないキー | 不正として拒否する | §5.5 |
| 色 | Instance ごとに `{ linked?, color? }`。リンク中も個別色を保持し、解除時は表示色を写す | §6 |
| 表情とポーズ | 顔の状態と、領域ごとのポーズを保存する。名前付きの表情・ポーズは保存しない | §7 |
| `requirements` | 導出できるキャッシュ。`parts` は装備中の Part だけ | §8 |
| UUID | v4 を推奨。Schema はバージョンを固定しない | §3 |
| 外している Instance の上限 | 設けない。完全な削除は UI が提供する | §5.3 |
| 未知のフィールド | 保持する（`when` を除く） | §9 |
| 3 状態の境界 | INVALID は JSON だけで決まる。環境に依存する判定は UNRESOLVED か注意にしかならない | §10 |
| 画像の書き出し | 描画できる UNRESOLVED は注意つきで可。知らないポーズでは不可。描画される Layer が 0 枚なら不可 | §10.2.1 |

### 11.2 Phase 1-C 以降で確かめる事項

本書の規定は変えずに、UI と実測で扱う。

| 項目 | 現在の扱い | 確かめること |
| --- | --- | --- |
| `pivot` の使い勝手 | 既定値はキャンバス中央（Asset 仕様 §9）のまま | 帽子やメガネの拡大・回転では、Part の位置を軸にしたい。UI が Part の見た目の中心を最初の `pivot` として設定する、`pivot` を直接編集できるようにする、などを検討する |
| 配置補正のある描画の許容差 | 定めていない（Asset 仕様 §13.2 の許容差は補正のない描画の実測値） | ブラウザと参照実装で補間の方法が違う。複数のブラウザで実測してから決める |
| 正面以外の VIEW での補正 | `when.view` は値の照合だけを確かめた | 素材ができてから、実際の絵で確かめる |

### 11.3 後のフェーズへ持ち越す事項

| 項目 | 現在の扱い | 再開の条件 |
| --- | --- | --- |
| Capability の正式な表現 | 定義しない。`requirements` の語彙だけ Asset 仕様と揃えてある | Asset 仕様 §14.2 と合わせて決める |
| 未知のポーズの扱いの非対称 | Character では UNRESOLVED、Part の manifest では不正（Asset 仕様 §6.2） | Capability を正式化するときにまとめて解決する |
| VARIANT・OUTFIT の継承 | 定義しない。`state` は 1 組だけ | 複数の差分を 1 ファイルに持つ形を決めるとき |
| `composition` | 予約のみ | COMPOSITION / PORTRAIT の仕様 |
| キャンバス規格の変更 | v1 は 1600×2400 だけ | 変更するときは migration の対象にする |

## 12. 草案からの経緯

| 版 | 時期 | 内容 |
| --- | --- | --- |
| 草案 0.1 | Phase 1-A | 全体構造、Equipment Instance、色、state、requirements、3 状態を設計し、保存 → 読込の一致と不足 Part の保持を実装で確かめた |
| 草案 0.2 | Phase 1-A の決定 | `canvas` を必須にした。付け直したときの装備順、category の重複、UUID、`requirements.parts` の範囲を確定した |
| 草案 0.3 候補 | Phase 1-B | 予約だった `overrides` に、条件ごとの配置補正（`overrides.transform`）を定義した。最小 UI から一連の操作を通して検証した |
| RC1 | Phase 1-B の決定 | 条件ごとの補正の意味（置き換え）、選び方（キーの数が最大）、`when` の知らないキーの拒否を確定した。画像の書き出しの条件を正式にし、描画される Layer が 0 枚のときは書き出せないとした。Part 既定との合成の計算は Asset 仕様 §9 に移した |

草案 0.2 から RC1 までの間、全体構造・`canvas`・`appearance`・Equipment Instance の必須項目・色・`state`・`requirements`・前方互換性の方針・3 状態の境界は変えていない。
