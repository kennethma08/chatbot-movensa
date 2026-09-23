import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { AlertCircle, Inbox, LoaderCircle, Plus } from 'lucide-react';

export function Button({ className = '', variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button className={`button button--${variant} ${className}`} {...props} />;
}

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Badge({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'orange' | 'green' | 'red' | 'blue' }>) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="page-header">
    <div>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p className="page-description">{description}</p>}
    </div>
    {action && <div className="page-header__action">{action}</div>}
  </header>;
}

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return <div className="state-block" role="status"><LoaderCircle className="spin" size={22} /><span>{label}</span></div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-state__icon"><Inbox size={22} /></span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="error-state" role="alert"><AlertCircle size={20} /><div><strong>No pudimos cargar esta sección</strong><p>{message}</p>{onRetry && <Button variant="secondary" onClick={onRetry}>Reintentar</Button>}</div></div>;
}

export function PrimaryAction({ children = 'Nuevo', onClick }: { children?: ReactNode; onClick?: () => void }) {
  return <Button onClick={onClick}><Plus size={16} />{children}</Button>;
}

export function Field({ label, hint, children }: PropsWithChildren<{ label: string; hint?: string }>) {
  return <label className="field"><span className="field__label">{label}</span>{children}{hint && <span className="field__hint">{hint}</span>}</label>;
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return <div className="skeleton-list" aria-label="Cargando">{Array.from({ length: count }, (_, index) => <div className="skeleton-row" key={index}><span /><span /><span /></div>)}</div>;
}
