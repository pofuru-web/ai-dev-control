import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const inputCls = 'w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400';

export function Card({ title, children, right, className = '' }: { title?: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-700 bg-slate-900/70 p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold tracking-wide text-slate-300">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = 'primary' | 'ghost' | 'danger' | 'ok';
const tones: Record<Tone, string> = {
  primary: 'bg-sky-600 hover:bg-sky-500 text-white',
  ghost: 'border border-slate-600 text-slate-200 hover:bg-slate-800',
  danger: 'bg-rose-700 hover:bg-rose-600 text-white',
  ok: 'bg-emerald-600 hover:bg-emerald-500 text-white',
};
export function Btn({ tone = 'ghost', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return <button type="button" {...p} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const badgeTones = { slate: 'bg-slate-700 text-slate-200', green: 'bg-emerald-900 text-emerald-200', amber: 'bg-amber-900 text-amber-200', red: 'bg-rose-900 text-rose-200', blue: 'bg-sky-900 text-sky-200', purple: 'bg-violet-900 text-violet-200' };
export function Badge({ tone = 'slate', children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>{children}</span>;
}

export function Banner({ tone, title, children, actions }: { tone: 'error' | 'warn' | 'info'; title: string; children?: ReactNode; actions?: ReactNode }) {
  const c = tone === 'error' ? 'border-rose-500 bg-rose-950 text-rose-100' : tone === 'warn' ? 'border-amber-500 bg-amber-950 text-amber-100' : 'border-sky-500 bg-sky-950 text-sky-100';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md border px-4 py-3 text-sm ${c}`}>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 space-y-1">{children}</div>}
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="mt-10 w-full max-w-lg rounded-lg border border-slate-600 bg-slate-900 p-5 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ title, body, confirmLabel, tone = 'danger', onConfirm, onCancel }: { title: string; body: ReactNode; confirmLabel: string; tone?: Tone; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="mb-4 space-y-2 text-sm text-slate-300">{body}</div>
      <div className="flex justify-end gap-2">
        <Btn onClick={onCancel}>キャンセル</Btn>
        <Btn tone={tone} onClick={onConfirm}>{confirmLabel}</Btn>
      </div>
    </Modal>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-md border border-dashed border-slate-700 p-4 text-sm text-slate-400">{children}</p>;
