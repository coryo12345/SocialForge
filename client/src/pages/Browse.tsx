import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Navbar from '../components/Navbar';
import apiClient from '../api/client';
import type { Community, PublicUser, PaginatedResponse } from 'shared/types';

type Tab = 'communities' | 'users';

export default function Browse() {
  const [activeTab, setActiveTab] = useState<Tab>('communities');

  const { data: communities, isPending: communitiesPending } = useQuery<Community[]>({
    queryKey: ['communities'],
    queryFn: () => apiClient.get('/communities').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const { data: usersData, isPending: usersPending } = useQuery<PaginatedResponse<PublicUser>>({
    queryKey: ['users-list'],
    queryFn: () => apiClient.get('/users').then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled: activeTab === 'users',
  });

  const users = usersData?.items ?? [];

  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar />

      <div className="max-w-3xl mx-auto px-4 pt-16 pb-20 md:pb-8">
        <h1 className="text-xl font-bold text-text-primary mt-4 mb-4">Browse</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-border">
          {(['communities', 'users'] as Tab[]).map((tab) => (
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

        {/* Communities tab */}
        {activeTab === 'communities' && (
          <>
            {communitiesPending && (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 bg-bg-secondary border border-border rounded-lg animate-pulse"
                  />
                ))}
              </div>
            )}
            {!communitiesPending && (!communities || communities.length === 0) && (
              <p className="text-center py-8 text-text-secondary text-sm">No communities yet.</p>
            )}
            <div className="space-y-2">
              {communities?.map((c) => (
                <Link
                  key={c.id}
                  to={`/r/${c.name}`}
                  className="flex items-center gap-3 bg-bg-secondary border border-border rounded-lg px-4 py-3 hover:bg-bg-tertiary transition-colors"
                >
                  <img
                    src={`https://api.dicebear.com/9.x/shapes/svg?seed=${c.icon_seed}`}
                    alt=""
                    className="w-10 h-10 rounded-full bg-bg-tertiary shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-text-primary">r/{c.name}</div>
                    {c.description && (
                      <div className="text-xs text-text-secondary mt-0.5 line-clamp-2">
                        {c.description}
                      </div>
                    )}
                    <div className="text-xs text-text-secondary font-mono mt-1">
                      {c.member_count.toLocaleString()} members
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        {/* Users tab */}
        {activeTab === 'users' && (
          <>
            {usersPending && (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 bg-bg-secondary border border-border rounded-lg animate-pulse"
                  />
                ))}
              </div>
            )}
            {!usersPending && users.length === 0 && (
              <p className="text-center py-8 text-text-secondary text-sm">No users yet.</p>
            )}
            <div className="space-y-2">
              {users.map((u) => (
                <Link
                  key={u.id}
                  to={`/u/${u.username}`}
                  className="flex items-center gap-3 bg-bg-secondary border border-border rounded-lg px-4 py-3 hover:bg-bg-tertiary transition-colors"
                >
                  <img
                    src={`https://api.dicebear.com/9.x/lorelei/svg?seed=${u.avatar_seed}`}
                    alt=""
                    className="w-10 h-10 rounded-full bg-bg-tertiary shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-text-primary">{u.display_name}</div>
                    <div className="text-xs text-text-secondary">u/{u.username}</div>
                  </div>
                  <div className="text-xs text-text-secondary shrink-0 font-mono">
                    {u.karma.toLocaleString()} karma
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
