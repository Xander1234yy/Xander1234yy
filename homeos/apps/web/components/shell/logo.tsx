export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="hl" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9cc0ff" />
          <stop offset="1" stopColor="#3b7bf5" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="#0d1528" />
      <rect x="0.5" y="0.5" width="63" height="63" rx="17.5" fill="none" stroke="rgba(255,255,255,0.08)" />
      <path d="M16 31.5 32 18l16 13.5V46a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V31.5Z" fill="none" stroke="url(#hl)" strokeWidth="3.5" strokeLinejoin="round" />
      <circle cx="32" cy="36" r="4.5" fill="url(#hl)" />
    </svg>
  );
}
