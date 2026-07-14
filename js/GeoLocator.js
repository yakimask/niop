/**
 * GeoLocator.js — GPS取得・メートル変換・スムージング
 *
 * 最初に取得した位置を原点(0,0)とし、
 * 以降の位置を相対メートル座標に変換する。
 */

export class GeoLocator {
  constructor() {
    this.originLat = null;
    this.originLon = null;

    // スムージング済み現在位置（メートル）
    this.x = 0;
    this.y = 0;

    // 生の位置
    this._rawX = 0;
    this._rawY = 0;

    this.accuracy = Infinity; // 精度（メートル）
    this.watching = false;
    this.watchId  = null;
    this.error    = null;

    this._onUpdate = null; // コールバック
    this._alpha = 0.25;    // EMA スムージング係数（0に近いほどゆっくり）

    // 最終取得タイムスタンプ
    this.lastTimestamp = 0;
    this.supported = !!navigator.geolocation;
  }

  /** GPS監視開始 */
  start(onUpdate) {
    if (!this.supported) {
      this.error = 'Geolocation API is not supported';
      return;
    }
    this._onUpdate = onUpdate;
    this.watching = true;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._onPosition(pos),
      (err) => this._onError(err),
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      }
    );
  }

  /** GPS監視停止 */
  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.watching = false;
  }

  /** 手動で位置をセットする（仮想移動モード用） */
  setManualMeters(x, y) {
    this._rawX = x;
    this._rawY = y;
    this.accuracy = 0;
    this.lastTimestamp = Date.now();
    this._smooth();
    if (this._onUpdate) this._onUpdate(this.x, this.y, this.accuracy);
  }

  _onPosition(pos) {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    this.accuracy = pos.coords.accuracy;
    this.lastTimestamp = pos.timestamp;

    // 原点設定（初回のみ）
    if (this.originLat === null) {
      this.originLat = lat;
      this.originLon = lon;
      this._rawX = 0;
      this._rawY = 0;
    } else {
      const [mx, my] = GeoLocator.latLonToMeters(lat, lon, this.originLat, this.originLon);
      this._rawX = mx;
      this._rawY = my;
    }

    this._smooth();
    if (this._onUpdate) this._onUpdate(this.x, this.y, this.accuracy);
  }

  _onError(err) {
    this.error = err.message;
    console.warn('GeoLocator error:', err);
  }

  _smooth() {
    this.x += (this._rawX - this.x) * this._alpha;
    this.y += (this._rawY - this.y) * this._alpha;
  }

  /** GPS精度カテゴリ */
  get accuracyLabel() {
    if (this.accuracy <= 5)   return 'EXCELLENT';
    if (this.accuracy <= 20)  return 'GOOD';
    if (this.accuracy <= 100) return 'FAIR';
    if (this.accuracy <= 500) return 'POOR';
    return 'UNAVAILABLE';
  }

  /**
   * lat/lon → 相対メートル変換（Haversine近似）
   * @returns [x_east, y_north] (メートル)
   */
  static latLonToMeters(lat, lon, originLat, originLon) {
    const R = 6371000; // 地球半径 (m)
    const dLat = (lat - originLat) * Math.PI / 180;
    const dLon = (lon - originLon) * Math.PI / 180;
    const avgLat = (lat + originLat) * 0.5 * Math.PI / 180;
    const x = dLon * R * Math.cos(avgLat);
    const y = dLat * R;
    return [x, y];
  }
}
