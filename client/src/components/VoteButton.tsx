import type { VoteValue } from 'shared/types';

interface VoteButtonProps {
  score: number;
  currentVote: VoteValue;
  onVote: (value: VoteValue) => void;
  disabled?: boolean;
  orientation?: 'vertical' | 'horizontal';
}

export default function VoteButton({
  score,
  currentVote,
  onVote,
  disabled = false,
  orientation = 'vertical',
}: VoteButtonProps) {
  const handleUpvote = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onVote(currentVote === 1 ? 0 : 1);
  };

  const handleDownvote = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onVote(currentVote === -1 ? 0 : -1);
  };

  const upActive = currentVote === 1;
  const downActive = currentVote === -1;

  const btnBase =
    'flex items-center justify-center w-6 h-6 rounded transition-colors focus:outline-none';
  const upCls = `${btnBase} ${
    upActive
      ? 'text-upvote'
      : 'text-text-secondary hover:text-upvote hover:bg-bg-tertiary'
  } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`;
  const downCls = `${btnBase} ${
    downActive
      ? 'text-downvote'
      : 'text-text-secondary hover:text-downvote hover:bg-bg-tertiary'
  } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`;

  const scoreCls = `font-mono text-xs font-bold select-none px-1 ${
    upActive ? 'text-upvote' : downActive ? 'text-downvote' : 'text-text-secondary'
  }`;

  if (orientation === 'horizontal') {
    return (
      <div className="flex items-center gap-1">
        <button className={upCls} onClick={handleUpvote} disabled={disabled} aria-label="Upvote">
          <UpArrow />
        </button>
        <span className={scoreCls}>{formatScore(score)}</span>
        <button className={downCls} onClick={handleDownvote} disabled={disabled} aria-label="Downvote">
          <DownArrow />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2rem]">
      <button className={upCls} onClick={handleUpvote} disabled={disabled} aria-label="Upvote">
        <UpArrow />
      </button>
      <span className={scoreCls}>{formatScore(score)}</span>
      <button className={downCls} onClick={handleDownvote} disabled={disabled} aria-label="Downvote">
        <DownArrow />
      </button>
    </div>
  );
}

function formatScore(score: number): string {
  if (score >= 1000) return `${(score / 1000).toFixed(1)}k`;
  return String(score);
}

function UpArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 4l8 8H4z" />
    </svg>
  );
}

function DownArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 20l-8-8h16z" />
    </svg>
  );
}
