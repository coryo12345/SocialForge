import { useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSession } from './store/useSession';
import Home from './pages/Home';
import Community from './pages/Community';
import PostPage from './pages/PostPage';
import UserProfile from './pages/UserProfile';
import Login from './pages/Login';
import Settings from './pages/Settings';
import Browse from './pages/Browse';
import Activity from './pages/Activity';
import Search from './pages/Search';
import OfflineBanner from './components/OfflineBanner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/r/:community', element: <Community /> },
  { path: '/r/:community/:postId', element: <PostPage /> },
  { path: '/u/:username', element: <UserProfile /> },
  { path: '/login', element: <Login /> },
  { path: '/settings', element: <Settings /> },
  { path: '/browse', element: <Browse /> },
  { path: '/activity', element: <Activity /> },
  { path: '/search', element: <Search /> },
]);

function ThemeApplier() {
  const { theme, getResolvedTheme } = useSession();

  useEffect(() => {
    const resolved = getResolvedTheme();
    document.documentElement.classList.toggle('dark', resolved === 'dark');

    // Update theme-color meta tag
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', resolved === 'dark' ? '#0d1117' : '#f7f4ef');
    }
  }, [theme, getResolvedTheme]);

  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeApplier />
      <OfflineBanner />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
