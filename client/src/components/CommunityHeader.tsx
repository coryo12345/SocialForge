import type { Community } from 'shared/types';

interface CommunityHeaderProps {
  community: Community;
}

export default function CommunityHeader({ community }: CommunityHeaderProps) {
  return (
    <div className="w-full">
      {/* Banner */}
      <div
        className="h-20 w-full"
        style={{ backgroundColor: community.banner_color }}
      />

      {/* Info bar */}
      <div className="bg-bg-secondary border-b border-border">
        <div className="max-w-5xl mx-auto px-4 pb-4">
          <div className="flex items-end gap-4 -mt-6">
            {/* Community icon */}
            <div className="w-16 h-16 rounded-full bg-bg-secondary border-4 border-bg-secondary overflow-hidden shrink-0">
              <img
                src={`https://api.dicebear.com/9.x/shapes/svg?seed=${community.icon_seed}`}
                alt={community.display_name}
                className="w-full h-full"
              />
            </div>

            <div className="pb-1 min-w-0">
              <h1 className="text-xl font-bold text-text-primary truncate">
                {community.display_name}
              </h1>
              <p className="text-sm text-text-secondary">
                r/{community.name} &middot;{' '}
                <span className="font-semibold text-text-primary">
                  {community.member_count.toLocaleString()}
                </span>{' '}
                members
              </p>
            </div>

            {/* Join button — cosmetic only in Phase 1 */}
            <button className="ml-auto shrink-0 bg-accent hover:bg-accent-hover text-white text-sm font-semibold px-4 py-1.5 rounded-full transition-colors">
              Join
            </button>
          </div>

          {community.description && (
            <p className="mt-3 text-sm text-text-secondary max-w-2xl">
              {community.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
