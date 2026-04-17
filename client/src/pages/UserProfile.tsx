import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import Navbar from '../components/Navbar';
import PostCard from '../components/PostCard';
import apiClient from '../api/client';
import type { PublicUser, FeedPost, CommentWithAuthor, PaginatedResponse, UserStats } from 'shared/types';

type Tab = 'posts' | 'comments' | 'about';

function safeParseJson(value: string | undefined): string[] {
  try {
    return JSON.parse(value || '[]');
  } catch {
    return [];
  }
}

export default function UserProfile() {
  const { username } = useParams<{ username: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('posts');

  useEffect(() => {
    setActiveTab('posts');
  }, [username]);

  const { data: user, isError } = useQuery<PublicUser>({
    queryKey: ['user', username],
    queryFn: () => apiClient.get(`/users/${username}`).then((r) => r.data),
    enabled: !!username,
  });

  const { data: postsData, isPending: postsPending } = useInfiniteQuery({
    queryKey: ['user-posts', username],
    queryFn: ({ pageParam }) =>
      apiClient
        .get<PaginatedResponse<FeedPost>>(`/users/${username}/posts`, {
          params: { cursor: pageParam, limit: 25 },
        })
        .then((r) => r.data),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!username && activeTab === 'posts',
  });

  const { data: commentsData, isPending: commentsPending } = useInfiniteQuery({
    queryKey: ['user-comments', username],
    queryFn: ({ pageParam }) =>
      apiClient
        .get<PaginatedResponse<CommentWithAuthor>>(`/users/${username}/comments`, {
          params: { cursor: pageParam, limit: 25 },
        })
        .then((r) => r.data),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!username && activeTab === 'comments',
  });

  const { data: stats } = useQuery<UserStats>({
    queryKey: ['user-stats', username],
    queryFn: () => apiClient.get(`/users/${username}/stats`).then((r) => r.data),
    enabled: !!username,
  });

  const { data: persona } = useQuery<Record<string, unknown>>({
    queryKey: ['user-persona', username],
    queryFn: () => apiClient.get(`/users/${username}/persona`).then((r) => r.data),
    enabled: !!username && user?.is_real_user === 0,
    retry: false,
  });

  const posts = postsData?.pages.flatMap((p) => p.items) ?? [];
  const comments = commentsData?.pages.flatMap((p) => p.items) ?? [];
  const isAI = user?.is_real_user === 0;
  const tabs: Tab[] = isAI ? ['posts', 'comments', 'about'] : ['posts', 'comments'];

  if (isError) {
    return (
      <div className="min-h-screen bg-bg-primary">
        <Navbar />
        <div className="pt-20 text-center text-text-secondary">User not found.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar />

      <div className="max-w-3xl mx-auto px-4 pt-16 pb-20 md:pb-8">
        {/* Profile header */}
        {user ? (
          <div className="bg-bg-secondary border border-border rounded-lg p-5 mb-4">
            <div className="flex items-start gap-4">
              <img
                src={`https://api.dicebear.com/9.x/lorelei/svg?seed=${user.avatar_seed}`}
                alt={user.display_name}
                className="w-20 h-20 rounded-full bg-bg-tertiary shrink-0"
              />
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-text-primary">{user.display_name}</h1>
                <p className="text-sm text-text-secondary">u/{user.username}</p>
                {user.bio && (
                  <p className="text-sm text-text-secondary mt-1 max-w-md">{user.bio}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-text-secondary">
                  <span>
                    Joined{' '}
                    <span className="text-text-primary">{format(new Date(user.created_at * 1000), 'MMMM yyyy')}</span>
                  </span>
                  {user.is_real_user === 1 && (
                    <>
                      <span>&middot;</span>
                      <span className="text-accent font-medium">Real user</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Stats bar */}
            {stats && (
              <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center">
                  <div className="text-base font-mono font-bold text-text-primary">{stats.post_karma.toLocaleString()}</div>
                  <div className="text-xs text-text-secondary">Post karma</div>
                </div>
                <div className="text-center">
                  <div className="text-base font-mono font-bold text-text-primary">{stats.comment_karma.toLocaleString()}</div>
                  <div className="text-xs text-text-secondary">Comment karma</div>
                </div>
                <div className="text-center">
                  <div className="text-base font-mono font-bold text-text-primary">{stats.avg_post_score.toFixed(1)}</div>
                  <div className="text-xs text-text-secondary">Avg post score</div>
                </div>
                <div className="text-center">
                  <div className="text-base font-bold text-text-primary truncate">
                    {stats.top_communities[0]?.name ? `r/${stats.top_communities[0].name}` : '—'}
                  </div>
                  <div className="text-xs text-text-secondary">Top community</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-bg-secondary border border-border rounded-lg p-5 mb-4 animate-pulse h-36" />
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Posts tab */}
        {activeTab === 'posts' && (
          <>
            {postsPending && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-20 bg-bg-secondary border border-border rounded-lg animate-pulse"
                  />
                ))}
              </div>
            )}
            {!postsPending && posts.length === 0 && (
              <p className="text-center py-8 text-text-secondary text-sm">No posts yet.</p>
            )}
            <div className="space-y-3">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          </>
        )}

        {/* Comments tab */}
        {activeTab === 'comments' && (
          <>
            {commentsPending && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 bg-bg-secondary border border-border rounded-lg animate-pulse"
                  />
                ))}
              </div>
            )}
            {!commentsPending && comments.length === 0 && (
              <p className="text-center py-8 text-text-secondary text-sm">No comments yet.</p>
            )}
            <div className="space-y-2">
              {comments.map((comment) => (
                <CommentCard key={comment.id} comment={comment} />
              ))}
            </div>
          </>
        )}

        {/* About tab (AI users only) */}
        {activeTab === 'about' && isAI && (
          <div className="bg-bg-secondary border border-border rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-bold text-text-primary">AI Persona</h2>
            {persona ? (
              <>
                {persona.personality && (
                  <div>
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Personality</p>
                    <div className="flex flex-wrap gap-2">
                      {safeParseJson(persona.personality as string).map((trait: string) => (
                        <span key={trait} className="bg-tag-bg text-link text-xs px-2 py-1 rounded-full">{trait}</span>
                      ))}
                    </div>
                  </div>
                )}
                {persona.interests && (
                  <div>
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Interests</p>
                    <div className="flex flex-wrap gap-2">
                      {safeParseJson(persona.interests as string).map((interest: string) => (
                        <span key={interest} className="bg-bg-tertiary text-text-primary text-xs px-2 py-1 rounded-full border border-border">{interest}</span>
                      ))}
                    </div>
                  </div>
                )}
                {persona.communication_style && (
                  <div>
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">Communication Style</p>
                    <p className="text-sm text-text-primary">{persona.communication_style as string}</p>
                  </div>
                )}
                {(persona.occupation || persona.location || persona.age) && (
                  <div>
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">Background</p>
                    <p className="text-sm text-text-primary">
                      {[persona.age && `Age ${persona.age}`, persona.occupation, persona.location].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-text-secondary">No persona data available.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentCard({ comment }: { comment: CommentWithAuthor & { post_title?: string; community_name?: string } }) {
  const timeAgo = formatDistanceToNow(new Date(comment.scheduled_at * 1000), { addSuffix: true });

  return (
    <div className="bg-bg-secondary border border-border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1.5 text-xs text-text-secondary">
        {comment.community_name && (
          <>
            <Link
              to={`/r/${comment.community_name}`}
              className="font-medium text-accent hover:underline"
            >
              r/{comment.community_name}
            </Link>
            <span>&middot;</span>
          </>
        )}
        <span>{timeAgo}</span>
        <span>&middot;</span>
        <span className="font-mono">{comment.score} pts</span>
      </div>
      <p className="text-sm text-text-primary leading-relaxed line-clamp-3">{comment.body}</p>
    </div>
  );
}
