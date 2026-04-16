import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import PostDetail from '../components/PostDetail';
import CommentThread from '../components/CommentThread';
import apiClient from '../api/client';
import type { FeedPost, CommentWithAuthor } from 'shared/types';

export default function PostPage() {
  const { community: communityName, postId } = useParams<{ community: string; postId: string }>();

  const { data: post, isPending: postLoading, isError: postError } = useQuery<FeedPost>({
    queryKey: ['post', Number(postId)],
    queryFn: () => apiClient.get(`/posts/${postId}`).then((r) => r.data),
    enabled: !!postId,
  });

  const { data: comments = [], isPending: commentsLoading } = useQuery<CommentWithAuthor[]>({
    queryKey: ['comments', Number(postId)],
    queryFn: () => apiClient.get(`/posts/${postId}/comments`).then((r) => r.data),
    enabled: !!postId,
    staleTime: 30_000,
  });

  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar />

      <div className="max-w-5xl mx-auto px-4 pt-16 pb-20 md:pb-8 flex gap-6">
        <main className="flex-1 min-w-0">
          {/* Breadcrumb */}
          {communityName && (
            <nav className="text-xs text-text-secondary mb-3 flex items-center gap-1">
              <Link to={`/r/${communityName}`} className="hover:text-accent transition-colors">
                r/{communityName}
              </Link>
              <span>›</span>
              <span className="text-text-primary truncate max-w-xs">{post?.title ?? 'Post'}</span>
            </nav>
          )}

          {/* Post */}
          {postLoading && (
            <div className="bg-bg-secondary border border-border rounded-lg p-4 animate-pulse space-y-3">
              <div className="h-3 w-1/4 bg-bg-tertiary rounded" />
              <div className="h-5 w-3/4 bg-bg-tertiary rounded" />
              <div className="h-3 w-full bg-bg-tertiary rounded" />
              <div className="h-3 w-2/3 bg-bg-tertiary rounded" />
            </div>
          )}

          {postError && (
            <div className="text-center py-12 text-text-secondary text-sm">
              Post not found or not yet visible.
            </div>
          )}

          {post && <PostDetail post={post} />}

          {/* Comments section */}
          <div className="mt-4">
            <h2 className="text-sm font-semibold text-text-primary mb-3">
              {commentsLoading ? 'Loading comments…' : `${comments.length} Comments`}
            </h2>

            {commentsLoading && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-bg-secondary border border-border rounded-lg p-3 animate-pulse space-y-2">
                    <div className="h-3 w-1/4 bg-bg-tertiary rounded" />
                    <div className="h-3 w-full bg-bg-tertiary rounded" />
                    <div className="h-3 w-2/3 bg-bg-tertiary rounded" />
                  </div>
                ))}
              </div>
            )}

            {!commentsLoading && post && (
              <CommentThread comments={comments} postId={post.id} />
            )}
          </div>
        </main>

        {post && (
          <Sidebar
            community={{
              id: post.community_id,
              name: post.community_name,
              display_name: post.community_display_name,
              banner_color: post.community_banner_color,
              icon_seed: '',
              description: null,
              sidebar_text: null,
              rules: null,
              tags: null,
              member_count: 0,
              created_at: 0,
            }}
          />
        )}
      </div>
    </div>
  );
}
