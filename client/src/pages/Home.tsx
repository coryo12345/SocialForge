import { useRef, useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import PostCard from '../components/PostCard';
import apiClient from '../api/client';
import { useSession } from '../store/useSession';
import type { FeedPost, PaginatedResponse, SortOption } from 'shared/types';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'foryou', label: '✦ For You' },
  { value: 'hot', label: '🔥 Hot' },
  { value: 'new', label: '✨ New' },
  { value: 'top', label: '🏆 Top' },
];

export default function Home() {
  const { user } = useSession();
  const [sort, setSort] = useState<SortOption>('hot');
  const sentinelRef = useRef<HTMLDivElement>(null);

  const isPersonalized = sort === 'foryou';

  const { data, fetchNextPage, hasNextPage, isPending, isFetchingNextPage, isError } =
    useInfiniteQuery({
      queryKey: ['feed', sort],
      queryFn: ({ pageParam }) => {
        if (isPersonalized && user) {
          return apiClient
            .get<PaginatedResponse<FeedPost>>('/feed/personalized', {
              params: { cursor: pageParam, limit: 25 },
            })
            .then((r) => r.data);
        }
        const apiSort = isPersonalized ? 'hot' : sort;
        return apiClient
          .get<PaginatedResponse<FeedPost>>('/feed', {
            params: { sort: apiSort, cursor: pageParam, limit: 25 },
          })
          .then((r) => r.data);
      },
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      gcTime: 60_000,
    });

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const posts = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar />

      {/* Main layout */}
      <div className="max-w-5xl mx-auto px-4 pt-16 pb-20 md:pb-8 flex gap-6">
        {/* Feed */}
        <main className="flex-1 min-w-0">
          {/* Sort tabs */}
          <div className="flex items-center gap-1 mb-4 bg-bg-secondary border border-border rounded-lg p-1 overflow-x-auto">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSort(opt.value)}
                className={`flex-1 min-w-fit py-1.5 px-3 rounded text-sm font-medium transition-colors whitespace-nowrap ${
                  sort === opt.value
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* For You login prompt */}
          {isPersonalized && !user && (
            <div className="text-center py-8 text-text-secondary text-sm border border-border rounded-lg bg-bg-secondary mb-4">
              <p className="font-medium mb-1">Log in for a personalized feed</p>
              <Link to="/login" className="text-accent hover:underline">Log in</Link>
            </div>
          )}

          {/* Posts */}
          {isPending && <PostSkeleton count={5} />}
          {isError && (
            <div className="text-center py-12 text-text-secondary text-sm">
              Failed to load feed. Is the server running?
            </div>
          )}
          {!isPending && posts.length === 0 && !isError && (
            <div className="text-center py-12 text-text-secondary">
              <p className="text-lg font-medium mb-2">No posts yet</p>
              <p className="text-sm">Run the generation scripts to populate the feed.</p>
            </div>
          )}

          <div className="space-y-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>

          {/* Load more sentinel */}
          <div ref={sentinelRef} className="h-8 flex items-center justify-center">
            {isFetchingNextPage && (
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          {!hasNextPage && posts.length > 0 && (
            <p className="text-center text-text-secondary text-sm py-4">
              You've reached the end.
            </p>
          )}
        </main>

        <Sidebar />
      </div>
    </div>
  );
}

function PostSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-bg-secondary border border-border rounded-lg p-3 animate-pulse">
          <div className="flex gap-3">
            <div className="w-8 space-y-1">
              <div className="h-4 w-4 bg-bg-tertiary rounded mx-auto" />
              <div className="h-3 w-6 bg-bg-tertiary rounded mx-auto" />
              <div className="h-4 w-4 bg-bg-tertiary rounded mx-auto" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 bg-bg-tertiary rounded" />
              <div className="h-4 w-3/4 bg-bg-tertiary rounded" />
              <div className="h-3 w-full bg-bg-tertiary rounded" />
              <div className="h-3 w-2/3 bg-bg-tertiary rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
