// 配布用の index.html（1 ファイルにまとめたもの）用。素材を HTML の中に埋め込んだ場合に、そこから読む。
// ファイルを直接開いたとき（file://）は、ブラウザが fetch やモジュールの読み込みを制限するため。
// 開発サーバーやビルド版では何も埋め込まれておらず、通常どおり URL から読む。

type Embedded = Record<string, unknown>;

const store = (globalThis as { __INVESTIMAKER_ASSETS__?: Embedded }).__INVESTIMAKER_ASSETS__;

/** `./development/index.json` や `/development/index.json` を、埋め込みのキー `development/index.json` にする。 */
const keyOf = (url: string) => url.replace(/^\.?\//, '');

/** 埋め込まれた JSON（なければ undefined）。 */
export function embeddedJson(url: string): unknown {
  return store?.[keyOf(url)];
}

/** 画像の URL。埋め込まれていれば data URL、なければ元の URL。 */
export function assetUrl(url: string): string {
  const value = store?.[keyOf(url)];
  return typeof value === 'string' ? value : url;
}
