// 非プリマルチプライ RGBA のソフトウェア合成。
// 検証ページは Canvas 2D の drawImage で合成するが、テストとレポート用画像の生成では
// ブラウザなしで同じ結果を得るためにこちらを使う。

export interface Bitmap {
  width: number;
  height: number;
  /** 非プリマルチプライ RGBA、行優先。 */
  data: Uint8ClampedArray;
}

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** `src` を `dst` の (ox, oy) に通常合成（source-over）する。はみ出した部分は切り捨てる。 */
export function compositeOver(dst: Bitmap, src: Bitmap, ox: number, oy: number): void {
  const x0 = Math.max(0, -ox);
  const y0 = Math.max(0, -oy);
  const x1 = Math.min(src.width, dst.width - ox);
  const y1 = Math.min(src.height, dst.height - oy);
  for (let y = y0; y < y1; y++) {
    let s = (y * src.width + x0) * 4;
    let d = ((y + oy) * dst.width + x0 + ox) * 4;
    for (let x = x0; x < x1; x++, s += 4, d += 4) {
      const sa = src.data[s + 3]! / 255;
      if (sa === 0) continue;
      const da = dst.data[d + 3]! / 255;
      if (sa === 1 || da === 0) {
        dst.data[d] = src.data[s]!;
        dst.data[d + 1] = src.data[s + 1]!;
        dst.data[d + 2] = src.data[s + 2]!;
        dst.data[d + 3] = src.data[s + 3]!;
        continue;
      }
      const rest = da * (1 - sa);
      const outA = sa + rest;
      dst.data[d] = Math.round((src.data[s]! * sa + dst.data[d]! * rest) / outA);
      dst.data[d + 1] = Math.round((src.data[s + 1]! * sa + dst.data[d + 1]! * rest) / outA);
      dst.data[d + 2] = Math.round((src.data[s + 2]! * sa + dst.data[d + 2]! * rest) / outA);
      dst.data[d + 3] = Math.round(outA * 255);
    }
  }
}
