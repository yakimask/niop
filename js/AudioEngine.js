/**
 * AudioEngine.js — Web Audio API DSPエンジン
 *
 * SpaceField を受け取り、全DSPパラメータを更新する。
 * ノイズなく残響量を変化させるために、短い残響と長い残響の2つのConvolverを
 * リアルタイムでクロスフェードさせる設計。これによりバッファの再生成クリックを完全に防ぐ。
 */

import { SoundSources } from './SoundSources.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.started = false;

    // DSPノード
    this._convolverShort = null; // 短い残響 (部屋)
    this._convolverLong  = null; // 長い残響 (大聖堂)
    this._dryGain        = null; // ドライ信号ゲイン
    this._wetGainShort   = null; // 短い残響のゲイン
    this._wetGainLong    = null; // 長い残響のゲイン
    
    this._masterFilter   = null; // マスターフィルター
    this._masterGain     = null; // マスターゲイン
    this._compressor     = null; // ダイナミクスコンプレッサー

    // 音源バス（SoundSources が繋がる）
    this._sourceBus = null;

    this._sources = null;
    this._currentField = null;
  }

  /** ユーザー操作後に呼ぶ（AudioContext はジェスチャー後のみ作成可能） */
  init() {
    if (this.started) return;
    this.started = true;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._buildGraph();
    this._sources = new SoundSources(this.ctx, this._sourceBus);
    this._sources.build();
  }

  /** DSPグラフ構築 */
  _buildGraph() {
    const ctx = this.ctx;

    // ─── マスター出力段 ───
    this._compressor = ctx.createDynamicsCompressor();
    this._compressor.threshold.value = -16;
    this._compressor.knee.value = 10;
    this._compressor.ratio.value = 3.5;
    this._compressor.attack.value = 0.003;
    this._compressor.release.value = 0.25;
    this._compressor.connect(ctx.destination);

    this._masterGain = ctx.createGain();
    this._masterGain.gain.value = 0.8;
    this._masterGain.connect(this._compressor);

    this._masterFilter = ctx.createBiquadFilter();
    this._masterFilter.type = 'peaking';
    this._masterFilter.frequency.value = 1000;
    this._masterFilter.Q.value = 0.8;
    this._masterFilter.gain.value = 0;
    this._masterFilter.connect(this._masterGain);

    // ─── ドライ/ウェット分岐 ───
    this._dryGain = ctx.createGain();
    this._dryGain.gain.value = 1.0;
    this._dryGain.connect(this._masterFilter);

    // ショート残響パス
    this._convolverShort = ctx.createConvolver();
    this._convolverShort.buffer = this._buildIR(0.7, 1.8); // 0.7秒の減衰早い残響
    this._wetGainShort = ctx.createGain();
    this._wetGainShort.gain.value = 0;
    this._convolverShort.connect(this._wetGainShort);
    this._wetGainShort.connect(this._masterFilter);

    // ロング残響パス
    this._convolverLong = ctx.createConvolver();
    this._convolverLong.buffer = this._buildIR(4.5, 0.4);  // 4.5秒の大聖堂風残響
    this._wetGainLong = ctx.createGain();
    this._wetGainLong.gain.value = 0;
    this._convolverLong.connect(this._wetGainLong);
    this._wetGainLong.connect(this._masterFilter);

    // ─── ソースバス ───
    this._sourceBus = ctx.createGain();
    this._sourceBus.gain.value = 1.0;
    
    // ソースバスから各パスに接続
    this._sourceBus.connect(this._dryGain);
    this._sourceBus.connect(this._convolverShort);
    this._sourceBus.connect(this._convolverLong);
  }

  /**
   * 合成インパルスレスポンスを生成する
   * @param {number} duration - 残響時間（秒）
   * @param {number} decay    - 減衰係数
   */
  _buildIR(duration, decay) {
    const ctx = this.ctx;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buf = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        // ノイズに指数減衰をかけて滑らかなリバーブテールを作る
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay * 6.5);
      }
    }
    return buf;
  }

  /**
   * SpaceField を適用してDSPを更新する
   * 毎フレーム呼ばれる想定
   */
  applyField(field, playerX, playerY) {
    if (!this.started || !this.ctx) return;
    this._currentField = field;

    // ── Reverb クロスフェード (ノイズなし) ──
    const maxWet = field.reverb * 0.65; // 最大ウェット音量

    let shortLevel = 0;
    let longLevel = 0;

    if (field.reverb < 0.5) {
      const k = field.reverb / 0.5;
      shortLevel = k * maxWet;
      longLevel = 0;
    } else {
      const k = (field.reverb - 0.5) / 0.5;
      shortLevel = (1.0 - k) * maxWet;
      longLevel = k * maxWet;
    }

    // すでにCADS.js側で毎フレーム滑らかに補間されているため、直接代入することで
    // Web Audioのイベント衝突によるぶつぶつノイズを防止します。
    this._wetGainShort.gain.value = shortLevel;
    this._wetGainLong.gain.value = longLevel;
    this._dryGain.gain.value = 1.0 - maxWet * 0.45;

    // ── Master Filter (Reflection → EQ) ──
    const eqGain = (field.reflection - 0.5) * 8.0; // -4dB〜+4dB
    this._masterFilter.gain.value = eqGain;
    this._masterFilter.frequency.value = 450 + field.diffusion * 2400;

    // ── Master Gain (Occlusion → 音量低下) ──
    const vol = 0.55 + (1.0 - field.occlusion) * 0.45;
    this._masterGain.gain.value = vol * 0.85;

    // ── 音源に適用 ──
    if (this._sources) {
      this._sources.applyField(field, playerX, playerY);
    }
  }

  /** AudioContext を再開（バックグラウンドから復帰した場合など） */
  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  /** 停止・クリーンアップ */
  dispose() {
    if (this._sources) this._sources.dispose();
    if (this.ctx) this.ctx.close();
  }
}
