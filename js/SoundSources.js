/**
 * SoundSources.js — 手続き的音源 (Internalization ⇔ Externalization 連続体版)
 *
 * 【設計方針の転換：2D/3Dではなく「内在化(internalized)⇔外在化(externalized)」軸】
 * 音響心理学の externalization 研究（Hartmann & Wittenberg 1996 ほか）によれば、
 * 「頭の中で鳴っている感覚」と「頭の外の実世界にある感覚」は単一の連続次元であり、
 * ヘッドフォンでL/Rにハードパン（StereoPannerNodeでの直接パン）した音は
 * ITD/ILD/スペクトル手がかりが不自然なため、ほぼ確実に internalized（耳元で鳴る）側に
 * 倒れてしまうことが分かっている。過去のバージョンはまさにこの「ハードパン直通パス」を
 * 2Dの終端として使っており、それが「耳元でざーざー」という違和感の原因だった。
 *
 * 対策として、全ての音源経路を HRTF パンナー（externalized な手がかりを保つ）に統一し、
 * 「1点に集束した定位」と「外側に固定された拡散配置」の間を localization でクロスフェードする。
 * さらに全ての定位パンナー位置に、頭の微小な動きに相当する連続的なジッター
 * （motion parallax 相当）を常時加える。静止時にも音像が外に留まりやすくなることが
 * 研究で示されている（The Contribution of Head Movement to Externalization, PMC3846779）。
 *
 * 1. Drone (持続和音): 1点集束HRTFパンナー ⇔ 左右に固定配置した2本のHRTFパンナー（+ジッター）
 * 2. Ambient (環境風): 1点集束HRTFパンナー ⇔ L/R無相関ノイズを広い外部位置に置いた2本のHRTFパンナー
 * 3. Tones (サイン波粒子): 1点集束HRTFパンナー ⇔ 頭上に固定散布した各粒子専用HRTFパンナー
 * 4. Pulse (ソナーパルス): 1点集束HRTFパンナー ⇔ 左右交互に外部配置したHRTFパンナー（ピンポン）
 */

export class SoundSources {
  constructor(ctx, masterBus) {
    this.ctx = ctx;
    this.masterBus = masterBus;
    this.sources = [];
    this._built = false;
  }

  build() {
    if (this._built) return;
    this._built = true;

    this._buildDrone();
    this._buildAmbient();
    this._buildTones();
    this._buildPulse();
  }

  /**
   * 共通のベクトル歪み＆空間スケーリング処理
   */
  _calculateRelativeCoords(worldX, worldY, worldZ, playerX, playerY, field) {
    // 1. 基本的な相対座標 (Yは高さ、Zは前後)
    let dx = worldX - playerX;
    let dy = worldY;
    let dz = worldZ - playerY;

    // 2. DistanceScale (0=近い、1=遠い)
    const distMultiplier = Math.pow(8.0, (field.distanceScale - 0.5) * 2);

    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    let ux = dx / dist;
    let uy = dy / dist;
    let uz = dz / dist;

    // 3. Warp (空間の折れ曲がり)
    if (field.warp > 0.001) {
      const w = field.warp;
      ux += Math.sin(uz * 4.0 + w * 2.5) * w * 1.1;
      uy += Math.cos(ux * 4.0 + w * 1.8) * w * 0.6;
      uz += Math.sin(uy * 4.0 + w * 3.0) * w * 1.1;

      const uLen = Math.sqrt(ux*ux + uy*uy + uz*uz) || 1;
      ux /= uLen; uy /= uLen; uz /= uLen;
    }

    // 4. Width / Height / Depth スケーリング
    const wScale = field.width * 2.0;
    const hScale = field.height * 2.0;
    const dScale = field.depth * 2.0;

    const scaledDist = dist * distMultiplier;
    return {
      x: ux * scaledDist * wScale,
      y: uy * scaledDist * hScale,
      z: uz * scaledDist * dScale
    };
  }

  /**
   * 頭の微小な動き（motion parallax）相当の連続ジッターを計算する。
   * 静止していても音像が完全に静止しないことで、externalization が持続しやすくなる。
   */
  _motionJitter(seedX, seedY, seedZ, amount) {
    const t = this.ctx.currentTime;
    return {
      x: Math.sin(t * 0.37 + seedX) * amount,
      y: Math.sin(t * 0.23 + seedY) * amount * 0.5,
      z: Math.sin(t * 0.29 + seedZ) * amount,
    };
  }

  // ────────────────────────────────────────────────
  // ① Drone — 低周波持続音 (座標: 0, 0, 0)
  // ────────────────────────────────────────────────
  _buildDrone() {
    const ctx = this.ctx;

    // ─── 3D定位パス：1点に集束するHRTFパンナー ───
    const spatialPanner = ctx.createPanner();
    spatialPanner.panningModel = 'HRTF';
    spatialPanner.distanceModel = 'inverse';
    spatialPanner.refDistance = 15;
    const spatialBus = ctx.createGain();
    spatialBus.gain.value = 0;
    spatialPanner.connect(spatialBus);
    spatialBus.connect(this.masterBus);

    // ─── 拡散パス：左右の外部固定位置に置いた2本のHRTFパンナー ───
    const diffusePannerL = ctx.createPanner();
    const diffusePannerR = ctx.createPanner();
    [diffusePannerL, diffusePannerR].forEach(p => {
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 15;
    });
    const diffuseBus = ctx.createGain();
    diffuseBus.gain.value = 0;
    diffusePannerL.connect(diffuseBus);
    diffusePannerR.connect(diffuseBus);
    diffuseBus.connect(this.masterBus);

    // 2系統のオシレーター（わずかにデチューン）— 両パスへ同時に送る
    const oscL = ctx.createOscillator();
    const oscR = ctx.createOscillator();
    oscL.type = 'sawtooth';
    oscR.type = 'triangle';
    oscL.frequency.value = 55;
    oscR.frequency.value = 55.7;

    const fltL = ctx.createBiquadFilter();
    const fltR = ctx.createBiquadFilter();
    [fltL, fltR].forEach(f => {
      f.type = 'lowpass';
      f.frequency.value = 300;
      f.Q.value = 2;
    });

    const gainL = ctx.createGain();
    const gainR = ctx.createGain();
    [gainL, gainR].forEach(g => {
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 3);
    });

    oscL.connect(fltL); fltL.connect(gainL);
    oscR.connect(fltR); fltR.connect(gainR);

    // Lチャンネルの音は集束パンナーへも左外部パンナーへも同時に流す
    gainL.connect(spatialPanner); gainL.connect(diffusePannerL);
    gainR.connect(spatialPanner); gainR.connect(diffusePannerR);

    oscL.start();
    oscR.start();

    const worldX = 0, worldY = 0, worldZ = 0;

    this.sources.push({
      name: 'drone',
      oscL, oscR,
      update: (field, playerX, playerY) => {
        const baseFreq = 55 + field.warp * 45;
        oscL.frequency.value = baseFreq;
        oscR.frequency.value = baseFreq * 1.012 + field.warp * 12;

        const cutoff = 180 + field.reverb * 700;
        fltL.frequency.value = cutoff;
        fltR.frequency.value = cutoff;

        const vol = 0.10 + field.focus * 0.10;
        gainL.gain.value = vol;
        gainR.gain.value = vol;

        // 3D定位パスの実座標（1点）
        const rel = this._calculateRelativeCoords(worldX, worldY, worldZ, playerX, playerY, field);
        spatialPanner.positionX.value = rel.x;
        spatialPanner.positionY.value = rel.y;
        spatialPanner.positionZ.value = rel.z;

        // localization は座標ではなく「2経路の音量バランス」をクロスフェードする
        const loc = field.localization;
        spatialBus.gain.value = loc;
        diffuseBus.gain.value = (1.0 - loc);

        // 拡散パスも常にHRTFを通し、外部固定位置+ジッターで externalized を保つ
        const jL = this._motionJitter(0.0, 1.1, 2.2, 3);
        const jR = this._motionJitter(3.3, 4.4, 5.5, 3);
        diffusePannerL.positionX.value = -20 + jL.x;
        diffusePannerL.positionY.value = jL.y;
        diffusePannerL.positionZ.value = jL.z;
        diffusePannerR.positionX.value = 20 + jR.x;
        diffusePannerR.positionY.value = jR.y;
        diffusePannerR.positionZ.value = jR.z;
      }
    });
  }

  // ────────────────────────────────────────────────
  // ② Ambient noise — 環境風 (座標: 80, 15, 80 - 北東)
  // ────────────────────────────────────────────────
  _buildAmbient() {
    const ctx = this.ctx;

    // 1点集束パス用のパンナー
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 20;

    // 拡散パス：L/R無相関ノイズをそれぞれ外部の広い位置に置いたHRTFパンナーへ
    const diffusePannerL = ctx.createPanner();
    const diffusePannerR = ctx.createPanner();
    [diffusePannerL, diffusePannerR].forEach(p => {
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 20;
    });
    const splitter = ctx.createChannelSplitter(2);

    // L/Rで完全に無相関（デコリレート）されたステレオピンクノイズバッファ
    const bufSize = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, bufSize, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < bufSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + white*0.0555179;
        b1 = 0.99332*b1 + white*0.0750759;
        b2 = 0.96900*b2 + white*0.1538520;
        b3 = 0.86650*b3 + white*0.3104856;
        b4 = 0.55000*b4 + white*0.5329522;
        b5 = -0.7616*b5 - white*0.0168980;
        data[i] = (b0+b1+b2+b3+b4+b5+b6 + white*0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    // フィルター群
    const hipass = ctx.createBiquadFilter();
    hipass.type = 'highpass';
    hipass.frequency.value = 350;

    const lopass = ctx.createBiquadFilter();
    lopass.type = 'lowpass';
    lopass.frequency.value = 2500;

    // ルーティング分岐ゲイン
    // spatialGain: パンナーを通り、3D定位する
    // bypassGain: パンナーをスルーし、完全ステレオでマスターに直通
    const spatialGain = ctx.createGain();
    const bypassGain = ctx.createGain();

    src.connect(hipass);
    hipass.connect(lopass);
    
    // 1点集束パス
    lopass.connect(panner);
    panner.connect(spatialGain);
    spatialGain.connect(this.masterBus);

    // 拡散パス（L/R無相関ノイズをそれぞれ外部位置のHRTFパンナーへ。externalizedなまま広がる）
    lopass.connect(splitter);
    splitter.connect(diffusePannerL, 0);
    splitter.connect(diffusePannerR, 1);
    diffusePannerL.connect(bypassGain);
    diffusePannerR.connect(bypassGain);
    bypassGain.connect(this.masterBus);

    src.start();

    const worldX = 80, worldY = 15, worldZ = 80;

    this.sources.push({
      name: 'ambient',
      src,
      update: (field, playerX, playerY) => {
        lopass.frequency.value = 600 + field.diffusion * 4500;
        hipass.frequency.value = 80 + (1.0 - field.localization) * 500;

        const baseVol = 0.05 + field.width * 0.08;
        
        // Localization (1.0で1点集束パスのみ、0.0で外部拡散パスのみ)
        const loc = field.localization;
        spatialGain.gain.value = baseVol * loc;
        bypassGain.gain.value = baseVol * (1.0 - loc);

        // 1点集束パスの位置更新
        const rel = this._calculateRelativeCoords(worldX, worldY, worldZ, playerX, playerY, field);
        panner.positionX.value = rel.x;
        panner.positionY.value = rel.y;
        panner.positionZ.value = rel.z;

        // 拡散パスも外部固定位置+ジッターでexternalizedを保つ
        const jL = this._motionJitter(6.6, 7.7, 8.8, 4);
        const jR = this._motionJitter(9.9, 1.2, 3.4, 4);
        diffusePannerL.positionX.value = -25 + jL.x;
        diffusePannerL.positionY.value = 5 + jL.y;
        diffusePannerL.positionZ.value = jL.z;
        diffusePannerR.positionX.value = 25 + jR.x;
        diffusePannerR.positionY.value = 5 + jR.y;
        diffusePannerR.positionZ.value = jR.z;
      }
    });
  }

  // ────────────────────────────────────────────────
  // ③ Tones — サイン波粒子 (座標: -80, -10, 50 - 北西)
  // ────────────────────────────────────────────────
  _buildTones() {
    const ctx = this.ctx;
    const FREQS = [220, 330, 440, 528, 660, 880, 1100];
    
    // 各サイン波粒子（トーン）に、3D定位パスと2D散布パスを並走させる
    const toneParticles = [];

    // 拡散時、頭上を取り囲む散らばり位置（外部固定座標）
    const scatterCoords = [
      { x: -18, y:  2, z:  10 },
      { x:  18, y: -2, z: -10 },
      { x:   0, y: 15, z:   0 },
      { x: -12, y: -8, z: -18 },
      { x:  12, y:  8, z:  18 },
      { x:  -8, y: 12, z:  12 },
      { x:   8, y: -6, z:  -8 },
    ];

    const worldX = -80, worldY = -10, worldZ = 50;

    for (let i = 0; i < FREQS.length; i++) {
      const freq = FREQS[i];

      // 1点集束パス
      const spatialPanner = ctx.createPanner();
      spatialPanner.panningModel = 'HRTF';
      spatialPanner.distanceModel = 'inverse';
      spatialPanner.refDistance = 15;
      const spatialGain = ctx.createGain();
      spatialGain.gain.value = 0;
      spatialPanner.connect(spatialGain);
      spatialGain.connect(this.masterBus);

      // 拡散パス（外部固定散布位置のHRTFパンナー）
      const diffusePanner = ctx.createPanner();
      diffusePanner.panningModel = 'HRTF';
      diffusePanner.distanceModel = 'inverse';
      diffusePanner.refDistance = 15;
      const diffuseGain = ctx.createGain();
      diffuseGain.gain.value = 0;
      diffusePanner.connect(diffuseGain);
      diffuseGain.connect(this.masterBus);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      // LFO揺らぎ
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.08 + Math.random() * 0.25;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = freq * 0.004;

      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      const g = ctx.createGain();
      g.gain.value = 0.2 + Math.random() * 0.6; // 粒子ごとの相対音量係数

      osc.connect(g);
      g.connect(spatialPanner);
      g.connect(diffusePanner);

      osc.start();
      lfo.start();

      toneParticles.push({
        spatialPanner, spatialGain, diffusePanner, diffuseGain,
        osc, lfoGain, g, baseFreq: freq,
        scatter: scatterCoords[i], seed: i * 1.7,
      });
    }

    this.sources.push({
      name: 'tones',
      toneParticles,
      update: (field, playerX, playerY) => {
        const loc = field.localization;
        const focus = field.focus;

        // 3D定位パスの実座標（全粒子共通の1点）
        const rel = this._calculateRelativeCoords(worldX, worldY, worldZ, playerX, playerY, field);

        for (const t of toneParticles) {
          // Warpによるデチューン
          const detuned = t.baseFreq * (1.0 + (field.warp - 0.5) * 0.22);
          t.osc.frequency.value = detuned;
          t.lfoGain.gain.value = t.baseFreq * (0.001 + field.warp * 0.035);

          const vol = 0.045 * (0.3 + focus * 0.7);

          // 【融解ロジック】座標は動かさず、2経路の音量バランスだけをクロスフェード。
          // loc = 1.0: 全粒子が同一の1点に集束した音だけが鳴る。
          // loc = 0.0: 頭上に固定散布された各粒子の位置（+ジッター）だけが鳴る。
          t.spatialGain.gain.value = vol * loc;
          t.diffuseGain.gain.value = vol * (1.0 - loc);

          t.spatialPanner.positionX.value = rel.x;
          t.spatialPanner.positionY.value = rel.y;
          t.spatialPanner.positionZ.value = rel.z;

          const j = this._motionJitter(t.seed, t.seed + 10, t.seed + 20, 2);
          t.diffusePanner.positionX.value = t.scatter.x + j.x;
          t.diffusePanner.positionY.value = t.scatter.y + j.y;
          t.diffusePanner.positionZ.value = t.scatter.z + j.z;
        }
      }
    });
  }

  // ────────────────────────────────────────────────
  // ④ Pulse — リズミカルなソナーパルス (座標: 50, 5, -80 - 南東)
  // ────────────────────────────────────────────────
  _buildPulse() {
    const ctx = this.ctx;

    // 3D定位パス：常に固定の実世界座標から鳴るパンナー
    const spatialPanner = ctx.createPanner();
    spatialPanner.panningModel = 'HRTF';
    spatialPanner.distanceModel = 'inverse';
    spatialPanner.refDistance = 15;
    const spatialBus = ctx.createGain();
    spatialPanner.connect(spatialBus);
    spatialBus.connect(this.masterBus);

    // 拡散パス：毎回左右交互に外部固定位置へ切り替わるHRTFパンナー（ピンポン）
    const diffusePanner = ctx.createPanner();
    diffusePanner.panningModel = 'HRTF';
    diffusePanner.distanceModel = 'inverse';
    diffusePanner.refDistance = 15;
    const diffuseBus = ctx.createGain();
    diffusePanner.connect(diffuseBus);
    diffuseBus.connect(this.masterBus);

    let interval = 2.5;
    let lastTime = ctx.currentTime;
    let _field = null;
    let tickCount = 0;

    // ティック関数からアクセスするために、現在座標をクロージャに保存
    let currentX = 0;
    let currentY = 0;

    // 拡散時のピンポン位置（左右交互に跳ね返る、外部固定座標）
    const echoCoords = [
      { x: -16, y: 0, z:  2 },
      { x:  16, y: 0, z: -2 },
      { x:   0, y: 8, z: 12 },
      { x:  -5, y: -5, z: -10 },
    ];

    const worldX = 50, worldY = 5, worldZ = -80;

    const tick = () => {
      if (!_field) return;
      const now = ctx.currentTime;
      if (now - lastTime < interval) return;
      lastTime = now;
      tickCount++;

      const osc = ctx.createOscillator();
      const pulseFlt = ctx.createBiquadFilter();
      const pulseGain = ctx.createGain();

      osc.type = 'triangle';

      // ルックアヘッド
      const startTime = ctx.currentTime + 0.02;

      // ピッチスウィープ
      osc.frequency.setValueAtTime(320, startTime);
      osc.frequency.exponentialRampToValueAtTime(70, startTime + 0.5);

      pulseFlt.type = 'lowpass';
      pulseFlt.frequency.setValueAtTime(1400, startTime);
      pulseFlt.frequency.exponentialRampToValueAtTime(100 + _field.reflection * 600, startTime + 0.4);

      // スムーズエンベロープ
      pulseGain.gain.setValueAtTime(0, startTime);
      const maxVol = 0.12 + _field.reflection * 0.22;
      pulseGain.gain.linearRampToValueAtTime(maxVol, startTime + 0.015);
      pulseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.60);
      pulseGain.gain.linearRampToValueAtTime(0, startTime + 0.68);

      osc.connect(pulseFlt);
      pulseFlt.connect(pulseGain);
      pulseGain.connect(spatialPanner);
      pulseGain.connect(diffusePanner);

      // 【融解ロジック】座標は動かさず、2経路の音量バランスだけをクロスフェード。
      // 集束パスは常に固定の実世界座標から、拡散パスは毎回左右交互の外部位置から鳴る。
      const loc = _field.localization;
      spatialBus.gain.value = loc;
      diffuseBus.gain.value = (1.0 - loc);

      const rel = this._calculateRelativeCoords(worldX, worldY, worldZ, currentX, currentY, _field);
      spatialPanner.positionX.value = rel.x;
      spatialPanner.positionY.value = rel.y;
      spatialPanner.positionZ.value = rel.z;

      const echo = echoCoords[tickCount % echoCoords.length];
      const j = this._motionJitter(tickCount * 0.5, tickCount * 0.3, tickCount * 0.7, 2);
      diffusePanner.positionX.value = echo.x + j.x;
      diffusePanner.positionY.value = echo.y + j.y;
      diffusePanner.positionZ.value = echo.z + j.z;

      osc.start(startTime);
      osc.stop(startTime + 0.7);
    };

    const timer = setInterval(tick, 100);

    this.sources.push({
      name: 'pulse',
      timer,
      update: (field, playerX, playerY) => {
        _field = field;
        currentX = playerX;
        currentY = playerY;
        interval = 0.7 + (1.0 - field.depth) * 3.8;
      }
    });
  }

  applyField(field, playerX, playerY) {
    for (const s of this.sources) {
      s.update(field, playerX, playerY);
    }
  }

  dispose() {
    for (const s of this.sources) {
      try {
        if (s.timer) clearInterval(s.timer);
        if (s.oscL) { s.oscL.stop(); s.oscR.stop(); }
        if (s.src) s.src.stop();
        if (s.toneParticles) s.toneParticles.forEach(t => t.osc.stop());
      } catch (e) { }
    }
    this.sources = [];
    this._built = false;
  }
}
