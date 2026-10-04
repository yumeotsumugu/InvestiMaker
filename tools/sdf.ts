// 仮素材を描くための図形。符号付き距離（内側が負）で表し、輪郭線とアンチエイリアスをそこから作る。
// 座標はすべて設計座標（1600×2400 基準）。

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Shape {
  /** 境界までの距離。内側が負。 */
  d(x: number, y: number): number;
  bbox: BBox;
}

export type Pt = readonly [number, number];

const EVERYWHERE: BBox = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };

const grow = (b: BBox, r: number): BBox => ({ x0: b.x0 - r, y0: b.y0 - r, x1: b.x1 + r, y1: b.y1 + r });

export function ellipse(cx: number, cy: number, rx: number, ry: number): Shape {
  const rmin = Math.min(rx, ry);
  return {
    bbox: { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry },
    d(x, y) {
      // 楕円の距離の近似（境界付近で十分な精度）。
      const px = (x - cx) / rx;
      const py = (y - cy) / ry;
      const k = Math.hypot(px, py);
      if (k < 1e-6) return -rmin;
      const g = Math.hypot(px / rx, py / ry);
      return (k * (k - 1)) / g;
    },
  };
}

export function capsule(ax: number, ay: number, bx: number, by: number, r: number): Shape {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  return {
    bbox: grow({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }, r),
    d(x, y) {
      const wx = x - ax;
      const wy = y - ay;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * ex + wy * ey) / len2));
      return Math.hypot(wx - ex * t, wy - ey * t) - r;
    },
  };
}

/** 多角形。`round` を指定すると、その分だけ外へ膨らんで角が丸くなる。 */
export function polygon(pts: readonly Pt[], round = 0): Shape {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    bbox: grow({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, round),
    d(x, y) {
      let best = Infinity;
      let sign = 1;
      for (let i = 0, j = n - 1; i < n; j = i, i++) {
        const [vix, viy] = pts[i]!;
        const [vjx, vjy] = pts[j]!;
        const ex = vjx - vix;
        const ey = vjy - viy;
        const wx = x - vix;
        const wy = y - viy;
        const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
        const bx = wx - ex * t;
        const by = wy - ey * t;
        best = Math.min(best, bx * bx + by * by);
        const c1 = y >= viy;
        const c2 = y < vjy;
        const c3 = ex * wy > ey * wx;
        if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
      }
      return sign * Math.sqrt(best) - round;
    },
  };
}

export function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): Shape {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  return {
    bbox: { x0, y0, x1, y1 },
    d(x, y) {
      const qx = Math.abs(x - cx) - hx;
      const qy = Math.abs(y - cy) - hy;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    },
  };
}

/** 点 (px, py) を通り、法線 (nx, ny) の反対側が内側の半平面。 */
export function halfPlane(px: number, py: number, nx: number, ny: number): Shape {
  const len = Math.hypot(nx, ny);
  return { bbox: EVERYWHERE, d: (x, y) => ((x - px) * nx + (y - py) * ny) / len };
}

export const above = (y: number): Shape => halfPlane(0, y, 0, 1);
export const below = (y: number): Shape => halfPlane(0, y, 0, -1);

export function union(...shapes: Shape[]): Shape {
  return {
    bbox: {
      x0: Math.min(...shapes.map((s) => s.bbox.x0)),
      y0: Math.min(...shapes.map((s) => s.bbox.y0)),
      x1: Math.max(...shapes.map((s) => s.bbox.x1)),
      y1: Math.max(...shapes.map((s) => s.bbox.y1)),
    },
    d(x, y) {
      let m = Infinity;
      for (const s of shapes) m = Math.min(m, s.d(x, y));
      return m;
    },
  };
}

export function intersect(...shapes: Shape[]): Shape {
  return {
    bbox: {
      x0: Math.max(...shapes.map((s) => s.bbox.x0)),
      y0: Math.max(...shapes.map((s) => s.bbox.y0)),
      x1: Math.min(...shapes.map((s) => s.bbox.x1)),
      y1: Math.min(...shapes.map((s) => s.bbox.y1)),
    },
    d(x, y) {
      let m = -Infinity;
      for (const s of shapes) m = Math.max(m, s.d(x, y));
      return m;
    },
  };
}

export function subtract(a: Shape, b: Shape): Shape {
  return { bbox: a.bbox, d: (x, y) => Math.max(a.d(x, y), -b.d(x, y)) };
}

/** 境界から内外に `t` ずつの帯（輪）。 */
export function ring(s: Shape, t: number): Shape {
  return { bbox: grow(s.bbox, t), d: (x, y) => Math.abs(s.d(x, y)) - t };
}

/** 折れ線に太さを付けたもの。 */
export function polyline(pts: readonly Pt[], r: number): Shape {
  const segments: Shape[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    segments.push(capsule(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1], r));
  }
  return union(...segments);
}

/** 縦軸 x = `axis` で左右反転。 */
export function mirrorX(s: Shape, axis = 800): Shape {
  return {
    bbox: { x0: 2 * axis - s.bbox.x1, y0: s.bbox.y0, x1: 2 * axis - s.bbox.x0, y1: s.bbox.y1 },
    d: (x, y) => s.d(2 * axis - x, y),
  };
}

export const mirrorPts = (pts: readonly Pt[], axis = 800): Pt[] => pts.map(([x, y]) => [2 * axis - x, y] as const);

export function unionBBox(boxes: readonly BBox[]): BBox {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}
