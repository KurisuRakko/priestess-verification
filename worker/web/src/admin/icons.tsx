/** Line icons for the console; all follow `currentColor`. */

const STROKE = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** The brand mark: a shield with a check. */
export function MarkIcon() {
  return (
    <svg {...STROKE} strokeWidth={2}>
      <path d="M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6z" />
      <path d="M8.8 12.2l2.2 2.2 4.2-4.4" />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg {...STROKE}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg {...STROKE}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.8}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg {...STROKE}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

export function LogoutIcon() {
  return (
    <svg {...STROKE}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 16l-4-4 4-4M6 12h10" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg {...STROKE} width={12} height={12} strokeWidth={2}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function SelectArrowIcon() {
  return (
    <svg {...STROKE} width={12} height={12} strokeWidth={2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
