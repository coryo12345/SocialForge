import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Navbar from '../components/Navbar';
import apiClient from '../api/client';
import { useSession } from '../store/useSession';
import type { Setting } from 'shared/types';
import CommunityMemberEditor from '../components/CommunityMemberEditor';

const COMMUNITIES_CATEGORY = 'Communities';

const DEFAULTS: Record<string, string> = {
  posts_per_day_min: '50',
  posts_per_day_max: '150',
  comments_per_post_multiplier: '1.0',
  max_comment_depth: '4',
  max_top_level_comments: '12',
  max_replies_per_comment: '3',
  title_only_post_ratio: '0.3',
  hot_score_decay_hours: '12',
  score_update_interval_minutes: '15',
  viral_post_probability: '0.05',
  ollama_model: 'qwen2.5:3b',
  ollama_temperature: '0.8',
  community_post_weight_by_size: 'true',
  generation_timezone: 'America/New_York',
  activity_peak_hours: '[9,22]',
  default_post_sort: 'hot',
  posts_per_page: '25',
  show_user_karma: 'true',
  show_model_label: 'false',
};

export default function Settings() {
  const { user } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!user?.is_real_user) {
    navigate('/login');
    return null;
  }

  const { data: schema = [] } = useQuery<Setting[]>({
    queryKey: ['settings-schema'],
    queryFn: () => apiClient.get('/settings/schema').then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: values = {} } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: () => apiClient.get('/settings').then((r) => r.data),
    staleTime: 10_000,
  });

  const categories = [...new Set(schema.map((s) => s.category)), COMMUNITIES_CATEGORY];
  const activeCategory = selectedCategory ?? categories[0] ?? '';

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiClient.put(`/settings/${key}`, { value }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      showToast('Settings updated');
    },
  });

  const resetMutation = useMutation({
    mutationFn: (category: string) => {
      const keysInCategory = schema.filter((s) => s.category === category).map((s) => s.key);
      const settings: Record<string, string> = {};
      for (const key of keysInCategory) {
        if (DEFAULTS[key] !== undefined) settings[key] = DEFAULTS[key];
      }
      return apiClient.put('/settings', { settings }).then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      showToast('Reset to defaults');
    },
  });

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleChange = useCallback(
    (key: string, value: string) => {
      if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
      debounceTimers.current[key] = setTimeout(() => {
        updateMutation.mutate({ key, value });
      }, 500);
    },
    [updateMutation],
  );

  const categorySettings = schema.filter((s) => s.category === activeCategory);

  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar />

      {toast && (
        <div className="fixed top-14 right-4 z-50 bg-accent text-white text-sm px-4 py-2 rounded-lg shadow-lg transition-opacity">
          {toast}
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 pt-16 pb-20 md:pb-8 flex flex-col gap-4 md:flex-row md:gap-6">
        {/* Category sidebar */}
        <aside className="hidden md:block w-52 shrink-0">
          <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden sticky top-20">
            <div className="bg-accent px-4 py-3">
              <h2 className="text-white font-bold text-sm">Settings</h2>
            </div>
            <ul className="divide-y divide-border">
              {categories.map((cat) => (
                <li key={cat}>
                  <button
                    onClick={() => setSelectedCategory(cat)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                      cat === activeCategory
                        ? 'bg-bg-tertiary text-accent font-medium'
                        : 'text-text-primary hover:bg-bg-tertiary'
                    }`}
                  >
                    {cat}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Mobile category select */}
        <div className="md:hidden w-full mb-4">
          <select
            value={activeCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-text-primary"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Form */}
        <main className="flex-1 min-w-0">
          <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-text-primary">{activeCategory}</h2>
              {activeCategory !== COMMUNITIES_CATEGORY && (
                <button
                  onClick={() => resetMutation.mutate(activeCategory)}
                  disabled={resetMutation.isPending}
                  className="text-xs text-text-secondary hover:text-accent transition-colors disabled:opacity-40"
                >
                  Reset to defaults
                </button>
              )}
            </div>

            {activeCategory === COMMUNITIES_CATEGORY ? (
              <CommunityMemberEditor showToast={showToast} />
            ) : (
              <div className="divide-y divide-border">
                {categorySettings.map((setting) => (
                  <SettingField
                    key={setting.key}
                    setting={setting}
                    currentValue={values[setting.key] ?? DEFAULTS[setting.key] ?? ''}
                    onChange={handleChange}
                  />
                ))}
                {categorySettings.length === 0 && (
                  <p className="px-5 py-8 text-sm text-text-secondary text-center">
                    No settings in this category.
                  </p>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function SettingField({
  setting,
  currentValue,
  onChange,
}: {
  setting: Setting;
  currentValue: string;
  onChange: (key: string, value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(currentValue);

  const handleBlur = () => {
    if (localValue !== currentValue) onChange(setting.key, localValue);
  };

  const handleChange = (val: string) => {
    setLocalValue(val);
    onChange(setting.key, val);
  };

  return (
    <div className="px-5 py-4 flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <label className="block text-sm font-medium text-text-primary mb-0.5">
          {setting.label}
        </label>
        {setting.description && (
          <p className="text-xs text-text-secondary mb-2">{setting.description}</p>
        )}
      </div>
      <div className="shrink-0 w-48">
        {setting.type === 'boolean' ? (
          <button
            role="switch"
            aria-checked={localValue === 'true'}
            onClick={() => handleChange(localValue === 'true' ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              localValue === 'true' ? 'bg-accent' : 'bg-bg-tertiary border border-border'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                localValue === 'true' ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        ) : setting.type === 'number' ? (
          <input
            type="number"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            step="any"
            className="w-full bg-bg-primary border border-border rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        ) : (
          <input
            type="text"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            className="w-full bg-bg-primary border border-border rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        )}
      </div>
    </div>
  );
}
