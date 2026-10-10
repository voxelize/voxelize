import type { ReactNode } from "react";

import { css, type Rgb } from "./math";

import "./oit.css";

export function Figure({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="oit-figure">
      <figcaption className="oit-figure__title">{title}</figcaption>
      {children}
      {caption && <p className="oit-figure__caption">{caption}</p>}
    </figure>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="oit-card">{children}</div>;
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="oit-slider">
      <span className="oit-slider__label">
        <span>{label}</span>
        <span className="oit-slider__value">{format(value)}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function Swatch({
  title,
  color,
  note,
}: {
  title: string;
  color: Rgb;
  note: string;
}) {
  return (
    <div className="oit-card">
      <div className="text-xs font-semibold mb-2">{title}</div>
      <div className="oit-swatch" style={{ background: css(color) }} />
      <div className="text-xs mt-2 opacity-70">{note}</div>
    </div>
  );
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="oit-choice" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={
            option.value === value
              ? "oit-choice__option oit-choice__option--active"
              : "oit-choice__option"
          }
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
