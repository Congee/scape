import { useState } from 'react';
import { GeodeticsPanel } from './GeodeticsPanel';
import { LayersPanel } from './LayersPanel';
import { LiveReadout } from './LiveReadout';
import { Timeline } from './Timeline';

type Tab = 'timeline' | 'geodetics' | 'layers';

export function Panel() {
  const [tab, setTab] = useState<Tab>('timeline');
  return (
    <div className="panel-inner">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'timeline'} className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>
          Timeline
        </button>
        <button role="tab" aria-selected={tab === 'geodetics'} className={tab === 'geodetics' ? 'active' : ''} onClick={() => setTab('geodetics')}>
          Geodetics
        </button>
        <button role="tab" aria-selected={tab === 'layers'} className={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}>
          Layers
        </button>
      </div>
      <div className="tab-body">
        {tab === 'timeline' && (
          <>
            <LiveReadout />
            <Timeline />
          </>
        )}
        {tab === 'geodetics' && <GeodeticsPanel />}
        {tab === 'layers' && <LayersPanel />}
      </div>
    </div>
  );
}
