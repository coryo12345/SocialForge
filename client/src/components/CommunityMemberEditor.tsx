import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import type { Community } from 'shared/types';

const MAX = 2_500_000;
const SLIDER_STEPS = 1000;

function toSlider(value: number): number {
  return Math.round((Math.log(value + 1) / Math.log(MAX + 1)) * SLIDER_STEPS);
}

function fromSlider(pos: number): number {
  return Math.round(Math.pow(MAX + 1, pos / SLIDER_STEPS) - 1);
}

type SortKey = 'name' | 'member_count_asc' | 'member_count_desc';

export default function CommunityMemberEditor({
  showToast,
}: {
  showToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('member_count_desc');
  const [localCounts, setLocalCounts] = useState<Record<number, number>>({});
  const debounceTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const { data: communities = [] } = useQuery<Community[]>({
    queryKey: ['communities-all'],
    queryFn: () => apiClient.get('/communities').then((r) => r.data),
    staleTime: 30_000,
  });

  const patchMemberCount = useCallback(
    (id: number, count: number) => {
      if (debounceTimers.current[id]) clearTimeout(debounceTimers.current[id]);
      debounceTimers.current[id] = setTimeout(async () => {
        try {
          await apiClient.patch(`/communities/${id}`, { member_count: count });
          queryClient.invalidateQueries({ queryKey: ['communities-all'] });
          showToast('Member count updated');
        } catch {
          showToast('Failed to update');
        }
      }, 500);
    },
    [queryClient, showToast],
  );

  const handleCountChange = useCallback(
    (id: number, raw: number) => {
      const clamped = Math.max(0, Math.min(MAX, Math.round(raw)));
      setLocalCounts((prev) => ({ ...prev, [id]: clamped }));
      patchMemberCount(id, clamped);
    },
    [patchMemberCount],
  );

  const getCount = (c: Community) =>
    localCounts[c.id] !== undefined ? localCounts[c.id] : c.member_count;

  const q = search.toLowerCase();
  const filtered = communities.filter(
    (c) => !q || c.name.includes(q) || c.display_name.toLowerCase().includes(q),
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'name') return a.display_name.localeCompare(b.display_name);
    if (sort === 'member_count_asc') return getCount(a) - getCount(b);
    return getCount(b) - getCount(a);
  });

  return (
    <div className="divide-y divide-border">
      {/* Controls */}
      <div className="px-5 py-3 flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Search communities…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-bg-primary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="bg-bg-primary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="member_count_desc">Members ↓</option>
          <option value="member_count_asc">Members ↑</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      {sorted.length === 0 && (
        <p className="px-5 py-8 text-sm text-text-secondary text-center">No communities found.</p>
      )}

      {sorted.map((c) => {
        const count = getCount(c);
        const sliderVal = toSlider(count);
        return (
          <div key={c.id} className="px-5 py-3 flex items-center gap-3">
            <img
              src={`https://api.dicebear.com/9.x/shapes/svg?seed=${c.icon_seed}`}
              alt=""
              className="w-8 h-8 rounded-full shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{c.display_name}</p>
              <p className="text-xs text-text-secondary">r/{c.name}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="range"
                min={0}
                max={SLIDER_STEPS}
                value={sliderVal}
                onChange={(e) => handleCountChange(c.id, fromSlider(parseInt(e.target.value)))}
                className="w-32 accent-accent"
              />
              <input
                type="number"
                min={0}
                max={MAX}
                value={count}
                onChange={(e) => handleCountChange(c.id, parseInt(e.target.value) || 0)}
                className="w-24 bg-bg-primary border border-border rounded px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-accent text-right"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
