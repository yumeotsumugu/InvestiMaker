// §13-3（Mask の A チャンネル）の実測に使う画像の中身。
// 生成スクリプト（tools/generate-probe.ts）と検証ページの両方がこの定義を使う。

/** 行ごとのアルファ値。 */
export const PROBE_ALPHAS = [0, 1, 2, 3, 5, 8, 16, 32, 64, 128, 192, 254, 255] as const;
export const PROBE_WIDTH = 256;

/** (x, 行) の画素に入っているはずの RGBA。RGB は 0〜255 の全値を網羅する。 */
export function probePixel(x: number, row: number): [number, number, number, number] {
  return [x, 255 - x, (x * 7 + 13) % 256, PROBE_ALPHAS[row]!];
}
