import { useEffect, useId, useState } from 'react';
import { formatLngLat, parseLngLat } from '@core/geo/coords';
import { geocode, type GeocodeHit } from '@data/geocode';
import { useSettings } from '@state/settings';
import { worldStore } from '@state/world';
import { Icon } from './icons';
import { SearchAction, searchKey, searchStatus } from './searchKeys';
import { useOnline } from './useOnline';

interface Remote {
  query: string;
  hits: GeocodeHit[];
}

export function Search() {
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<Remote>({ query: '', hits: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const format = useSettings((s) => s.coordFormat);
  const online = useOnline();
  const id = useId();

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
  const status = searchStatus({ text, coord: !!coord, searching: remote.query !== text, count: hits.length });
  const offline = !online && !coord && text.length >= 2;
  const shown = open && (hits.length > 0 || !!status);
  const announce = !open || coord || text.length < 2 ? '' : (status ?? `${hits.length} result${hits.length === 1 ? '' : 's'}`);

  const close = () => {
    setQ('');
    setOpen(false);
    setActive(-1);
  };

  const pick = (h: GeocodeHit) => {
    const w = worldStore.getState();
    const p = { lat: h.lat, lng: h.lng };
    w.setPin(p);
    w.flyTo(p, Math.max(w.view.zoom, 11));
    close();
  };

  const setTarget = (h: GeocodeHit) => {
    worldStore.getState().setPin2({ lat: h.lat, lng: h.lng });
    close();
  };

  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div
      className="search"
      onBlur={(e) => {
        // Focus moving to a Target button stays inside the search.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      <Icon name="search" />
      <input
        type="search"
        role="combobox"
        placeholder="Search a place or paste coordinates"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          const r = searchKey({ open, active }, e.key, e.shiftKey, hits.length);
          if (!r.handled) return;
          e.preventDefault();
          if (r.action === SearchAction.Pick) return pick(hits[r.index]);
          if (r.action === SearchAction.Target) return setTarget(hits[r.index]);
          setOpen(r.open);
          setActive(r.active);
        }}
        aria-label="Search"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-activedescendant={shown && active >= 0 && active < hits.length ? optionId(active) : undefined}
        title="↑/↓ to choose, Enter to go there, Shift+Enter to set as the target"
      />
      {shown && (
        // Keeps focus in the input, so picking never races its blur.
        <div className="search-results" onMouseDown={(e) => e.preventDefault()}>
          {offline && <p className="search-status">Offline: showing built-in places only</p>}
          <ul id={`${id}-list`} role="listbox" aria-label="Search results">
            {status && (
              <li role="option" aria-selected={false} aria-disabled="true" className="search-status">
                {status}
              </li>
            )}
            {hits.map((h, i) => (
              <li key={`${h.name}|${h.lat}|${h.lng}`} role="none" className={i === active ? 'active' : undefined}>
                <div id={optionId(i)} role="option" aria-selected={i === active} className="text" onClick={() => pick(h)} onPointerEnter={() => setActive(i)}>
                  <span className="name">{h.name}</span>
                  {h.detail && <span className="detail">{h.detail}</span>}
                </div>
                <button className="btn-link" title="Set as the target location" aria-label={`Set ${h.name} as the target`} onClick={() => setTarget(h)}>
                  Target
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
