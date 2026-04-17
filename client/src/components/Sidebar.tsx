import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import apiClient from '../api/client';
import type { Community, TrendingCommunity } from 'shared/types';

interface SidebarProps {
  community?: Community;
}

export default function Sidebar({ community }: SidebarProps) {
  return (
    <aside className="hidden md:block w-72 shrink-0">
      {community ? <CommunitySidebar community={community} /> : <HomeSidebar />}
    </aside>
  );
}

function HomeSidebar() {
  const { data: communities } = useQuery<Community[]>({
    queryKey: ['communities'],
    queryFn: () => apiClient.get('/communities').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const { data: trending = [] } = useQuery<TrendingCommunity[]>({
    queryKey: ['trending'],
    queryFn: () => apiClient.get('/communities/trending').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const top10 = communities?.slice(0, 10) ?? [];

  return (
    <div className="space-y-4">
      {trending.length > 0 && (
        <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-bold text-sm text-text-primary">Trending Today</h2>
          </div>
          <ul className="divide-y divide-border">
            {trending.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/r/${c.name}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-tertiary transition-colors"
                >
                  <img
                    src={`https://api.dicebear.com/9.x/shapes/svg?seed=${c.icon_seed}`}
                    alt=""
                    className="w-6 h-6 rounded-full bg-bg-tertiary shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">r/{c.name}</div>
                  </div>
                  <span className="text-xs font-mono text-accent shrink-0">
                    {c.recent_posts} posts
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
        <div className="bg-accent px-4 py-3">
          <h2 className="text-white font-bold text-sm">Top Communities</h2>
        </div>
        <ul className="divide-y divide-border">
          {top10.map((c, i) => (
            <li key={c.id}>
              <Link
                to={`/r/${c.name}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-tertiary transition-colors"
              >
                <span className="font-mono text-xs text-text-secondary w-4 text-right">{i + 1}</span>
                <img
                  src={`https://api.dicebear.com/9.x/shapes/svg?seed=${c.icon_seed}`}
                  alt=""
                  className="w-6 h-6 rounded-full bg-bg-tertiary shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">r/{c.name}</div>
                  <div className="text-xs text-text-secondary">
                    {c.member_count.toLocaleString()} members
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {top10.length === 0 && (
          <p className="px-4 py-6 text-sm text-text-secondary text-center">
            No communities yet.
          </p>
        )}
      </div>
    </div>
  );
}

function CommunitySidebar({ community }: { community: Community }) {
  const rules: string[] = (() => {
    try {
      return JSON.parse(community.rules ?? '[]');
    } catch {
      return [];
    }
  })();

  return (
    <div className="space-y-4">
      {/* About */}
      <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
        <div className="bg-accent px-4 py-3">
          <h2 className="text-white font-bold text-sm">About r/{community.name}</h2>
        </div>
        <div className="p-4">
          {community.description && (
            <p className="text-sm text-text-primary mb-3">{community.description}</p>
          )}
          <div className="text-sm text-text-secondary">
            <span className="font-semibold text-text-primary">
              {community.member_count.toLocaleString()}
            </span>{' '}
            members
          </div>
          {community.sidebar_text && (
            <p className="text-xs text-text-secondary mt-3 leading-relaxed">
              {community.sidebar_text}
            </p>
          )}
        </div>
      </div>

      {/* Rules */}
      {rules.length > 0 && (
        <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-bold text-sm text-text-primary">Community Rules</h2>
          </div>
          <ol className="divide-y divide-border">
            {rules.map((rule, i) => (
              <li key={i} className="px-4 py-2.5 flex gap-3">
                <span className="font-mono text-xs text-accent shrink-0 mt-0.5">{i + 1}.</span>
                <span className="text-sm text-text-primary">{rule}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
