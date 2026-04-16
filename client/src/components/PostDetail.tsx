import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import VoteButton from './VoteButton';
import apiClient from '../api/client';
import { useSession } from '../store/useSession';
import type { FeedPost, VoteValue } from 'shared/types';

interface PostDetailProps {
  post: FeedPost;
  currentVote?: VoteValue;
}

export default function PostDetail({ post, currentVote = 0 }: PostDetailProps) {
  const { user } = useSession();
  const queryClient = useQueryClient();

  const voteMutation = useMutation({
    mutationFn: (value: VoteValue) =>
      apiClient.post(`/posts/${post.id}/vote`, { value }).then((r) => r.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['post', post.id] });
    },
  });

  const handleVote = (value: VoteValue) => {
    if (!user) return;
    voteMutation.mutate(value);
  };

  const optimisticScore = voteMutation.variables !== undefined
    ? post.score +
      (voteMutation.variables === 1 ? 1 : 0) -
      (currentVote === 1 ? 1 : 0) -
      (voteMutation.variables === -1 ? 1 : 0) +
      (currentVote === -1 ? 1 : 0)
    : post.score;

  const activeVote: VoteValue = voteMutation.variables !== undefined
    ? voteMutation.variables
    : currentVote;

  const timeAgo = formatDistanceToNow(new Date(post.scheduled_at * 1000), { addSuffix: true });

  return (
    <article className="bg-bg-secondary border border-border rounded-lg p-4">
      {/* Meta */}
      <div className="flex items-center gap-1 text-xs text-text-secondary mb-2 flex-wrap">
        <Link
          to={`/r/${post.community_name}`}
          className="font-semibold text-text-primary hover:text-accent transition-colors"
        >
          r/{post.community_name}
        </Link>
        <span>&middot;</span>
        <span>
          Posted by{' '}
          <Link
            to={`/u/${post.author_username}`}
            className="hover:text-accent transition-colors"
          >
            u/{post.author_username}
          </Link>
        </span>
        <span>&middot;</span>
        <span>{timeAgo}</span>
      </div>

      {/* Title */}
      <h1 className="text-xl font-bold text-text-primary mb-3 leading-snug">
        {post.title}
        {post.flair && (
          <span className="ml-2 inline-block bg-tag-bg text-link text-xs px-2 py-0.5 rounded font-normal align-middle">
            {post.flair}
          </span>
        )}
      </h1>

      {/* Body */}
      {post.body && post.body.trim().length > 0 && (
        <div className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed mb-4 border-t border-border pt-3">
          {post.body}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-4 pt-2 border-t border-border">
        <VoteButton
          score={optimisticScore}
          currentVote={activeVote}
          onVote={handleVote}
          disabled={!user || voteMutation.isPending}
          orientation="horizontal"
        />

        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <CommentIcon />
          <span>{post.comment_count} comments</span>
        </div>

        {/* Author info */}
        <div className="flex items-center gap-2 ml-auto">
          <img
            src={`https://api.dicebear.com/9.x/lorelei/svg?seed=${post.author_avatar_seed}`}
            alt={post.author_display_name}
            className="w-6 h-6 rounded-full bg-bg-tertiary"
          />
          <Link
            to={`/u/${post.author_username}`}
            className="text-xs text-text-secondary hover:text-accent transition-colors"
          >
            {post.author_display_name}
          </Link>
        </div>
      </div>
    </article>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
