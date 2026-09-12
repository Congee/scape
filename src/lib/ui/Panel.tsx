import { useState } from 'react';
import { GeodeticsPanel } from './GeodeticsPanel';
import { LayersPanel } from './LayersPanel';
import { LiveReadout } from './LiveReadout';
import { Timeline } from './Timeline';

const Tab = { Timeline: 'Timeline', Geodetics: 'Geodetics', Layers: 'Layers' } as const;
type Tab = (typeof Tab)[keyof typeof Tab];

export function Panel() {
  const [tab, setTab] = useState<Tab>(Tab.Timeline);
  return (
    <div className="panel-inner">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === Tab.Timeline} className={tab === Tab.Timeline ? 'active' : ''} onClick={() => setTab(Tab.Timeline)}>
          Timeline
        </button>
        <button role="tab" aria-selected={tab === Tab.Geodetics} className={tab === Tab.Geodetics ? 'active' : ''} onClick={() => setTab(Tab.Geodetics)}>
          Geodetics
        </button>
        <button role="tab" aria-selected={tab === Tab.Layers} className={tab === Tab.Layers ? 'active' : ''} onClick={() => setTab(Tab.Layers)}>
          Layers
        </button>
      </div>
      <div className="tab-body">
        {tab === Tab.Timeline && (
          <>
            <LiveReadout />
            <Timeline />
          </>
        )}
        {tab === Tab.Geodetics && <GeodeticsPanel />}
        {tab === Tab.Layers && <LayersPanel />}
      </div>
    </div>
  );
}
