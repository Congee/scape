import type { ReactNode } from 'react';

export function Section({ title, aside, children, className }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `psec ${className}` : 'psec'}>
      {title && (
        <h2 className="psec-h">
          <span>{title}</span>
          {aside}
        </h2>
      )}
      <div className="psec-b">{children}</div>
    </section>
  );
}

/** Label column plus controls, ruled like the panel's rows. */
export function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="vrow">
      <span className="vrow-k">{label}</span>
      <div className="vrow-v">{children}</div>
    </div>
  );
}

// Which rows are open survives tab switches but not a reload.
const openRows = new Set<string>();

/** A collapsed row whose summary carries the current value; ids are panel-wide. */
export function Disclosure({ id, summary, summaryClass, children }: { id: string; summary: ReactNode; summaryClass?: string; children: ReactNode }) {
  return (
    <details
      className="disc"
      data-disc={id}
      open={openRows.has(id)}
      onToggle={(e) => {
        if (e.currentTarget.open) openRows.add(id);
        else openRows.delete(id);
      }}
    >
      <summary className={summaryClass}>{summary}</summary>
      {children}
    </details>
  );
}
