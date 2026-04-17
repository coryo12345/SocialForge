import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import VoteButton from './VoteButton';
import apiClient from '../api/client';
import { useSession } from '../store/useSession';
import { useActivityTracker } from '../hooks/useActivityTracker';
import type { FeedPost, VoteValue } from 'shared/types';

interface PostCardProps {
  post: FeedPost;
  showCommunity?: boolean;
  currentVote?: VoteValue;
}

export default function PostCard({ post, showCommunity = true, currentVote = 0 }: PostCardProps) {
  const { user } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { track } = useActivityTracker();

  const voteMutation = useMutation({
    mutationFn: (value: VoteValue) =>
      apiClient.post(`/posts/${post.id}/vote`, { value }).then((r) => r.data),
    onMutate: async (newValue) => {
      // Optimistic update across all queries that might contain this post
      await queryClient.cancelQueries({ queryKey: ['feed'] });
      await queryClient.cancelQueries({ queryKey: ['community-posts'] });

      const oldValue = currentVote;
      const upDelta = (newValue === 1 ? 1 : 0) - (oldValue === 1 ? 1 : 0);
      const downDelta = (newValue === -1 ? 1 : 0) - (oldValue === -1 ? 1 : 0);

      return { oldValue, upDelta, downDelta };
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['community-posts'] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['community-posts'] });
    },
  });

  const handleVote = (value: VoteValue) => {
    if (!user) {
      navigate('/login');
      return;
    }
    voteMutation.mutate(value);
    track(value === 1 ? 'upvote' : 'downvote', post.id, 'post');
  };

  const postUrl = `/r/${post.community_name}/${post.id}`;
  const bodyPreview =
    post.body && post.body.length > 0
      ? post.body.length > 300
        ? post.body.slice(0, 300) + '…'
        : post.body
      : null;

  const timeAgo = formatDistanceToNow(new Date(post.scheduled_at * 1000), { addSuffix: true });

  // Compute optimistic score
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

  return (
    <article className="bg-bg-secondary border border-border rounded-lg hover:border-text-secondary transition-colors group">
      <div className="flex gap-3 p-3">
        {/* Vote column */}
        <div className="shrink-0 pt-0.5">
          <VoteButton
            score={optimisticScore}
            currentVote={activeVote}
            onVote={handleVote}
            disabled={voteMutation.isPending}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Meta line */}
          <div className="flex items-center gap-1 text-xs text-text-secondary mb-1.5 flex-wrap">
            {showCommunity && (
              <>
                <Link
                  to={`/r/${post.community_name}`}
                  className="font-semibold text-text-primary hover:text-accent transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  r/{post.community_name}
                </Link>
                <span>&middot;</span>
              </>
            )}
            <span>
              Posted by{' '}
              <Link
                to={`/u/${post.author_username}`}
                className="hover:text-accent transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                u/{post.author_username}
              </Link>
            </span>
            <span>&middot;</span>
            <span>{timeAgo}</span>
          </div>

          {/* Title */}
          <Link
            to={postUrl}
            className="block group-hover:text-accent transition-colors"
            onClick={() => track('view_post', post.id, 'post')}
          >
            <h2 className="text-base font-semibold text-text-primary leading-snug mb-1">
              {post.title}
              {post.flair && (
                <span className="ml-2 inline-block bg-tag-bg text-link text-xs px-1.5 py-0.5 rounded font-normal align-middle">
                  {post.flair}
                </span>
              )}
            </h2>
          </Link>

          {/* Media stubs */}
          {post.post_type === 'image' && (
            <Link to={postUrl} onClick={() => track('view_post', post.id, 'post')}>
              {post.media_url || post.thumbnail_url ? (
                <div className="mt-1 mb-2 rounded overflow-hidden bg-bg-tertiary max-h-64 flex items-center justify-center">
                  <img
                    src={post.thumbnail_url ?? post.media_url ?? ''}
                    alt=""
                    className="max-h-64 w-full object-cover"
                    loading="lazy"
                  />
                </div>
              ) : (
                <div className="mt-1 mb-2 rounded bg-bg-tertiary aspect-video flex items-center justify-center text-text-secondary gap-2 text-sm">
                  <ImageIcon />
                  Image post
                </div>
              )}
            </Link>
          )}
          {post.post_type === 'video' && (
            <Link to={postUrl} onClick={() => track('view_post', post.id, 'post')}>
              <div className="mt-1 mb-2 rounded bg-bg-tertiary aspect-video flex items-center justify-center text-text-secondary gap-2 text-sm">
                <VideoIcon />
                Video
                {post.media_duration_seconds && (
                  <span className="text-xs bg-black/40 text-white px-1 py-0.5 rounded">
                    {Math.floor(post.media_duration_seconds / 60)}:{String(post.media_duration_seconds % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
            </Link>
          )}

          {/* Body preview */}
          {bodyPreview && post.post_type !== 'image' && post.post_type !== 'video' && (
            <Link to={postUrl} onClick={() => track('view_post', post.id, 'post')}>
              <p className="text-sm text-text-secondary leading-relaxed line-clamp-3">
                {bodyPreview}
              </p>
            </Link>
          )}

          {/* Footer */}
          <div className="flex items-center gap-3 mt-2">
            <Link
              to={postUrl}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-accent transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <CommentIcon />
              <span>{post.comment_count} comments</span>
            </Link>

            {/* Author avatar */}
            <div className="flex items-center gap-1 ml-auto">
              <img
                src={`https://api.dicebear.com/9.x/lorelei/svg?seed=${post.author_avatar_seed}`}
                alt={post.author_display_name}
                className="w-5 h-5 rounded-full bg-bg-tertiary"
              />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="w-4 h-4"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
