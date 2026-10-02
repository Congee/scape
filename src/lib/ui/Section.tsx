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
