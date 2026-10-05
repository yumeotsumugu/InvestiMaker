# InvestiMaker Character Schema v1（草案 0.2）

2026-10-05 / Phase 1-A の実装と検証、およびその後の決定に基づく

この文書は、InvestiMaker で作ったキャラクター 1 体を保存する形式を定める。素材（Part）の規格は `InvestiMaker_Asset_Specification_v1.md`（以下「Asset 仕様」）が定め、本書はそれを参照する。

草案 0.1 で判断待ちだった事項の決定と、Phase 1-B へ持ち越す事項は §11 にまとめる。本書を RC1 とするかどうかは、Phase 1-B で実際の UI から保存・読込を通した後に判定する。

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
| `transform` | MAY | Part 既定の配置補正に対する差分（Asset 仕様 §9）。`x` / `y` / `scaleX` / `scaleY` / `rotation` は数値、`pivot` は `[x, y]` |
| `overrides` | MAY | 予約。v1 は中身を解釈せず保持する |

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

- `transform` は装備インスタンスの値であり、Part 既定に対する差分として合成する（Asset 仕様 §9）。
- 本草案は、条件によらない 1 つの `transform` だけを定義する。VIEW やポーズごとの補正は `overrides` に予約し、**キーの構造は Transform を実装する Phase 1-B で確定する**（最小の単位は `view × ポーズ`。Asset 仕様 §9）。
- v1 の実装は `transform` を保存・復元するだけで、描画には適用しない（Asset 仕様側の Transform が未実装のため）。

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
- `appearance.body` が `equipment` にない Instance を指している、またはその Instance が `equipped: false` である。

`schemas/character.schema.json` は、このうち構造の部分を表す。`instanceId` の重複と `appearance.body` の参照先は JSON Schema では表せないため、実装の検証器が確かめる。

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

UNRESOLVED のまま画像を書き出せるかどうかは UI 挙動の文書で定める。方向性は「描画できる状態なら、警告つきで書き出せる」である（Part が 1 つ不足しているだけで、キャラクター全体の書き出しを止めない）。

### 10.3 状態に影響しない注意

次は VALID のまま、注意として知らせる。

- 外している Instance の Part が読み込まれていない。
- Part が宣言していないスロットの色を持っている（保持する）。
- 1 Part だけ装備できる category に、複数の Part を装備している（§5.2。両方描画する）。
- 保存されていた `requirements` が現在の内容と一致しない、または形が崩れている。

### 10.4 描画時の状態との関係

Asset 仕様 §8 の「不足 / 非対応 / 競合」は Part ごとの描画時の状態であり、本書の 3 状態とは別の軸である。Part が非対応や競合であっても、Character は VALID でありうる（例：右腕が `pocket` のとき、`pocket` の袖を持たないコートは非対応になるが、Character に問題はない）。

## 11. 決定事項と残課題

### 11.1 草案 0.2 で決定した事項

| 項目 | 決定 | 該当節 |
| --- | --- | --- |
| キャンバスサイズの宣言 | `canvas` をトップレベルの必須フィールドにする。v1 は `[1600, 2400]` 以外を不正とする | §2.1 |
| 付け直したときの装備順 | 同じ Instance を再利用し、`equipment` の中の位置を変えない | §5.1 |
| category の重複 | 不正にしない。両方を描画し、注意として知らせる。環境に依存する判定で Character の意味を変えない | §5.2 |
| UUID | v4 を推奨。Schema はバージョンを固定しない | §3 |
| 外している Instance の上限 | 設けない。完全な削除は UI が提供する | §5.3 |
| `requirements.parts` の範囲 | 装備中の Part だけ | §8 |

### 11.2 Phase 1-B で確定する事項

| 項目 | 現在の扱い | 確定の方法 |
| --- | --- | --- |
| 条件ごとの配置補正 | `transform` は 1 つ。VIEW・ポーズごとの補正は `overrides` に予約 | Transform を実装するときに `overrides` のキー構造を決める |
| UNRESOLVED での画像の書き出し | 仕様では定めない。方向性は「描画できるなら警告つきで可」 | UI 挙動の文書 |
| 本書の RC1 判定 | 草案 0.2 | 実際の UI から「新規作成 → Part 選択 → 色変更 → 保存 → 再読込 → PNG」を通し、使いにくさが見つからないことを確かめる |

### 11.3 後のフェーズへ持ち越す事項

| 項目 | 現在の扱い | 再開の条件 |
| --- | --- | --- |
| Capability の正式な表現 | 定義しない。`requirements` の語彙だけ Asset 仕様と揃えてある | Asset 仕様 §14.2 と合わせて決める |
| 未知のポーズの扱いの非対称 | Character では UNRESOLVED、Part の manifest では不正（Asset 仕様 §6.2） | Capability を正式化するときにまとめて解決する |
| VARIANT・OUTFIT の継承 | 定義しない。`state` は 1 組だけ | 複数の差分を 1 ファイルに持つ形を決めるとき |
| `composition` | 予約のみ | COMPOSITION / PORTRAIT の仕様 |
| キャンバス規格の変更 | v1 は 1600×2400 だけ | 変更するときは migration の対象にする |
