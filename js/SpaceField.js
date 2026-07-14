/**
 * SpaceField.js — 空間音響パラメータ構造体と補間
 *
 * すべてのパラメータは 0〜1 で表現される。
 */

export class SpaceField {
  constructor() {
    this.width         = 0.5;  // 左右の広がり
    this.depth         = 0.5;  // 前後の奥行き
    this.height        = 0.5;  // 上下定位
    this.localization  = 0.7;  // 定位精度 (1=点定位, 0=霧)
    this.distanceScale = 0.5;  // 距離感 (0=全部近い, 1=遠く)
    this.reflection    = 0.3;  // 反射量
    this.reverb        = 0.2;  // 残響量
    this.diffusion     = 0.3;  // 散乱
    this.occlusion     = 0.5;  // 遮蔽
    this.focus         = 0.7;  // 集中度 (1=一点, 0=全体)
    this.warp          = 0.0;  // 空間歪み
  }

  /** 別の SpaceField へ向けてスムーズに補間する (インプレース) */
  lerpToward(target, speed) {
    const k = 1 - Math.pow(1 - speed, 1); // 線形に
    for (const key of SpaceField.KEYS) {
      this[key] += (target[key] - this[key]) * k;
    }
  }

  /** SmoothStep による補間（辺縁をやわらかく） */
  smoothstepToward(target, t) {
    const s = t * t * (3 - 2 * t); // smoothstep
    for (const key of SpaceField.KEYS) {
      this[key] += (target[key] - this[key]) * s;
    }
  }

  /** 2つの SpaceField を blend した新しいインスタンスを返す */
  static blend(a, b, t) {
    const s = t * t * (3 - 2 * t);
    const out = new SpaceField();
    for (const key of SpaceField.KEYS) {
      out[key] = a[key] + (b[key] - a[key]) * s;
    }
    return out;
  }

  /** 現在の状態をコピーして返す */
  clone() {
    const c = new SpaceField();
    for (const key of SpaceField.KEYS) c[key] = this[key];
    return c;
  }

  /** プレーンオブジェクトから生成 */
  static fromObject(obj) {
    const f = new SpaceField();
    for (const key of SpaceField.KEYS) {
      if (obj[key] !== undefined) f[key] = Math.max(0, Math.min(1, obj[key]));
    }
    return f;
  }

  /** Warp を適用して方向ベクトルを歪める */
  warpDirection(dx, dy, dz) {
    const w = this.warp;
    if (w < 0.001) return [dx, dy, dz];

    // 方向ベクトルを歪ませる
    const angle = w * Math.PI;
    const wx = dx + Math.sin(dz * angle + w * 1.7) * w * 0.9;
    const wy = dy + Math.cos(dx * angle + w * 2.3) * w * 0.4;
    const wz = dz + Math.sin(dy * angle + w * 0.9) * w * 0.6;

    // 正規化
    const len = Math.sqrt(wx*wx + wy*wy + wz*wz) || 1;
    return [wx/len, wy/len, wz/len];
  }

  /** UI表示用のラベル取得 */
  label(key) {
    const labels = {
      width: 'WIDTH', depth: 'DEPTH', height: 'HEIGHT',
      localization: 'LOCALIZE', distanceScale: 'DISTANCE',
      reflection: 'REFLECT', reverb: 'REVERB', diffusion: 'DIFFUSE',
      occlusion: 'OCCLUDE', focus: 'FOCUS', warp: 'WARP',
    };
    return labels[key] || key.toUpperCase();
  }
}

SpaceField.KEYS = [
  'width', 'depth', 'height', 'localization', 'distanceScale',
  'reflection', 'reverb', 'diffusion', 'occlusion', 'focus', 'warp',
];
