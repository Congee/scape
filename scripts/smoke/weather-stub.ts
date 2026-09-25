// Serves Open-Meteo from a deterministic fixture through CDP Fetch interception, and counts what the page asked.
import { forecastBody } from '../../src/lib/core/weather/fixture';
import type { HourlyVar } from '../../src/lib/core/weather/openMeteo';
import type { Tab } from './cdp';

export const StubMode = { Fixture: 'Fixture', Fail: 'Fail', Error: 'Error', Live: 'Live' } as const;
export type StubMode = (typeof StubMode)[keyof typeof StubMode];

export interface Hit {
  url: string;
  at: number;
  locations: number;
  vars: number;
  model: string;
  live: boolean;
}

const DAY_MS = 86_400_000;
const dateMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Cloud that thickens westward over the sea from Rotterdam, so a sunset sightline differs from overhead. */
export function fixtureValue(v: HourlyVar, hour: number, lat: number, lng: number, model: string): number | null {
  const west = Math.min(1, Math.max(0, (4.4 - lng) / 0.5));
  const wave = 0.5 + 0.5 * Math.sin(lat * 3 + lng * 2 + hour / 5);
  const shift = model === 'best_match' ? 0 : 20;
  switch (v) {
    case 'cloud_cover_low':
      return Math.round(95 * west);
    case 'cloud_cover_mid':
      return Math.round(Math.min(100, 30 * wave + shift));
    case 'cloud_cover_high':
      return Math.round(60 + 30 * wave);
    case 'cloud_cover':
      return Math.round(Math.min(100, 90 * west + 30 * wave + 20));
    case 'visibility':
      if (model === 'ecmwf_ifs025') return null;
      return hour % 24 < 6 ? 600 : hour % 24 < 8 ? 3000 : 24000;
    case 'weather_code':
      return hour % 24 < 6 ? 45 : 3;
    case 'precipitation':
      return 0.2 * wave;
    case 'precipitation_probability':
      return Math.round(40 * wave);
    case 'temperature_2m':
      return 12 + 4 * Math.sin(((hour % 24) - 8) / 3.8);
    case 'dew_point_2m':
      return 9;
    case 'relative_humidity_2m':
      return 80;
    case 'wind_speed_10m':
      return 14;
    case 'wind_gusts_10m':
      return 28;
  }
  return null;
}

export class OpenMeteoStub {
  mode: StubMode = StubMode.Fixture;
  /** Live mode passes this many requests through, then falls back to the fixture. */
  liveLeft = 0;
  /** meta.json's last_run_availability_time, epoch ms; unset leaves it out. */
  availableAt: number | null = null;
  /** Overrides the fixture per forecast request. */
  value: ((v: HourlyVar, hour: number, lat: number, lng: number, model: string) => number | null) | null = null;
  readonly hits: Hit[] = [];

  constructor(private tab: Tab) {}

  async install() {
    this.tab.listeners.push((m, p) => {
      if (m === 'Fetch.requestPaused') void this.paused(p as { requestId: string; request: { url: string } }).catch((e: unknown) => console.error('stub:', e));
    });
    await this.tab.send('Fetch.enable', { patterns: [{ urlPattern: '*api.open-meteo.com*', requestStage: 'Request' }] });
  }

  forecasts(since = 0) {
    return this.hits.filter((h) => h.at >= since && h.url.includes('/v1/forecast'));
  }

  private async paused({ requestId, request }: { requestId: string; request: { url: string } }) {
    const u = new URL(request.url);
    const lats = (u.searchParams.get('latitude') ?? '').split(',').filter(Boolean).map(Number);
    const lngs = (u.searchParams.get('longitude') ?? '').split(',').filter(Boolean).map(Number);
    const vars = (u.searchParams.get('hourly') ?? '').split(',').filter(Boolean) as HourlyVar[];
    const model = u.searchParams.get('models') ?? 'best_match';
    const live = this.mode === StubMode.Live && this.liveLeft > 0;
    this.hits.push({ url: request.url, at: Date.now(), locations: lats.length, vars: vars.length, model, live });
    if (live) {
      this.liveLeft--;
      await this.tab.send('Fetch.continueRequest', { requestId });
      return;
    }
    if (this.mode === StubMode.Fail) {
      await this.tab.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
      return;
    }
    let status = 200;
    let body: unknown;
    if (u.pathname.endsWith('/meta.json')) {
      body = { last_run_initialisation_time: Math.floor((Date.now() - 5 * 3_600_000) / 3_600_000) * 3600, update_interval_seconds: 3600 };
      if (this.availableAt !== null) Object.assign(body as object, { last_run_availability_time: Math.floor(this.availableAt / 1000) });
    } else if (this.mode === StubMode.Error) {
      status = 500;
      body = { error: true, reason: 'stub server error' };
    } else {
      const start = u.searchParams.get('start_date') ?? '';
      const end = u.searchParams.get('end_date') ?? start;
      const today = dateMs(new Date().toISOString().slice(0, 10));
      if (dateMs(start) < today - 92 * DAY_MS || dateMs(end) > today + 15 * DAY_MS) {
        status = 400;
        body = { error: true, reason: "Parameter 'start_date' is out of allowed range" };
      } else {
        const hours = Math.round((dateMs(end) - dateMs(start)) / 3_600_000) + 24;
        const h0 = Math.round((dateMs(start) - today) / 3_600_000);
        // Past the fixture's 10-day horizon the hours are null, like a model running out.
        body = forecastBody(lats.map((lat, i) => ({ lat, lng: lngs[i] })), start, hours, vars, (v, h, i) => (h0 + h > 240 ? null : (this.value ?? fixtureValue)(v, h, lats[i], lngs[i], model)));
      }
    }
    await this.tab.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: status,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Access-Control-Allow-Origin', value: '*' }
      ],
      body: Buffer.from(JSON.stringify(body)).toString('base64')
    });
  }
}
