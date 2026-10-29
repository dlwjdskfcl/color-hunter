'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { readableOn } from '@/lib/color-ui';

type Variant = 'primary' | 'secondary' | 'dark' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-sun text-ink',
  secondary: 'bg-white text-ink',
  dark: 'bg-ink text-white',
  danger: 'bg-tomato text-white',
  ghost: 'bg-transparent text-ink border-transparent! shadow-none!',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'min-h-10 px-3 text-sm rounded-xl',
    md: 'min-h-12 px-5 text-base rounded-2xl',
    lg: 'min-h-16 px-6 text-xl rounded-2xl',
  };
  return (
    <button
      type="button"
      className={`pop inline-flex items-center justify-center gap-2 whitespace-nowrap border-[3px] border-ink font-bold select-none disabled:opacity-45 disabled:cursor-not-allowed ${VARIANTS[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-3xl border-[3px] border-ink bg-white shadow-pop ${className}`}>{children}</section>;
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="불러오는 중"
      className={`inline-block size-5 animate-spin rounded-full border-[3px] border-ink border-t-transparent ${className}`}
    />
  );
}

/** 색 견본: 색 이름과 코드를 항상 함께 표시 (색약 사용자 배려) */
export function Swatch({
  hex,
  name,
  size = 'md',
  sub,
  className = '',
}: {
  hex: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  sub?: ReactNode;
  className?: string;
}) {
  const box = { sm: 'size-10 rounded-xl', md: 'size-16 rounded-2xl', lg: 'size-24 rounded-3xl', xl: 'size-36 rounded-[2rem]' }[size];
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className={`${box} shrink-0 border-[3px] border-ink shadow-pop-sm`} style={{ background: hex }} aria-hidden />
      {(name || sub) && (
        <div className="min-w-0">
          {name && <div className={`font-display leading-tight ${size === 'xl' || size === 'lg' ? 'text-3xl' : 'text-xl'}`}>{name}</div>}
          {sub && <div className="text-sm text-muted">{sub}</div>}
        </div>
      )}
    </div>
  );
}

export function TeamTag({ name, color, className = '' }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-2.5 py-0.5 text-sm font-bold ${className}`}
      style={{ background: color, color: readableOn(color) }}
    >
      {name}
    </span>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-2xl border-[3px] border-ink bg-white p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-xl px-2 text-sm font-bold transition-colors ${
            value === o.value ? 'bg-ink text-white' : 'text-ink hover:bg-paper'
          } disabled:opacity-50`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-3 text-left font-bold"
    >
      <span>{label}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full border-[3px] border-ink transition-colors ${checked ? 'bg-leaf' : 'bg-line'}`}>
        <span
          className={`absolute top-0.5 size-4 rounded-full border-2 border-ink bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const bg = { info: 'bg-sky/15', warn: 'bg-sun/30', error: 'bg-tomato/15' }[tone];
  return <div className={`rounded-2xl border-2 border-ink px-4 py-3 text-sm ${bg}`}>{children}</div>;
}
