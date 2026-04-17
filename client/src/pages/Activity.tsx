import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import Navbar from '../components/Navbar';
import apiClient from '../api/client';
import { useSession } from '../store/useSession';
import type { ActivityItem } from 'shared/types';

export default function Activity() {
  const { user } = useSession();

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 pt-16 pb-20 md:pb-8">
        <h1 className="text-xl font-bold text-text-primary my-4">Activity</h1>
        <ActivityFeed />
      </div>
    </div>
  );
}

function ActivityFeed() {
  const { data, isPending, isError } = useQuery<{ items: ActivityItem[] }>({
    queryKey: ['activity'],
    queryFn: () => apiClient.get('/feed/activity').then((r) => r.data),
    staleTime: 60_000,
  });

  if (isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-bg-secondary border border-border rounded-lg p-4 animate-pulse h-16" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-text-secondary text-sm text-center py-8">Failed to load activity.</p>;
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-text-secondary">
        <p className="text-lg font-medium mb-2">No activity yet</p>
        <p className="text-sm">Browse and vote on posts to see personalized activity here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ActivityCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function ActivityCard({ item }: { item: ActivityItem }) {
  const timeAgo = formatDistanceToNow(new Date(item.created_at * 1000), { addSuffix: true });

  if (item.reason === 'new_comment_on_upvoted' && item.post && item.comment) {
    const postUrl = `/r/${item.post.community_name}/${item.post.id}`;
    return (
      <Link to={postUrl} className="block bg-bg-secondary border border-border rounded-lg p-4 hover:border-text-secondary transition-colors">
        <div className="flex items-start gap-3">
          <span className="text-xl shrink-0">🗨️</span>
          <div className="min-w-0">
            <p className="text-xs text-text-secondary mb-1">New comment on a post you liked · {timeAgo}</p>
            <p className="text-sm font-medium text-text-primary truncate">{item.post.title}</p>
            <p className="text-xs text-text-secondary mt-1 line-clamp-2">
              <span className="font-medium">{item.comment.author_display_name}:</span>{' '}
              {item.comment.body}
            </p>
          </div>
        </div>
      </Link>
    );
  }

  if (item.reason === 'hot_in_community' && item.post) {
    const postUrl = `/r/${item.post.community_name}/${item.post.id}`;
    return (
      <Link to={postUrl} className="block bg-bg-secondary border border-border rounded-lg p-4 hover:border-text-secondary transition-colors">
        <div className="flex items-start gap-3">
          <span className="text-xl shrink-0">🔥</span>
          <div className="min-w-0">
            <p className="text-xs text-text-secondary mb-1">
              Trending in r/{item.post.community_name} · {timeAgo}
            </p>
            <p className="text-sm font-medium text-text-primary truncate">{item.post.title}</p>
            <p className="text-xs text-text-secondary mt-0.5">{item.post.score} points</p>
          </div>
        </div>
      </Link>
    );
  }

  if (item.reason === 'viral_viewed' && item.post) {
    const postUrl = `/r/${item.post.community_name}/${item.post.id}`;
    return (
      <Link to={postUrl} className="block bg-bg-secondary border border-border rounded-lg p-4 hover:border-text-secondary transition-colors">
        <div className="flex items-start gap-3">
          <span className="text-xl shrink-0">📈</span>
          <div className="min-w-0">
            <p className="text-xs text-text-secondary mb-1">Post blowing up · {timeAgo}</p>
            <p className="text-sm font-medium text-text-primary truncate">{item.post.title}</p>
            <p className="text-xs text-text-secondary mt-0.5">{item.post.score} points</p>
          </div>
        </div>
      </Link>
    );
  }

  return null;
}
