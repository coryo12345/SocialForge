import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import { useSession } from '../store/useSession';
import MarkdownBody from './MarkdownBody';
import type { CommentWithAuthor, CommentSortOption, VoteValue } from 'shared/types';

interface CommentNode extends CommentWithAuthor {
  children: CommentNode[];
}

interface CommentThreadProps {
  comments: CommentWithAuthor[];
  postId: number;
  sort: CommentSortOption;
  onSortChange: (sort: CommentSortOption) => void;
}

const SORT_LABELS: { value: CommentSortOption; label: string }[] = [
  { value: 'best', label: 'Best' },
  { value: 'new', label: 'New' },
  { value: 'old', label: 'Old' },
  { value: 'controversial', label: 'Controversial' },
];

export default function CommentThread({ comments, postId, sort, onSortChange }: CommentThreadProps) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const roots = buildTree(comments);

  const newCommentMutation = useMutation({
    mutationFn: (body: string) =>
      apiClient.post(`/posts/${postId}/comments`, { body }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
    },
  });

  return (
    <div>
      {/* Sort tabs */}
      <div className="flex items-center gap-1 mb-3 border-b border-border pb-2">
        {SORT_LABELS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onSortChange(value)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              sort === value
                ? 'bg-accent text-white font-semibold'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Add top-level comment (real user only) */}
      {user?.is_real_user === 1 && (
        <CommentBox
          postId={postId}
          parentId={null}
          onSubmit={(body) => newCommentMutation.mutateAsync(body)}
          placeholder="Add a comment…"
          className="mb-4"
        />
      )}

      {roots.length === 0 ? (
        <div className="text-center py-8 text-text-secondary text-sm">
          No comments yet. Be the first.
        </div>
      ) : (
        <div className="space-y-2">
          {roots.map((node) => (
            <CommentNodeView key={node.id} node={node} postId={postId} depth={0} />
          ))}
        </div>
      )}
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
  const [replying, setReplying] = useState(false);
  const { user } = useSession();
  const queryClient = useQueryClient();

  const voteMutation = useMutation({
    mutationFn: (value: VoteValue) =>
      apiClient.post(`/posts/${postId}/comments/${node.id}/vote`, { value }).then((r) => r.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
    },
  });

  const replyMutation = useMutation({
    mutationFn: (body: string) =>
      apiClient.post(`/posts/${postId}/comments`, { body, parent_id: node.id }).then((r) => r.data),
    onSuccess: () => {
      setReplying(false);
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
    },
  });

  const handleVote = (value: VoteValue) => {
    if (!user) return;
    voteMutation.mutate(value);
  };

  const timeAgo = formatDistanceToNow(new Date(node.scheduled_at * 1000), { addSuffix: true });
  const isRealUser = node.is_removed === 0 && (node as CommentWithAuthor & { is_real_user?: number }).is_real_user === 1;

  return (
    <div style={{ marginLeft: depth > 0 ? `${Math.min(depth, MAX_DEPTH) * INDENT_PX}px` : '0' }}>
      <div className="relative">
        {/* Left indent bar */}
        {depth > 0 && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="absolute -left-4 top-0 bottom-0 w-3 flex items-stretch group/bar"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            <div className="w-0.5 bg-border group-hover/bar:bg-accent transition-colors mx-auto" />
          </button>
        )}

        <div className={`${depth > 0 ? 'pl-1' : ''} ${isRealUser ? 'border-l-2 border-accent pl-2' : ''}`}>
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
              <div className="text-sm text-text-primary mb-2">
                <MarkdownBody>{node.body}</MarkdownBody>
              </div>

              <div className="flex items-center gap-3 mb-2">
                <VoteButtons
                  score={node.score}
                  onVote={handleVote}
                  disabled={!user || voteMutation.isPending}
                />
                {user?.is_real_user === 1 && (
                  <button
                    onClick={() => setReplying((r) => !r)}
                    className="text-xs text-text-secondary hover:text-accent transition-colors"
                  >
                    {replying ? 'Cancel' : 'Reply'}
                  </button>
                )}
              </div>

              {replying && (
                <div className="mb-3">
                  <CommentBox
                    postId={postId}
                    parentId={node.id}
                    onSubmit={(body) => replyMutation.mutateAsync(body)}
                    placeholder={`Reply to ${node.author_display_name}…`}
                  />
                </div>
              )}

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

function CommentBox({
  postId: _postId,
  parentId: _parentId,
  onSubmit,
  placeholder,
  className = '',
}: {
  postId: number;
  parentId: number | null;
  onSubmit: (body: string) => Promise<unknown>;
  placeholder?: string;
  className?: string;
}) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(body.trim());
      setBody('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={className}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder ?? 'Write a comment…'}
        rows={3}
        maxLength={10000}
        className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent resize-none"
      />
      <div className="flex justify-end mt-1">
        <button
          onClick={handleSubmit}
          disabled={!body.trim() || submitting}
          className="bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
        >
          {submitting ? 'Posting…' : 'Comment'}
        </button>
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
