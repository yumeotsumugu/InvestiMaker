# 適合性テストの入力

`resolve/T01.json`〜`T12.json` は、仕様書 §6.6 の表を 1 行ずつ manifest の断片にしたものです。

| フィールド | 内容 |
|---|---|
| `layer` | manifest の `layers[]` に入る Layer の断片。Asset X は `assets/front/x.png`、Asset Y は `assets/front/y.png` |
| `compatibleBody` | その Part の `compatible.body`。表の Body `A` / `B` は `dev.body_a` / `dev.body_b` |
| `context` | その Layer を解決するときの Context（`when` の各キーと照合する値）。不正を期待するケースは `null` |
| `expect` | `x` / `y`（選ばれる Asset）、`unresolved`（未解決）、`invalid`（検証が manifest を拒否） |

別の実装がこの規格に適合しているかを確かめるときは、同じファイルを読んで同じ結果になることを確認します。
