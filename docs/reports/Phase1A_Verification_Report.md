# InvestiMaker Phase 1-A 検証レポート

Character JSON Schema v1 — Data Architecture & Persistence Prototype

作成日：2026-10-05
対象：`docs/specifications/InvestiMaker_Character_Schema_v1.md`（検証時は草案 0.1。決定を反映して草案 0.2）

> **Phase 1-A は完了。** §4 の判断事項は決定され、Character Schema は草案 0.2 になった（決定内容は本書の §8）。RC1 の判定は Phase 1-B の終了時に行う。
指示書：`docs/instructions/Phase1A_Character_Schema_Instructions.md`

## 0. 要約

キャラクター 1 体を「作成 → 編集 → 保存 → 読込 → 完全復元」できる保存形式を設計し、実装とテストで確かめた。完了条件 6 つはすべて満たしている。

| 完了条件 | 結果 | 根拠 |
| --- | --- | --- |
| 1. Character Schema v1 の草案がある | 満たした | `docs/specifications/InvestiMaker_Character_Schema_v1.md` |
| 2. `character.schema.json` で基本構造を検証できる | 満たした | `tests/character/schema.test.ts`（有効 3 件・不正 26 件の fixtures で、Schema と検証器の判定が一致） |
| 3. serialize → deserialize → serialize が意味的に一致する | 満たした | `tests/character/roundtrip.test.ts`（JSON の一致に加え、仮素材で描いた画像が画素単位で一致） |
| 4. 不足 Part を挟んだ round-trip で Instance 情報が失われない | 満たした | `tests/character/missing-parts.test.ts` |
| 5. VALID / INVALID / UNRESOLVED をテストできる | 満たした | `tests/character/validity.test.ts` |
| 6. 確定できる事項・判断が必要な事項・持ち越す事項が明記されている | 満たした | 本書 §3・§4・§5 |

`npm test` は検証時 228 件、草案 0.2 の反映後 236 件がすべて通過（Phase 0 の 131 件を含む）。

## 1. 設計の要点

基準案からの変更と、その理由。

| 項目 | 基準案 | 草案 | 理由 |
| --- | --- | --- | --- |
| 素体の持ち方 | `appearance: {}`（中身は未定） | `appearance.body` に素体の `instanceId`、`appearance.fit` に fit を持つ | 素体も Part なので、色と配置補正は Equipment Instance に持たせて他の Part と同じ扱いにした。ただし「どの Instance が素体か」は manifest なしで分かる必要があるため、Character 側に明示的な参照を置いた |
| 顔・髪の Part | 未定 | すべて `equipment` に置く | 装備順・色・不足時の保持を 1 つの仕組みで扱える。`appearance` に Part の一覧を別に持つと、正本が 2 つになる |
| Instance の色 | `colors: {}`（中身は未定） | スロット ID → `{ linked?, color? }` | core が Phase 0 から使っている形と同じ。リンク中でも個別色を保持できる |
| 表情 | `expression: {}` | `eyes` / `eyebrows` / `mouth` の状態名だけ。名前付き表情は保存しない | 指示書 §5 のとおり。標準表情に当たるかどうかは照合で求める |
| `requirements` | `requirements: {}` | Part・VIEW・ポーズ・fit・状態の 5 項目。値は配列 | 導出できるキャッシュとした。配列にしたのは、将来 1 ファイルが複数の差分を持つときに同じ形で書けるようにするため |
| メモリ上の形 | — | 保存 JSON とほぼ同じ形（`format`・`formatVersion`・`requirements` を除く） | 変換層を薄くすると、未知のフィールドが自然に保持される |

### 成果物の配置（指示書 §1 からの変更）

| 追加・変更 | 理由 |
| --- | --- |
| `src/core/character/evaluate.ts` | 環境に照らした評価（3 状態）と、描画計画への橋渡し。`validate.ts` は「JSON だけで決まること」に限定し、環境に依存する判定をここへ分けた。この分離が「missing Part ≠ INVALID」を構造的に保証する |
| `src/core/character/operations.ts` | 編集用の純粋な関数（装備・着脱・色・リンク解除など）。「リンク解除 → 色変更 → 外す → 保存 → 読込 → 再装備」をテストするために必要で、Phase 1-B の UI もこれを呼ぶ |
| `tests/character/validity.test.ts` | 3 状態のテスト。`schema.test.ts` に混ぜると趣旨がぼやけるため分けた |
| `src/core/plan.ts` の変更 | 装備に `instanceId` を持たせた。Phase 0 の描画計画は Part ID をキーにしており、同じ Part の複数装備を区別できなかった。Part ID だけを渡す従来の呼び方はそのまま動く |
| `schemas/character.schema.json` の検証に `ajv` を追加（devDependencies） | Schema 自体が正しいことを、自作でない検証器で確かめるため。実行時には使わない |

## 2. 検証したこと

### 2.1 Round-trip（指示書 §9）

- fixtures 3 件（最小、指示書 §6 のキャラクター、全項目）で、`serialize → stringify → parse → deserialize → serialize` の結果が一致する。繰り返しても変わらない。
- キーの順序が違う JSON も同じ Character として読める。
- 省略された項目（`fit`、`colors`）は既定値で埋まり、色は大文字に揃う。同じ意味の JSON は同じ Character になる。
- **仮素材で実際に描いて比べた。** 全 Part を装備し、共有色・個別色・リンク解除・着脱・ポーズ・表情・fit を変えたキャラクターを保存して読み直すと、描画計画が一致し、400×600 の画像が画素単位で一致した。状態を変えれば画像が変わることも確認している（比較が空振りしていない）。

### 2.2 不足 Part（指示書 §6）

`im.body_01` / `im.hair_01` / `author.special_coat` を参照するキャラクターを、`author.special_coat` のない環境で読んだ。

| 期待結果 | 結果 |
| --- | --- |
| Character 自体はロード成功 | UNRESOLVED で読める（INVALID にならない） |
| Instance は保持 | `instanceId`・`partId`・`equipped` がそのまま |
| 色も保持 | Part が宣言していないスロット（`lining`）の色も含めて保持 |
| transform も保持 | 6 項目すべて保持。`overrides` も保持 |
| 装備順も保持 | `equipment` の並びが変わらない |
| 「missing」と判定可能 | 評価で `part-missing`、描画計画で「不足」。他の Part は描画される |
| 再保存しても情報が失われない | 保存結果が元の JSON と意味的に一致 |
| 後から Part を読み込めば同じ Instance として復元 | 同じ `instanceId` が「対応」になり、保存していた色がそのまま使われる |

加えて次も確かめた。

- 不足したまま他の編集（共有色・別の Part の追加）をして保存しても、不足 Part の Instance は変わらない。
- 不足 Part を外すと VALID になり、付け直すと元の JSON に戻る。
- **素体が不足していても**読み込め、保存し直せる。
- 仮素材で、コートのない環境 → コートを入れた環境の順に読み直すと、元の画像と画素単位で一致する。

読み込み（`deserializeCharacter`）は Part の manifest を一切参照しない。環境によって読み込み結果が変わる経路が存在しないことが、この性質の根拠である。

### 2.3 3 状態（指示書 §7）

| 入力 | 環境 | 結果 |
| --- | --- | --- |
| 正しい JSON | Part が揃っている | VALID |
| 正しい JSON | 装備中の Part が 1 つない | UNRESOLVED（`part-missing`） |
| 正しい JSON | Part が 1 つもない | UNRESOLVED |
| `instanceId` が重複した JSON | Part が揃っていても、なくても | INVALID |
| 実装が知らないポーズ `crossed` | 現在の実装 | UNRESOLVED（`pose-unknown`） |
| 同上 | `crossed` を知っている実装 | VALID |
| `formatVersion: 2` | — | INVALID（`format-version-unsupported`） |
| 実装が知らない VIEW | — | UNRESOLVED（`view-unknown`） |
| 素体にない fit の値 | 素体が読み込まれている | UNRESOLVED（`fit-unknown`） |
| 同上 | 素体が読み込まれていない | UNRESOLVED（`part-missing` だけ。fit は判定しない） |

- **INVALID は JSON だけで決まる。** 同じ JSON を、Part の有無を変えた環境で順に評価しても、UNRESOLVED と VALID の間を行き来するだけで INVALID にはならない。
- **Capability の不足と `formatVersion` の不一致は区別できる。** 前者は UNRESOLVED（原因のコードが `pose-unknown` など）、後者は INVALID（コードが `format-version-unsupported`）。「新しい InvestiMaker が必要」と「ファイルが壊れている」を出し分ける材料になる。
- 状態に影響しない注意として、外している Part の不足、Part が宣言していないスロットの色、category の重複、`requirements` の不一致を挙げる。

### 2.4 Requirements（指示書 §8）

- Character だけから（manifest なしで）導出できる：装備中の Part、VIEW、領域ごとのポーズ、fit、顔の状態。
- 環境に照らして、満たせないものを種類ごとに列挙できる（`part:author.special_coat`、`pose:arm.left=crossed` など）。
- 保存された `requirements` が古い・壊れている・ない、のどれでも Character は読め、保存時に作り直される。

### 2.5 色（指示書 §4）

- 「リンク解除 → 色変更 → Part を外す → 保存 → 読込 → 再装備」で個別色が戻る。新しい Instance は作られず、同じ Instance が同じ位置で戻る。
- リンクを解除した瞬間、その時点の共有色が個別色にコピーされ、表示色は変わらない。解除後は共有色を変えても追従しない。
- リンクを戻しても個別色は消えない。もう一度解除したときは、そのとき見えている色で上書きする。

**Phase 0 からの挙動の変更が 1 つある。** Phase 0 の検証ページは「個別色がまだないときだけ」共有色をコピーしていたため、一度リンクを戻してから再び解除すると、以前の個別色に切り替わって見た目が変わった。指示書の「見た目を変化させない」に合わせ、常にコピーするよう検証ページも直した。

### 2.6 前方互換性（指示書 §10）

- 未知の `formatVersion` は拒否する。
- **未知のフィールドは全階層で保持する。** トップレベル、`appearance`、`state`、Equipment Instance、色の指定のそれぞれに未知のフィールドを入れた fixture を、編集して保存し直しても残ることを確認した。
- Schema は未知のフィールドを許可する（`additionalProperties` を禁止しない）。

## 3. 確定できる事項

実装とテストで成立を確かめ、変える理由が見つからなかったもの。

1. **装備は順序付きの Equipment Instance 配列を正本にする。** 同じ Part の複数装備、装備順、不足時の保持が 1 つの仕組みで扱える。
2. **素体も Equipment Instance に置き、`appearance.body` で指す。**
3. **Instance の色は `{ linked?, color? }`。** リンク中も個別色を保持し、解除時は表示色をコピーする。
4. **Part が宣言していないスロットの色、読み込まれていない Part の Instance は捨てない。**
5. **表情は顔の状態を正本にし、名前付き表情は保存しない。ポーズは領域ごとに保存する。**
6. **`requirements` は導出できるキャッシュ。** 保存時に必ず作り直し、読み込み時は意味の決定に使わない。
7. **3 状態の境界：INVALID は JSON だけで決まる。** 環境に依存する判定は UNRESOLVED か注意にしかならない。
8. **`formatVersion` の不一致（INVALID）と機能の不足（UNRESOLVED）を分ける。**
9. **未知のフィールドは無視せず保持する。**
10. **読み込みは Part の manifest を参照しない。**

## 4. 人間の判断が必要な事項

草案では実装側の選択で仮に決めてある。仕様書 §11 と対応する。

| # | 項目 | 草案の選択 | 別の選択肢と、決める材料 |
| --- | --- | --- | --- |
| 1 | 付け直したときの装備順 | 外す前の位置に戻る | 末尾（最後に装備したものが手前）へ移す案。装備順が効くのは同じ Slot・同じ `zBias` の Layer だけなので、影響は ITEM・OVERLAY・アクセサリーに限られる。「戻る」は復元として自然、「末尾」は装備という操作として自然 |
| 2 | category の重複 | 不正にせず注意にとどめ、両方描画する | category は Part の manifest にあり、Asset 仕様 §3 が「分類を後から変えても ID が変わらない」としているため、JSON だけでは判定できず INVALID にはできない。残る選択は「後から装備した方だけ有効」「UI で防ぐだけ」「現状のまま」 |
| 3 | 条件ごとの配置補正 | `transform` は 1 つ。`view × ポーズ` ごとの補正は `overrides` に予約 | Asset 仕様 §9 は `view × ポーズ` を最小キーと定めている。Transform 自体が未実装なので形を決める根拠がまだない。実装するときに `overrides` の中身を定義する |
| 4 | `requirements.parts` の範囲 | 装備中の Part だけ | 外している Part を別枠（例：`optionalParts`）で持つ案。「このファイルを開くのに何が要るか」の案内をどこまで親切にするかで決まる |
| 5 | キャンバスサイズの宣言 | 持たない | `transform` の `x` / `y` / `pivot` は画素なので、将来キャンバスが変わると意味が変わる。Part には `canvas` を必須にしたので、Character にも持たせるのが対称。必須にするなら `formatVersion` 1 を確定する前に決める必要がある |
| 6 | UUID の生成方法 | バージョンを問わない | v4（乱数）か v7（時刻順）か。保存形式としてはどちらでも支障がない |
| 7 | 外している Instance の上限 | なし | 現在の操作（`equipPart`）は、外してある同じ Part の Instance があれば必ず再利用するので、通常の付け外しでは増えない。ただし同じ Part を複数持てる category では増えうる。完全削除の UI と合わせて方針を決める |
| 8 | UNRESOLVED の Character をどこまで使わせるか | 読み込み・編集・保存はできる。未知のポーズを含むときだけ描画しない | 書き出し（PNG）を止めるか、警告つきで許すか。UI 挙動の文書で決める |
| 9 | Asset 側の未知ポーズとの非対称 | Character では UNRESOLVED、Part の manifest では INVALID（Asset 仕様 §6.2） | Asset 仕様 §14.2 の Capability と 3 状態を入れるときに揃える。Character 側はすでに「機能の不足」として扱える形になっている |

## 5. Phase 1-B 以降へ持ち越す事項

- **最小 UI**：新規キャラクター → Part 選択 → 色変更 → プレビュー → 保存 → 再読込 → PNG 出力。編集は `operations.ts`、評価は `evaluate.ts`、描画は `planCharacter` と `instanceColors` をそのまま使える。
- **検証ページの移行**：`src/lab/` は Phase 0 の独自の状態（Part ID の配列）のままである。Character を正本にするのは Phase 1-B で行う。今回は描画計画の変更に合わせた最小の修正だけを入れた。
- **Transform の適用**：保存・復元はできるが、描画には反映されない。
- **Capability の正式仕様**：`requirements` の語彙は Asset 仕様と揃えてあるが、必要な InvestiMaker のバージョンや Pose Definition の版の表現は決めていない。
- **manifest の JSON Schema**：`schemas/` には Character の Schema だけがある。
- **今回やらなかったもの**（指示書 §11）：IndexedDB、Undo / Redo、VARIANT、OUTFIT の継承、PORTRAIT、COMPOSITION の詳細、ZIP、`.imchar`、一括出力、カスタム Part の導入 UI、Advanced Layer の UI、migration。

## 6. Asset 仕様 RC1 への気づき

仕様書は書き換えていない。Character 側を設計して見えた点を挙げる。

| 節 | 内容 |
| --- | --- |
| §2 | 「1 category につき 1 Part」は、Character の JSON だけでは検証できない（category は manifest にある）。どこで・どう扱うかを UI 挙動の文書か Character Schema に書く必要がある（本書 §4 の 2） |
| §6.1 | 「同値なら装備順で描く」の装備順を、Character Schema が「`equipment` の並び」と定義した。Asset 仕様からその定義を参照するとよい |
| §8 | `state` 条件の `path: "expression"` は標準表情の ID と照合する。Character は顔の状態だけを保存するので、ID は照合で求めている。状態を個別に選んでいるときに一致しないことは RC1 に明記済みで、整合している |
| §9 | 「キャラクター側の補正は `view × ポーズ` を最小キーとして保持する。保存形式は JSON Schema v1 で定義する」とあるが、草案は条件によらない `transform` 1 つにとどめた（本書 §4 の 3） |
| §14.2 | 検証結果の 3 状態は、Character 側で先に形になった。「JSON だけで決まるものが INVALID、環境に依存するものは UNRESOLVED」という境界は、Part の manifest にもそのまま使える |

## 7. 再現手順

```sh
npm install
npm test                         # 236 件
npx vitest run tests/character   # Phase 1-A の分だけ
```

## 8. 決定記録（2026-10-05）

§4 の判断事項に対する決定と、草案 0.2 への反映。

| # | 項目 | 決定 |
| --- | --- | --- |
| 5 | キャンバスサイズの宣言 | **`canvas` をトップレベルの必須にする。v1 は `[1600, 2400]` 以外を INVALID とする。** 将来の変更は migration で扱う |
| 1 | 付け直したときの装備順 | **元の位置に戻る。** 同じ Instance を再利用し、`equipment` の中の位置も変えない |
| 2 | category の重複 | **INVALID にせず、注意を出して両方描画する。** 読み込み時に片方を無効にしない（環境に依存する判定で Character の意味を変えない）。重複を防ぐのは UI の役割 |
| 6 | UUID | **v4 を推奨。** Schema はバージョンを固定しない |
| 7 | 外している Instance の上限 | **設けない。** Phase 1-B で完全削除を用意する |
| 4 | `requirements.parts` の範囲 | **装備中だけ。** 素材同梱（`.imchar`）で必要な一覧は別の概念として扱う |
| 3 | 条件ごとの配置補正 | Phase 1-B で Transform を実装するときに確定する |
| 8 | UNRESOLVED での画像の書き出し | Phase 1-B の UI 仕様で決める。第一候補は「描画できる状態なら警告つきで可」 |
| 9 | 未知のポーズの扱いの非対称 | 今は触らない。Capability を正式化するときにまとめて解決する |

あわせて、Asset 仕様 RC1 の §9 を「キャラクター側の補正の保存形式とキーの構造は Character Schema v1 が定める」という書き方に直した。規定の内容は変えていない。Transform を実装するときに 2 つの仕様書が衝突しないようにするためである。

草案 0.2 に合わせた実装の変更：

- `canvas` の検証（`canvas` / `canvas-mismatch`）と、新規作成時の既定値。`schemas/character.schema.json` にも反映。
- fixtures に `canvas` を追加し、不正なケースを 3 件足した。
- 「後から別の Part を装備していても、付け直した Instance の位置は変わらない」ことのテストを追加。

タグ `character-schema-v1-rc1` はまだ打たない。Phase 1-B で実際の UI から「新規作成 → Part 選択 → 色変更 → 保存 → 再読込 → PNG」を通した後に、RC1 とするかを判定する。
