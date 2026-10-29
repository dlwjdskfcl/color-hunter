export function LogoMark({ className = 'size-12' }: { className?: string }) {
  // 뷰파인더 모서리 + 네 가지 색 조각
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <g fill="none" stroke="#1B1433" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 20V10a4 4 0 0 1 4-4h10" />
        <path d="M44 6h10a4 4 0 0 1 4 4v10" />
        <path d="M58 44v10a4 4 0 0 1-4 4H44" />
        <path d="M20 58H10a4 4 0 0 1-4-4V44" />
      </g>
      <g stroke="#1B1433" strokeWidth="3" strokeLinejoin="round">
        <path d="M32 32V15a17 17 0 0 1 17 17Z" fill="#FF5A4E" />
        <path d="M32 32h17a17 17 0 0 1-17 17Z" fill="#3DA5FF" />
        <path d="M32 32v17a17 17 0 0 1-17-17Z" fill="#2BC48A" />
        <path d="M32 32H15a17 17 0 0 1 17-17Z" fill="#FFC93C" />
      </g>
      <circle cx="32" cy="32" r="4.5" fill="#fff" stroke="#1B1433" strokeWidth="3" />
    </svg>
  );
}

export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const big = size === 'lg';
  return (
    <div className="flex items-center gap-3">
      <LogoMark className={big ? 'size-16 anim-wobble' : 'size-10'} />
      <div className="leading-none">
        <div className={`font-display tracking-tight ${big ? 'text-4xl' : 'text-2xl'}`}>
          <span className="text-tomato">C</span>
          <span className="text-sky">O</span>
          <span className="text-leaf">L</span>
          <span className="text-sun [-webkit-text-stroke:1.5px_#1B1433]">O</span>
          <span className="text-grape">R</span> HUNTER
        </div>
        {big && <div className="mt-1 text-sm font-bold text-muted">컬러 헌터 · 팀 대항 색깔 사냥</div>}
      </div>
    </div>
  );
}
