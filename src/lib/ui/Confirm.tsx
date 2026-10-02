import { useEffect, useRef, useState, type ReactNode } from 'react';

interface AskProps {
  question: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The question in place, with a danger button and Cancel; Esc cancels. */
export function ConfirmAsk({ question, confirm, onConfirm, onCancel }: AskProps) {
  return (
    <span
      className="confirm"
      role="group"
      aria-label={question}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onCancel();
      }}
    >
      <span className="confirm-q">{question}</span>
      <button className="btn danger" autoFocus onClick={onConfirm}>
        {confirm}
      </button>
      <button className="btn" onClick={onCancel}>
        Cancel
      </button>
    </span>
  );
}

interface Props {
  question: string;
  confirm: string;
  onConfirm: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
  disabled?: boolean;
}

/** A trigger that asks in place before running a destructive action. */
export function Confirm({ question, confirm, onConfirm, children, className = 'link', title, disabled }: Props) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  // Back on the trigger after Cancel, so keyboard focus is not lost.
  useEffect(() => {
    if (!asking && asked.current) trigger.current?.focus();
    asked.current = asking;
  }, [asking]);
  if (asking)
    return (
      <ConfirmAsk
        question={question}
        confirm={confirm}
        onConfirm={() => {
          setAsking(false);
          onConfirm();
        }}
        onCancel={() => setAsking(false)}
      />
    );
  return (
    <button ref={trigger} className={className} title={title} disabled={disabled} onClick={() => setAsking(true)}>
      {children}
    </button>
  );
}
