import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import Navbar from '../components/Navbar';
import apiClient from '../api/client';
import type { FeedPost, Community, PublicUser } from 'shared/types';

type SearchType = 'posts' | 'communities' | 'users';

const TABS: { value: SearchType; label: string }[] = [
  { value: 'posts', label: 'Posts' },
  { value: 'communities', label: 'Communities' },
  { value: 'users', label: 'Users' },
];

interface SearchResult {
  items: unknown[];
  hasMore: boolean;
  nextOffset: number | null;
}

export default function Search() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const [activeTab, setActiveTab] = useState<SearchType>('posts');

  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 pt-16 pb-20 md:pb-8">
        <div className="my-4">
          <h1 className="text-lg font-bold text-text-primary">
            {q ? `Results for "${q}"` : 'Search'}
          </h1>
        </div>

        {/* Type tabs */}
        <div className="flex gap-1 mb-4 bg-bg-secondary border border-border rounded-lg p-1">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-colors ${
                activeTab === tab.value
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {q ? <SearchResults q={q} type={activeTab} /> : (
          <p className="text-center text-text-secondary py-8 text-sm">Enter a search query above.</p>
        )}
      </div>
    </div>
  );
}

function SearchResults({ q, type }: { q: string; type: SearchType }) {
  const { data, fetchNextPage, hasNextPage, isPending, isFetchingNextPage } =
    useInfiniteQuery<SearchResult>({
      queryKey: ['search', q, type],
      queryFn: ({ pageParam }) =>
        apiClient
          .get('/search', { params: { q, type, limit: 20, offset: pageParam ?? 0 } })
          .then((r) => r.data),
      initialPageParam: 0 as number,
      getNextPageParam: (lastPage) => lastPage.nextOffset,
    });

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  if (isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-bg-secondary border border-border rounded-lg p-4 animate-pulse h-16" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-center text-text-secondary py-8 text-sm">No results found.</p>;
  }

  return (
    <div>
      <div className="space-y-3">
        {type === 'posts' && (items as FeedPost[]).map((post) => (
          <Link
            key={post.id}
            to={`/r/${post.community_name}/${post.id}`}
            className="block bg-bg-secondary border border-border rounded-lg p-4 hover:border-text-secondary transition-colors"
          >
            <div className="text-xs text-text-secondary mb-1">
              r/{post.community_name} · {formatDistanceToNow(new Date(post.scheduled_at * 1000), { addSuffix: true })}
            </div>
            <div className="text-sm font-medium text-text-primary">{post.title}</div>
            {post.body && (
              <p className="text-xs text-text-secondary mt-1 line-clamp-2">{post.body.slice(0, 200)}</p>
            )}
            <div className="text-xs text-text-secondary mt-1">{post.score} points · {post.comment_count} comments</div>
          </Link>
        ))}

        {type === 'communities' && (items as Community[]).map((c) => (
          <Link
            key={c.id}
            to={`/r/${c.name}`}
            className="block bg-bg-secondary border border-border rounded-lg p-4 hover:border-text-secondary transition-colors"
          >
            <div className="flex items-center gap-3">
              <img
                src={`https://api.dicebear.com/9.x/shapes/svg?seed=${c.icon_seed}`}
                alt=""
                className="w-10 h-10 rounded-full bg-bg-tertiary shrink-0"
              />
              <div>
                <div className="text-sm font-medium text-text-primary">r/{c.name}</div>
                <div className="text-xs text-text-secondary">{c.member_count.toLocaleString()} members</div>
                {c.description && <p className="text-xs text-text-secondary mt-1 line-clamp-2">{c.description}</p>}
              </div>
            </div>
          </Link>
        ))}

        {type === 'users' && (items as PublicUser[]).map((u) => (
          <Link
            key={u.id}
            to={`/u/${u.username}`}
            className="block bg-bg-secondary border border-border rounded-lg p-4 hover:border-text-secondary transition-colors"
          >
            <div className="flex items-center gap-3">
              <img
                src={`https://api.dicebear.com/9.x/lorelei/svg?seed=${u.avatar_seed}`}
                alt=""
                className="w-10 h-10 rounded-full bg-bg-tertiary shrink-0"
              />
              <div>
                <div className="text-sm font-medium text-text-primary">{u.display_name}</div>
                <div className="text-xs text-text-secondary">u/{u.username} · {u.karma.toLocaleString()} karma</div>
                {u.bio && <p className="text-xs text-text-secondary mt-1 line-clamp-2">{u.bio}</p>}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {hasNextPage && (
        <div className="flex justify-center mt-4">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="bg-bg-secondary border border-border text-text-secondary text-sm px-4 py-2 rounded-full hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
