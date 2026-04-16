import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import { useSession } from '../store/useSession';
import type { CommentWithAuthor, VoteValue } from 'shared/types';

interface CommentNode extends CommentWithAuthor {
  children: CommentNode[];
}

interface CommentThreadProps {
  comments: CommentWithAuthor[];
  postId: number;
}

export default function CommentThread({ comments, postId }: CommentThreadProps) {
  const roots = buildTree(comments);

  if (roots.length === 0) {
    return (
      <div className="text-center py-8 text-text-secondary text-sm">
        No comments yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {roots.map((node) => (
        <CommentNodeView key={node.id} node={node} postId={postId} depth={0} />
      ))}
    </div>
  );
}

function buildTree(comments: CommentWithAuthor[]): CommentNode[] {
  const map = new Map<number, CommentNode>();
  const roots: CommentNode[] = [];

  for (const c of comments) {
    map.set(c.id, { ...c, children: [] });
  }
  for (const c of comments) {
    const node = map.get(c.id)!;
    if (c.parent_id === null) {
      roots.push(node);
    } else {
      const parent = map.get(c.parent_id);
      if (parent) parent.children.push(node);
    }
  }

  const sortLevel = (nodes: CommentNode[]) => {
    nodes.sort((a, b) => b.score - a.score);
    nodes.forEach((n) => sortLevel(n.children));
  };
  sortLevel(roots);
  return roots;
}

const MAX_DEPTH = 6;
const INDENT_PX = 16;

function CommentNodeView({
  node,
  postId,
  depth,
}: {
  node: CommentNode;
  postId: number;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useSession();
  const queryClient = useQueryClient();

  const voteMutation = useMutation({
    mutationFn: (value: VoteValue) =>
      apiClient.post(`/posts/${postId}/comments/${node.id}/vote`, { value }).then((r) => r.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
    },
  });

  const handleVote = (value: VoteValue) => {
    if (!user) return;
    voteMutation.mutate(value);
  };

  const timeAgo = formatDistanceToNow(new Date(node.scheduled_at * 1000), { addSuffix: true });

  return (
    <div style={{ marginLeft: depth > 0 ? `${Math.min(depth, MAX_DEPTH) * INDENT_PX}px` : '0' }}>
      <div className="relative">
        {/* Left indent bar — click to collapse */}
        {depth > 0 && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="absolute -left-4 top-0 bottom-0 w-3 flex items-stretch group/bar"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            <div className="w-0.5 bg-border group-hover/bar:bg-accent transition-colors mx-auto" />
          </button>
        )}

        {/* Comment content */}
        <div className={`${depth > 0 ? 'pl-1' : ''}`}>
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            {depth === 0 && (
              <button
                onClick={() => setCollapsed((c) => !c)}
                className="flex items-center shrink-0 hover:opacity-70 transition-opacity"
                aria-label={collapsed ? 'Expand' : 'Collapse'}
              >
                <img
                  src={`https://api.dicebear.com/9.x/lorelei/svg?seed=${node.author_avatar_seed}`}
                  alt={node.author_display_name}
                  className="w-6 h-6 rounded-full bg-bg-tertiary"
                />
              </button>
            )}
            <Link
              to={`/u/${node.author_username}`}
              className="text-xs font-semibold text-text-primary hover:text-accent transition-colors"
            >
              {node.author_display_name}
            </Link>
            <span className="font-mono text-xs text-text-secondary">{node.score}</span>
            <span className="text-xs text-text-secondary">&middot; {timeAgo}</span>
            {collapsed && (
              <button
                onClick={() => setCollapsed(false)}
                className="text-xs text-accent hover:underline"
              >
                [show]
              </button>
            )}
          </div>

          {!collapsed && (
            <>
              {/* Body */}
              <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed mb-2">
                {node.body}
              </p>

              {/* Actions */}
              <div className="flex items-center gap-3 mb-2">
                <div className="flex items-center gap-1">
                  <VoteButtons
                    score={node.score}
                    onVote={handleVote}
                    disabled={!user || voteMutation.isPending}
                  />
                </div>
                <button className="text-xs text-text-secondary hover:text-accent transition-colors">
                  Reply
                </button>
              </div>

              {/* Children */}
              {node.children.length > 0 && depth < MAX_DEPTH && (
                <div className="space-y-2">
                  {node.children.map((child) => (
                    <CommentNodeView key={child.id} node={child} postId={postId} depth={depth + 1} />
                  ))}
                </div>
              )}
              {node.children.length > 0 && depth >= MAX_DEPTH && (
                <button className="text-xs text-link hover:underline mt-1">
                  Continue thread →
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VoteButtons({
  score,
  onVote,
  disabled,
}: {
  score: number;
  onVote: (v: VoteValue) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={(e) => { e.preventDefault(); onVote(1); }}
        disabled={disabled}
        className="text-text-secondary hover:text-upvote disabled:opacity-40 transition-colors"
        aria-label="Upvote"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M12 4l8 8H4z" />
        </svg>
      </button>
      <span className="font-mono text-xs text-text-secondary">{score}</span>
      <button
        onClick={(e) => { e.preventDefault(); onVote(-1); }}
        disabled={disabled}
        className="text-text-secondary hover:text-downvote disabled:opacity-40 transition-colors"
        aria-label="Downvote"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M12 20l-8-8h16z" />
        </svg>
      </button>
    </div>
  );
}
