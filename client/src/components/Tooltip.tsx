interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom';
}

export default function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  return (
    <span className="relative inline-flex group/tooltip">
      {children}
      <span
        className={`pointer-events-none absolute z-50 whitespace-nowrap
          bg-bg-primary border border-border text-text-secondary text-xs
          px-2 py-1 rounded shadow-lg
          opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-150
          ${position === 'top'
            ? 'bottom-full left-1/2 -translate-x-1/2 mb-1.5'
            : 'top-full left-1/2 -translate-x-1/2 mt-1.5'}`}
      >
        {content}
      </span>
    </span>
  );
}
