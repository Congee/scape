import { useEffect, useMemo, useRef, useState } from 'react';
import { makeObserver } from '@core/astro/bodies';
import { calendarMarks, CalendarMarkKind, ECLIPSE_LABEL, type CalendarMark } from '@core/astro/calendar';
import { lunarCircumstances, solarCircumstances, type EclipseContact } from '@core/astro/eclipse';
import { compass, degrees } from '@core/format';
import { formatTime } from '@core/time/format';
import { isoDate, localMidnight, localParts } from '@core/time/localDay';
import { settingsStore, useSettings } from '@state/settings';
import { horizonKeyFor, useTerrain } from '@state/terrain';
import { useWorld, worldStore } from '@state/world';

const DAY_MS = 86_400_000;
const POP_W = 268;

/** Grid arithmetic is plain calendar maths, so it runs in UTC; only the marks are time-zone aware. */
const utcDay = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const utcIso = (d: Date) => isoDate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });

// 2024-01-01 was a Monday, so the week reads Monday-first.
const narrowDay = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((key, i) => ({ key, label: narrowDay.format(utcDay(2024, 1, 1 + i)) }));
const monthTitle = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

function Glyph({ kind, title }: { kind: CalendarMarkKind; title?: string }) {
  const quarter = kind === CalendarMarkKind.FirstQuarter || kind === CalendarMarkKind.LastQuarter;
  const eclipse = kind === CalendarMarkKind.SolarEclipse || kind === CalendarMarkKind.LunarEclipse;
  return (
    <svg className={`cal-glyph ${kind}`} viewBox="0 0 12 12" width="11" height="11" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {eclipse ? (
        <circle cx="6" cy="6" r="3.6" className="ring" />
      ) : (
        <>
          <circle cx="6" cy="6" r="4.2" className={kind === CalendarMarkKind.FullMoon ? 'lit' : 'dark'} />
          {quarter && <path d={kind === CalendarMarkKind.FirstQuarter ? 'M6 1.8A4.2 4.2 0 0 1 6 10.2Z' : 'M6 1.8A4.2 4.2 0 0 0 6 10.2Z'} className="lit" />}
        </>
      )}
    </svg>
  );
}

const signed = (deg: number) => `${deg >= 0 ? '+' : ''}${degrees(deg, 1)}`;

function contactNote(c: EclipseContact): string {
  if (c.visible) return '';
  return c.skylineDeg !== null && c.skylineDeg > 0 ? 'terrain' : 'below';
}

/** Contacts of one eclipse at the camera, each a button that moves the clock there. */
function EclipseDetail({ mark, lat, lng }: { mark: CalendarMark; lat: number; lng: number }) {
  const tz = useWorld((s) => s.tz);
  const hour12 = useSettings((s) => s.hour12);
  const time = useWorld((s) => s.time);
  const horizon = useTerrain((s) => s.horizon);
  const horizonKey = useTerrain((s) => s.horizonKey);
  const fresh = horizon && horizonKey === horizonKeyFor(worldStore.getState(), settingsStore.getState()) ? horizon : null;

  const solar = mark.kind === CalendarMarkKind.SolarEclipse;
  const obs = makeObserver({ lat, lng }, fresh?.eyeM ?? 0);
  const from = mark.timeMs - DAY_MS / 2;
  const c = solar ? solarCircumstances(obs, from, fresh?.profile) : lunarCircumstances(obs, from, fresh?.profile);
  const title = `${ECLIPSE_LABEL[c.kind]} ${solar ? 'solar' : 'lunar'} eclipse`;
  const stats =
    'magnitude' in c
      ? `magnitude ${c.magnitude.toFixed(3)} · ${(c.obscuration * 100).toFixed(1)} % covered`
      : `umbral ${c.umbralMagnitude.toFixed(3)} · penumbral ${c.penumbralMagnitude.toFixed(3)}`;
  return (
    <div className="cal-eclipse">
      <div className="cal-eclipse-head">
        <strong>{title}</strong>
        <span className="muted">{stats}</span>
      </div>
      <table>
        <tbody>
          {c.contacts.map((x) => (
            <tr key={x.kind} className={`${x.visible ? '' : 'hidden'}${Math.abs(time - x.timeMs) < 1000 ? ' on' : ''}`} onClick={() => worldStore.getState().setTime(x.timeMs)} title={`Set the clock to ${x.kind}`}>
              <td>{x.kind}</td>
              <td>{formatTime(x.timeMs, tz, hour12, true)}</td>
              <td>{signed(x.altitude)}</td>
              <td>
                {degrees(x.azimuth, 0)} {compass(x.azimuth)}
              </td>
              <td className="muted">{contactNote(x)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        {solar ? 'Sun' : 'Moon'} altitude and azimuth at each contact{fresh ? '; checked against the terrain skyline' : '; sea-level horizon (no terrain sweep)'}.
      </p>
    </div>
  );
}

/** Month grid popover marking the moon phases and locally visible eclipses. */
export function Calendar() {
  const [open, setOpen] = useState(false);
  const time = useWorld((s) => s.time);
  const tz = useWorld((s) => s.tz);
  const pin = useWorld((s) => s.pin);
  const hour12 = useSettings((s) => s.hour12);
  const box = useRef<HTMLDivElement>(null);

  const selected = isoDate(localParts(new Date(time), tz));
  const [ym, setYm] = useState(selected.slice(0, 7));
  // The popover is fixed, so the shell's clipped, wrapping header cannot cut it off.
  const [at, setAt] = useState({ top: 0, left: 0 });

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!open) {
      const r = e.currentTarget.getBoundingClientRect();
      const w = Math.min(POP_W, window.innerWidth - 16);
      setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
      setYm(selected.slice(0, 7));
    }
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const [year, month] = ym.split('-').map(Number);
  // The camera location only matters to a few hundred metres for eclipse visibility.
  const lat = Math.round(pin.lat * 1000) / 1000;
  const lng = Math.round(pin.lng * 1000) / 1000;

  const byDay = useMemo(() => {
    if (!open) return new Map<string, CalendarMark[]>();
    const from = localMidnight(year, month, 1, tz).getTime() - 7 * DAY_MS;
    const to = localMidnight(year, month + 1, 1, tz).getTime() + 7 * DAY_MS;
    const map = new Map<string, CalendarMark[]>();
    for (const m of calendarMarks(makeObserver({ lat, lng }), from, to, tz, { hour12 })) {
      const list = map.get(m.day);
      if (list) list.push(m);
      else map.set(m.day, [m]);
    }
    return map;
  }, [open, year, month, lat, lng, tz, hour12]);

  const eclipses = [...byDay.values()].flat().filter((m) => (m.kind === CalendarMarkKind.SolarEclipse || m.kind === CalendarMarkKind.LunarEclipse) && m.day.startsWith(ym));
  const today = isoDate(localParts(new Date(), tz));
  const lead = (utcDay(year, month, 1).getUTCDay() + 6) % 7;
  const days = utcDay(year, month + 1, 0).getUTCDate();
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => utcDay(year, month, 1 - lead + i));
  const shiftMonth = (n: number) => setYm(utcIso(utcDay(year, month + n, 1)).slice(0, 7));
  const pick = (iso: string) => {
    worldStore.getState().setDate(iso);
    setOpen(false);
  };

  return (
    <div className="cal" ref={box}>
      <button
        className={`cal-toggle${open ? ' on' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-label="Calendar"
        title="Month calendar with moon phases and eclipses"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 5h16v15H4zM4 10h16M9 3v4M15 3v4" />
        </svg>
      </button>
      {open && (
        <div className="cal-pop" role="dialog" aria-label="Calendar" style={{ top: at.top, left: at.left }}>
          <div className="cal-head">
            <button onClick={() => shiftMonth(-1)} title="Previous month">
              ‹
            </button>
            <strong>{monthTitle.format(utcDay(year, month, 1))}</strong>
            <button onClick={() => shiftMonth(1)} title="Next month">
              ›
            </button>
            <button onClick={() => pick(today)} title="Jump to today">
              Today
            </button>
          </div>
          <div className="cal-grid">
            {WEEKDAYS.map((w) => (
              <div key={w.key} className="cal-wd">
                {w.label}
              </div>
            ))}
            {cells.map((d) => {
              const iso = utcIso(d);
              const marks = byDay.get(iso) ?? [];
              const out = d.getUTCMonth() + 1 !== month;
              return (
                <button
                  key={iso}
                  className={`cal-day${out ? ' out' : ''}${iso === selected ? ' sel' : ''}${iso === today ? ' today' : ''}`}
                  onClick={() => pick(iso)}
                  aria-current={iso === selected ? 'date' : undefined}
                >
                  <span className="n">{d.getUTCDate()}</span>
                  <span className="marks">
                    {marks.map((m) => (
                      <Glyph key={m.kind} kind={m.kind} title={m.detail} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          {eclipses.map((m) => (
            <EclipseDetail key={m.timeMs} mark={m} lat={lat} lng={lng} />
          ))}
          <div className="cal-legend">
            <Glyph kind={CalendarMarkKind.NewMoon} /> new
            <Glyph kind={CalendarMarkKind.FullMoon} /> full
            <Glyph kind={CalendarMarkKind.FirstQuarter} />
            <Glyph kind={CalendarMarkKind.LastQuarter} /> quarters
            <Glyph kind={CalendarMarkKind.SolarEclipse} /> eclipse
          </div>
        </div>
      )}
    </div>
  );
}
