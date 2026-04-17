import { useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../store/useSession';
import apiClient from '../api/client';

export default function Navbar() {
  const { user, theme, toggleTheme, getResolvedTheme, clearUser } = useSession();
  const resolved = getResolvedTheme();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: number; title: string; community_name: string }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchDebounce.current = setTimeout(async () => {
      try {
        const r = await apiClient.get('/search', { params: { q, type: 'posts', limit: 5 } });
        setSearchResults(r.data.items ?? []);
      } catch { setSearchResults([]); }
    }, 300);
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      setSearchOpen(false);
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // ignore
    }
    clearUser();
    navigate('/');
  };

  return (
    <>
      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 z-50 h-12 bg-bg-secondary border-b border-border flex items-center px-4 gap-4">
        {/* Logo */}
        <Link
          to="/"
          className="text-accent font-bold text-lg tracking-tight shrink-0 hover:text-accent-hover transition-colors"
        >
          SocialForge
        </Link>

        {/* Search — desktop only */}
        <div className="hidden md:flex flex-1 max-w-sm mx-auto relative" ref={searchRef}>
          <div className="w-full flex items-center gap-2 bg-bg-tertiary border border-border rounded-full px-3 py-1.5 text-sm focus-within:border-accent transition-colors">
            <SearchIcon />
            <input
              type="text"
              placeholder="Search posts…"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={handleSearchKeyDown}
              className="flex-1 bg-transparent outline-none text-text-primary placeholder:text-text-secondary"
            />
          </div>
          {searchOpen && searchQuery.trim() && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-bg-secondary border border-border rounded-lg shadow-lg z-50 overflow-hidden">
              {searchResults.length > 0 ? searchResults.map((r) => (
                <Link
                  key={r.id}
                  to={`/r/${r.community_name}/${r.id}`}
                  className="block px-3 py-2 hover:bg-bg-tertiary transition-colors"
                >
                  <div className="text-sm text-text-primary truncate">{r.title}</div>
                  <div className="text-xs text-text-secondary">r/{r.community_name}</div>
                </Link>
              )) : (
                <div className="px-3 py-2 text-sm text-text-secondary">No results — press Enter to search</div>
              )}
              {searchQuery.trim() && (
                <Link
                  to={`/search?q=${encodeURIComponent(searchQuery.trim())}`}
                  className="block px-3 py-2 text-xs text-accent border-t border-border hover:bg-bg-tertiary"
                >
                  See all results for "{searchQuery}"
                </Link>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 md:flex-none" />

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Activity bell */}
          {user && (
            <Link
              to="/activity"
              className="w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-full transition-colors"
              aria-label="Activity"
              title="Activity"
            >
              <BellIcon />
            </Link>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-full transition-colors"
            aria-label="Toggle theme"
            title={`Theme: ${theme}`}
          >
            {resolved === 'dark' ? <MoonIcon /> : <SunIcon />}
          </button>

          {user?.is_real_user === 1 && (
            <Link
              to="/settings"
              className="w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-full transition-colors"
              aria-label="Settings"
              title="Settings"
            >
              <GearIcon />
            </Link>
          )}

          {user ? (
            <div className="flex items-center gap-2">
              <Link
                to={`/u/${user.username}`}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              >
                <img
                  src={`https://api.dicebear.com/9.x/lorelei/svg?seed=${user.avatar_seed}`}
                  alt={user.display_name}
                  className="w-7 h-7 rounded-full bg-bg-tertiary"
                />
                <span className="hidden md:block text-sm font-medium text-text-primary">
                  {user.display_name}
                </span>
              </Link>
              <button
                onClick={handleLogout}
                className="hidden md:block text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                Log out
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="bg-accent hover:bg-accent-hover text-white text-sm font-semibold px-3 py-1.5 rounded-full transition-colors"
            >
              Log In
            </Link>
          )}
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 h-14 bg-bg-secondary border-t border-border flex items-center justify-around px-4">
        <Link
          to="/"
          className="flex flex-col items-center gap-0.5 text-text-secondary hover:text-accent transition-colors"
        >
          <HomeIcon />
          <span className="text-xs">Home</span>
        </Link>
        <Link
          to="/browse"
          className="flex flex-col items-center gap-0.5 text-text-secondary hover:text-accent transition-colors"
        >
          <GridIcon />
          <span className="text-xs">Browse</span>
        </Link>
        {user && (
          <Link
            to="/activity"
            className="flex flex-col items-center gap-0.5 text-text-secondary hover:text-accent transition-colors"
          >
            <BellIcon />
            <span className="text-xs">Activity</span>
          </Link>
        )}
        {user?.is_real_user === 1 && (
          <Link
            to="/settings"
            className="flex flex-col items-center gap-0.5 text-text-secondary hover:text-accent transition-colors"
          >
            <GearIcon />
            <span className="text-xs">Settings</span>
          </Link>
        )}
        {user ? (
          <Link
            to={`/u/${user.username}`}
            className="flex flex-col items-center gap-0.5 text-text-secondary hover:text-accent transition-colors"
          >
            <img
              src={`https://api.dicebear.com/9.x/lorelei/svg?seed=${user.avatar_seed}`}
              alt=""
              className="w-6 h-6 rounded-full"
            />
            <span className="text-xs">Profile</span>
          </Link>
        ) : (
          <Link
            to="/login"
            className="flex flex-col items-center gap-0.5 text-text-secondary hover:text-accent transition-colors"
          >
            <UserIcon />
            <span className="text-xs">Log In</span>
          </Link>
        )}
      </nav>
    </>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
