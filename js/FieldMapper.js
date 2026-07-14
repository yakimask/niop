/**
 * FieldMapper.js — GPS座標 (メートル) → SpaceField
 *
 * Simplex Noiseを使って、任意の座標から
 * SpaceFieldの各パラメータを決定論的に生成する。
 * エリア境界が存在せず、世界全体が連続的に変化する。
 */

import { SimplexNoise } from './noise.js';
import { SpaceField } from './SpaceField.js';

// 各パラメータのノイズ設定
// scale: 変化の空間的スケール（メートル）— 大きいほどゆっくり変化
// ox,oy: オフセット（パラメータごとに独立したノイズ場を作る）
const PARAM_CONFIG = {
  width:         { scale: 150, ox:   0, oy:   0 },
  depth:         { scale: 200, ox: 100, oy:  50 },
  height:        { scale: 100, ox:  30, oy:  80 },
  localization:  { scale: 120, ox: 200, oy:  10 },
  distanceScale: { scale: 180, ox:  60, oy: 150 },
  reflection:    { scale:  80, ox: 120, oy: 200 },
  reverb:        { scale: 250, ox:  50, oy: 100 },
  diffusion:     { scale:  90, ox: 170, oy:  30 },
  occlusion:     { scale: 140, ox:  20, oy: 170 },
  focus:         { scale: 160, ox:  90, oy:  90 },
  warp:          { scale: 300, ox:   0, oy: 200 },  // 最もゆっくり変化
};

export class FieldMapper {
  constructor(seed = 42) {
    // 各パラメータ用に独立したSimplexNoiseインスタンス
    this._noise = {};
    let s = seed;
    for (const key of SpaceField.KEYS) {
      this._noise[key] = new SimplexNoise(s++);
    }
  }

  /**
   * 現在位置(メートル)から SpaceField を計算して返す
   * @param {number} mx - X座標（東方向、メートル）
   * @param {number} my - Y座標（北方向、メートル）
   * @returns {SpaceField}
   */
  compute(mx, my) {
    const field = new SpaceField();
    for (const key of SpaceField.KEYS) {
      const cfg = PARAM_CONFIG[key];
      const nx = (mx + cfg.ox) / cfg.scale;
      const ny = (my + cfg.oy) / cfg.scale;
      field[key] = this._noise[key].norm2(nx, ny);
    }
    return field;
  }

  /**
   * ある半径の円周上をサンプリングして「近隣の音響空間」を概観する
   * （デバッグ・UI用途）
   */
  sampleAround(mx, my, radius = 50, count = 8) {
    const samples = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const sx = mx + Math.cos(angle) * radius;
      const sy = my + Math.sin(angle) * radius;
      samples.push(this.compute(sx, sy));
    }
    return samples;
  }
}
