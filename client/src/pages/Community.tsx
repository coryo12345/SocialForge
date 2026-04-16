import { useRef, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import CommunityHeader from '../components/CommunityHeader';
import PostCard from '../components/PostCard';
import apiClient from '../api/client';
import type { Community as CommunityType, FeedPost, PaginatedResponse, SortOption } from 'shared/types';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'hot', label: '🔥 Hot' },
  { value: 'new', label: '✨ New' },
  { value: 'top', label: '🏆 Top' },
];

export default function Community() {
  const { community: communityName } = useParams<{ community: string }>();
  const [sort, setSort] = useState<SortOption>('hot');
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data: community, isError: communityError } = useQuery<CommunityType>({
    queryKey: ['community', communityName],
    queryFn: () => apiClient.get(`/communities/${communityName}`).then((r) => r.data),
    enabled: !!communityName,
  });

  const { data, fetchNextPage, hasNextPage, isPending, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['community-posts', communityName, sort],
    queryFn: ({ pageParam }) =>
      apiClient
        .get<PaginatedResponse<FeedPost>>(`/communities/${communityName}/posts`, {
          params: { sort, cursor: pageParam, limit: 25 },
        })
        .then((r) => r.data),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!communityName,
  });

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

  if (communityError) {
    return (
      <div className="min-h-screen bg-bg-primary">
        <Navbar />
        <div className="pt-16 text-center py-12 text-text-secondary">
          Community not found.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar />
      <div className="pt-12">
        {community && <CommunityHeader community={community} />}

        <div className="max-w-5xl mx-auto px-4 pt-4 pb-20 md:pb-8 flex gap-6">
          <main className="flex-1 min-w-0">
            {/* Sort tabs */}
            <div className="flex items-center gap-1 mb-4 bg-bg-secondary border border-border rounded-lg p-1">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSort(opt.value)}
                  className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-colors ${
                    sort === opt.value
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {isPending && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-24 bg-bg-secondary border border-border rounded-lg animate-pulse" />
                ))}
              </div>
            )}

            {!isPending && posts.length === 0 && (
              <div className="text-center py-12 text-text-secondary text-sm">
                No posts yet in this community.
              </div>
            )}

            <div className="space-y-3">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} showCommunity={false} />
              ))}
            </div>

            <div ref={sentinelRef} className="h-8 flex items-center justify-center">
              {isFetchingNextPage && (
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              )}
            </div>
          </main>

          {community && <Sidebar community={community} />}
        </div>
      </div>
    </div>
  );
}
