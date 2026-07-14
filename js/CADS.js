/**
 * CADS.js — Continuous Acoustic Dimension System
 * メインコーディネーター
 *
 * GPS → FieldMapper → SpaceField（補間） → AudioEngine
 */

import { GeoLocator }  from './GeoLocator.js';
import { FieldMapper } from './FieldMapper.js';
import { SpaceField }  from './SpaceField.js';
import { AudioEngine } from './AudioEngine.js';

export class CADS {
  constructor() {
    this.geo     = new GeoLocator();
    this.mapper  = new FieldMapper(42);
    this.engine  = new AudioEngine();

    // 現在の補間済みフィールド
    this.field   = new SpaceField();
    // 目標フィールド（GPS位置から計算）
    this.target  = new SpaceField();

    // 仮想移動モード
    this.virtualMode = false;
    this.virtualX = 0;
    this.virtualY = 0;

    // 状態
    this.running = false;
    this._raf = null;
    this._lastTime = 0;

    // コールバック（UI更新用）
    this.onFieldUpdate = null; // (field, geoState) => void
  }

  /** システム起動（ユーザーの操作後に呼ぶ） */
  start() {
    if (this.running) return;
    this.running = true;

    // AudioEngine 初期化
    this.engine.init();

    // GPS開始
    if (!this.virtualMode) {
      this.geo.start((x, y, acc) => {
        // GPS更新時 → target を計算
        this.target = this.mapper.compute(x, y);
      });
    }

    // アニメーションループ開始
    this._lastTime = performance.now();
    this._loop();
  }

  /** 仮想移動モードに切り替え（GPS不要） */
  enableVirtualMode() {
    this.virtualMode = true;
    if (this.geo.watching) this.geo.stop();
    this._updateVirtual();
  }

  /** 実際のGPSモードに切り替え */
  enableGPSMode() {
    this.virtualMode = false;
    this.geo.start((x, y, acc) => {
      this.target = this.mapper.compute(x, y);
    });
  }

  /** 仮想座標を設定（メートル） */
  setVirtualPosition(x, y) {
    this.virtualX = x;
    this.virtualY = y;
    this._updateVirtual();
  }

  _updateVirtual() {
    this.target = this.mapper.compute(this.virtualX, this.virtualY);
  }

  /** メインループ */
  _loop() {
    if (!this.running) return;

    const now = performance.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    // SpaceField を target に向かってスムーズ補間
    // GPS更新が遅くても音響変化は毎フレームスムーズ
    const speed = 1 - Math.exp(-dt * 1.2); // 約0.8秒で80%補間
    for (const key of SpaceField.KEYS) {
      this.field[key] += (this.target[key] - this.field[key]) * speed;
    }

    // DSPに適用
    const px = this.virtualMode ? this.virtualX : this.geo.x;
    const py = this.virtualMode ? this.virtualY : this.geo.y;
    this.engine.applyField(this.field, px, py);
    this.engine.resume();

    // UI更新コールバック
    if (this.onFieldUpdate) {
      const geoState = {
        x:            this.virtualMode ? this.virtualX : this.geo.x,
        y:            this.virtualMode ? this.virtualY : this.geo.y,
        accuracy:     this.geo.accuracy,
        accuracyLabel: this.geo.accuracyLabel,
        error:        this.geo.error,
        virtualMode:  this.virtualMode,
      };
      this.onFieldUpdate(this.field, geoState);
    }

    this._raf = requestAnimationFrame(() => this._loop());
  }

  /** 停止 */
  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this.geo.stop();
    this.engine.dispose();
  }
}
