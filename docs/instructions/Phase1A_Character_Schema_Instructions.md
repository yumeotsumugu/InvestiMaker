# InvestiMaker Phase 1-A 作業指示書

Character JSON Schema v1 — Data Architecture & Persistence Prototype

対象：このリポジトリで作業する Claude Code
作成日：2026-10-05

---

## 0. 先に決めた方針

Phase 0 の実装から出た 4 つの論点について、設計に入る前に次のとおり決めた。

- **装備**は「category ごとの現在値」ではなく、**順序付きの Equipment Instance 配列**を正本にする。同じ Part を複数装備する ITEM / OVERLAY や、将来の Advanced Layer にも自然に対応できる。
- **色**は共有カラーを Character 側、リンク解除後の個別色を Equipment Instance 側に保存する。Part を外しても Instance を即削除せず、`equipped: false` として残せる設計を第一候補にする。「帽子を外して、あとで付け直したら色が戻る」ができる。無限に履歴が膨らまないよう、UI から完全削除も可能にする。
- **不足 Part**は絶対に保存データから消さない。Part ID、instance ID、色、transform、装備順など、復元に必要な情報は manifest なしでも保持する。ロード時に「不足」と判定するだけにする。
- **Capability**は Asset と Character で共通語彙にする。ただし Character JSON に依存情報を手入力させるのではなく、基本的には保存時に現在の Character State から導出できる形を狙う。

## 目的

InvestiMaker で作成した 1 キャラクターについて、

> 作成 → 編集 → 保存 → アプリ終了相当 → 読込 → 完全復元

できる保存形式を確定する。

この Phase では「見た目を作る UI」ではなく、**キャラクターというデータそのもの**を完成させる。

## 1. 成果物

```text
docs/specifications/
└─ InvestiMaker_Character_Schema_v1.md

schemas/
└─ character.schema.json

src/core/character/
├─ types.ts
├─ validate.ts
├─ serialize.ts
├─ deserialize.ts
└─ requirements.ts

tests/
└─ character/
   ├─ fixtures/
   ├─ schema.test.ts
   ├─ roundtrip.test.ts
   └─ missing-parts.test.ts
```

既存構成との整合上、より自然な配置があれば変更可。その場合はレポートに理由を残す。

## 2. Character の基本構造

以下を基準案として設計する。**これは完成 Schema ではなく、検証対象となる設計案である。**

```json
{
  "format": "INVESTIMAKER_CHARACTER",
  "formatVersion": 1,

  "id": "uuid",
  "name": "Character Name",

  "appearance": {},
  "sharedColors": {},

  "equipment": [],

  "state": {
    "view": "front",
    "pose": {},
    "expression": {}
  },

  "composition": {},

  "requirements": {}
}
```

必要なら構造変更可。ただし変更理由を記録すること。

## 3. Equipment Instance

Part そのものと「このキャラクターがその Part をどう使っているか」を分離する。最低限、次を想定する。

```json
{
  "instanceId": "uuid",
  "partId": "im.coat_01",
  "equipped": true,

  "colors": {},
  "transform": {},
  "overrides": {}
}
```

必須要件：

- `equipment` 配列の順番を**装備順の正本**とする。
- 同一 Part ID の複数 Instance を許可できる構造にする。
- Part manifest が存在しなくても Equipment Instance 単体を読み込み・保存できること。
- 未知 Part だからという理由で Instance 内のデータを削除してはいけない。
- `equipped: false` の Instance も保存可能にする。

## 4. 色

### Shared Color

Character 単位で保持する。

```json
{
  "sharedColors": {
    "skin.base": "#F2D3BD",
    "hair.base": "#202028",
    "eyes.left": "#405070",
    "eyes.right": "#405070"
  }
}
```

### Instance Color

共有色とのリンク状態と個別色を Equipment Instance 側で表現する。ここは**実装して最も自然な構造を提案する**。

重要なのは、

> リンク解除 → 色変更 → Part を外す → 保存 → 読込 → 再装備

しても個別色が復元されることである。

共有色からリンク解除した瞬間には、その時点の共有色を個別色へコピーし、見た目を変化させない現在の Phase 0 挙動を維持する。

## 5. State

少なくとも VIEW / POSE / EXPRESSION を保存する。

- POSE は Phase 0 の Pose Definition と対応させる。左右を独立して保存できること。
- EXPRESSION も単なる `"smile"` だけを正本にせず、次のように**実際の face state を復元可能な情報**を正本とする。

```json
{
  "eyes": "...",
  "eyebrows": "...",
  "mouth": "..."
}
```

`smile` 等の名前付き表情は Preset / shortcut として後から扱える構造を想定する。

## 6. 不足 Part

Character が `im.body_01` / `im.hair_01` / `author.special_coat` を参照している状態で、ロード環境に `author.special_coat` が存在しない場合をテストする。

期待結果：

- Character 自体はロード成功
- `author.special_coat` の Instance は保持
- 色も保持
- transform も保持
- 装備順も保持
- 状態は「missing」と判定可能
- JSON を再保存しても情報が失われない
- 後から Part を読み込めば同じ Instance として復元可能

**不足 Part を理由に Character JSON 自体を INVALID にしないこと。**

## 7. Validation の 3 状態

Phase 0 から持ち越した VALID / INVALID / UNRESOLVED を Character 側でも検証する。意味は暫定的に次のとおりとする。

- **VALID**：必要な情報が揃っており、現在の環境で完全に検証できる。
- **INVALID**：Character JSON そのものが仕様違反。
- **UNRESOLVED**：JSON としては正しいが、Part / Capability 等の外部依存が不足して完全検証できない。

重要なのは、**missing Part ≠ INVALID** である。

## 8. Requirements / Capability

Asset Specification RC1 との共通語彙を前提に設計する。ただし今回は **Capability システムの正式仕様を確定しない**。

Character から、使用 Part・使用 Pose・VIEW・fit・その他将来の Capability について「この Character を完全再現するために必要なもの」を導出できることを確認する。

保存 JSON に `requirements` を持たせる場合、**正本なのか、キャッシュなのか、検証用メタデータなのか**を明文化する。

第一候補は**導出可能なキャッシュ**である。Character 本体の State / Equipment を正本とし、`requirements` が古くても Character そのものを壊さない設計を優先する。

## 9. Round-trip

今回の最重要テスト。

```text
Character A
↓
JSON stringify
↓
JSON parse
↓
deserialize
↓
serialize
↓
Character B
```

で、意味的に A = B になること。さらに、

```text
保存
↓
Part 不足環境で読込
↓
保存
↓
Part を導入
↓
再読込
```

でも元の設定が復元されること。JSON のキー順や空白まで一致させる必要はない。

## 10. Forward Compatibility

最低限、次を検討する。

- 未知の `formatVersion` は拒否
- 未知フィールドは保持するか無視するかを決定
- v1 内で追加可能なフィールドの扱い
- Capability 不足と formatVersion 不一致を区別

ここは**勝手に将来仕様を大量に作らず、判断が必要なものをレポートへ上げる**形でよい。

## 11. 今回やらないもの

```text
実製品UI
IndexedDB
Undo / Redo
VARIANT
OUTFIT inheritance
PORTRAIT
COMPOSITIONの詳細仕様
ZIP
.imchar
CCFOLIA一括出力
カスタムPart導入UI
Advanced Layer UI
正式Capability仕様
migration
```

`composition` については将来用の予約程度でよい。

## 12. 完了条件

1. `InvestiMaker_Character_Schema_v1.md` 草案が存在する。
2. `character.schema.json` で基本構造を検証できる。
3. Character の serialize → deserialize → serialize が意味的に一致する。
4. 不足 Part を挟んだ round-trip でも Instance 情報が一切失われない。
5. VALID / INVALID / UNRESOLVED をテストできる。
6. Phase 1-A 検証レポートに、**確定できる事項・人間の判断が必要な事項・Phase 1-B 以降へ持ち越す事項**が明記されている。

Phase 0 と同様、テスト数そのものは完了条件にしない。

## 進め方

- ブランチは `phase1-character-schema` とする。
- Phase 1-A ではまだ「キャラクタークリエイターを作らない」。ここで保存形式を固めてから、Phase 1-B で最小 UI を載せる。UI 都合で保存データが崩れるのを避けるためである。
