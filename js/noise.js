/**
 * noise.js — Simplex Noise 2D (軽量実装)
 * SpaceField生成に使用。同じ座標には常に同じ値を返す。
 */

// グラジエントテーブル
const GRAD = [
  [1,1],[-1,1],[1,-1],[-1,-1],
  [1,0],[-1,0],[0,1],[0,-1],
];

function dot2(g, x, y) {
  return g[0] * x + g[1] * y;
}

// シード付きパーミュテーションテーブル生成
function buildPerm(seed = 42) {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = seed;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

export class SimplexNoise {
  constructor(seed = 42) {
    this.perm = buildPerm(seed);
  }

  /** 2D Simplex Noise。戻り値: -1.0 〜 1.0 */
  noise2(xin, yin) {
    const perm = this.perm;
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;

    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t, Y0 = j - t;
    const x0 = xin - X0, y0 = yin - Y0;

    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else          { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2*G2, y2 = y0 - 1 + 2*G2;

    const ii = i & 255, jj = j & 255;
    const gi0 = perm[ii + perm[jj]] % 8;
    const gi1 = perm[ii + i1 + perm[jj + j1]] % 8;
    const gi2 = perm[ii + 1 + perm[jj + 1]] % 8;

    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0*x0 - y0*y0;
    if (t0 >= 0) { t0 *= t0; n0 = t0*t0 * dot2(GRAD[gi0], x0, y0); }
    let t1 = 0.5 - x1*x1 - y1*y1;
    if (t1 >= 0) { t1 *= t1; n1 = t1*t1 * dot2(GRAD[gi1], x1, y1); }
    let t2 = 0.5 - x2*x2 - y2*y2;
    if (t2 >= 0) { t2 *= t2; n2 = t2*t2 * dot2(GRAD[gi2], x2, y2); }

    return 70 * (n0 + n1 + n2);
  }

  /** 0〜1 に正規化した値を返す */
  norm2(x, y) {
    return (this.noise2(x, y) + 1) * 0.5;
  }
}
