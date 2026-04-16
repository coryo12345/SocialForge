// Shared TypeScript types — imported by both server and client.
// No external dependencies; pure type definitions only.

export interface User {
  id: number;
  username: string;
  display_name: string;
  avatar_seed: string;
  bio: string | null;
  age: number | null;
  location: string | null;
  occupation: string | null;
  personality: string | null;        // JSON-encoded string[] on server; parsed array in client
  communication_style: string | null;
  interests: string | null;          // JSON-encoded string[] on server; parsed array in client
  political_lean: string | null;
  is_real_user: 0 | 1;
  karma: number;
  created_at: number;                // Unix timestamp
}

// User fields safe to expose publicly (omits AI persona internals)
export interface PublicUser {
  id: number;
  username: string;
  display_name: string;
  avatar_seed: string;
  bio: string | null;
  is_real_user: 0 | 1;
  karma: number;
  created_at: number;
}

export interface Community {
  id: number;
  name: string;
  display_name: string;
  description: string | null;
  sidebar_text: string | null;
  icon_seed: string;
  banner_color: string;
  rules: string | null;              // JSON-encoded string[]
  tags: string | null;               // JSON-encoded string[]
  member_count: number;
  created_at: number;
}

export interface Post {
  id: number;
  community_id: number;
  user_id: number;
  title: string;
  body: string | null;
  post_type: 'text' | 'link' | 'image' | 'video';
  link_url: string | null;
  score: number;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  is_pinned: 0 | 1;
  is_removed: 0 | 1;
  removed_at: number | null;
  flair: string | null;
  scheduled_at: number;
  created_at: number;
  updated_at: number;
}

export interface FeedPost extends Post {
  community_name: string;
  community_display_name: string;
  community_banner_color: string;
  author_username: string;
  author_display_name: string;
  author_avatar_seed: string;
}

export interface Comment {
  id: number;
  post_id: number;
  parent_id: number | null;
  user_id: number;
  body: string;
  score: number;
  upvote_count: number;
  downvote_count: number;
  depth: number;
  is_removed: 0 | 1;
  removed_at: number | null;
  scheduled_at: number;
  created_at: number;
  updated_at: number;
}

export interface CommentWithAuthor extends Comment {
  author_username: string;
  author_display_name: string;
  author_avatar_seed: string;
}

export interface Vote {
  id: number;
  user_id: number;
  target_id: number;
  target_type: 'post' | 'comment';
  value: -1 | 0 | 1;
  created_at: number;
}

export interface Session {
  id: string;
  user_id: number;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiError {
  error: string;
  message?: string;
}

export type SortOption = 'hot' | 'new' | 'top';
export type VoteValue = -1 | 0 | 1;
