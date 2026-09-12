import { useEffect, useState } from 'react';
import { formatLngLat, parseLngLat } from '@core/geo/coords';
import { geocode, type GeocodeHit } from '@data/geocode';
import { useSettings } from '@state/settings';
import { worldStore } from '@state/world';

interface Remote {
  query: string;
  hits: GeocodeHit[];
}

export function Search() {
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<Remote>({ query: '', hits: [] });
  const [open, setOpen] = useState(false);
  const format = useSettings((s) => s.coordFormat);

  const text = q.trim();
  const coord = text.length >= 3 ? parseLngLat(text) : null;

  useEffect(() => {
    if (coord || text.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      void geocode(text, ctrl.signal).then((hits) => {
        if (!ctrl.signal.aborted) setRemote({ query: text, hits });
      });
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text, coord]);

  const hits: GeocodeHit[] = coord
    ? [{ ...coord, name: formatLngLat(coord, format), detail: 'Coordinates' }]
    : remote.query === text
      ? remote.hits
      : [];

  const pick = (h: GeocodeHit) => {
    const w = worldStore.getState();
    const p = { lat: h.lat, lng: h.lng };
    w.setPin(p);
    w.flyTo(p, Math.max(w.view.zoom, 11));
    setQ('');
    setOpen(false);
  };

  const setTarget = (h: GeocodeHit) => {
    worldStore.getState().setPin2({ lat: h.lat, lng: h.lng });
    setQ('');
    setOpen(false);
  };

  return (
    <div className="search">
      <input
        type="search"
        placeholder="Search a place or paste coordinates"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) pick(hits[0]);
          if (e.key === 'Escape') setOpen(false);
        }}
        aria-label="Search"
      />
      {open && hits.length > 0 && (
        <ul className="search-results" role="listbox">
          {hits.map((h) => (
            <li key={`${h.name}|${h.lat}|${h.lng}`} role="option" aria-selected={false} onMouseDown={() => pick(h)}>
              <div className="text">
                <span className="name">{h.name}</span>
                {h.detail && <span className="detail">{h.detail}</span>}
              </div>
              <button
                className="link"
                title="Set as the target location"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setTarget(h);
                }}
              >
                Target
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
