import { useState } from 'react';
import { LayersPanel } from './LayersPanel';
import { LiveReadout } from './LiveReadout';
import { Timeline } from './Timeline';

type Tab = 'timeline' | 'layers';

export function Panel() {
  const [tab, setTab] = useState<Tab>('timeline');
  return (
    <div className="panel-inner">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'timeline'} className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>
          Timeline
        </button>
        <button role="tab" aria-selected={tab === 'layers'} className={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}>
          Layers
        </button>
      </div>
      <div className="tab-body">{tab === 'timeline' ? (
          <>
            <LiveReadout />
            <Timeline />
          </>
        ) : (
          <LayersPanel />
        )}</div>
    </div>
  );
}
