export const NOW = Date.parse('2026-10-07T06:00:00Z');         // İstanbul (UTC+3) 09:00
export const OFF = 10800;
const pad = (n) => (n < 10 ? '0' : '') + n;
// Open-Meteo "past_hours=6&forecast_hours=36" biçiminde tek konumluk tahmin. f(i, hourOfDay, k) → alan geçersiz kılma; k = şimdiye göre saat (-6..35)
export function mkFc(f = () => ({}), opts = {}) {
  const h = { time: [], temperature_2m: [], apparent_temperature: [], precipitation: [], rain: [], showers: [], snowfall: [], precipitation_probability: [], weather_code: [], wind_speed_10m: [], wind_gusts_10m: [], uv_index: [], pressure_msl: [], cape: [], lifted_index: [], convective_inhibition: [], freezing_level_height: [] };
  const base = Date.parse('2026-10-07T03:00:00Z') + (opts.shiftH || 0) * 3600000;   // yerel 06:00 = now-3h ... ama aşağıda k ile hizalanır
  for (let k = -6; k < 36; k++) {
    const localMs = NOW + OFF * 1000 + k * 3600000, d = new Date(localMs);
    const t = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':00';
    const o = Object.assign({ temperature_2m: 18, apparent_temperature: 17, precipitation: 0, rain: 0, showers: 0, snowfall: 0, precipitation_probability: 10, weather_code: 1, wind_speed_10m: 12, wind_gusts_10m: 25, uv_index: 2, pressure_msl: null, cape: null, lifted_index: null, convective_inhibition: null, freezing_level_height: null }, f(k, d.getUTCHours()) || {});
    h.time.push(t); Object.keys(o).forEach((key) => h[key].push(o[key]));
  }
  return { utc_offset_seconds: OFF, hourly: h };
}
export const mkAq = (f = () => 30) => {
  const time = [], v = [];
  for (let k = 0; k < 12; k++) { const d = new Date(NOW + OFF * 1000 + k * 3600000); time.push(d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':00'); v.push(f(k)); }
  return { utc_offset_seconds: OFF, hourly: { time, european_aqi: v } };
};
export const city = { name: 'İstanbul', lat: 41.01, lon: 28.95 };
// 5 yıllık sahte arşiv: sabit max/min
export function mkArch(max, min) {
  const n = 5 * 365, start = '2021-09-30'; return { start, max: new Array(n).fill(max), min: new Array(n).fill(min) };
}
export class FakeKV {
  constructor() { this.m = new Map(); this.writes = 0; this.reads = 0; }
  async get(k, type) { this.reads++; const v = this.m.get(k); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); }
  async put(k, v) { this.writes++; this.m.set(k, v); }
}
