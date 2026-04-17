import { useCallback } from 'react';
import { useSession } from '../store/useSession';

type ActionType = 'view_post' | 'visit_community' | 'upvote' | 'downvote' | 'dwell';
type TargetType = 'post' | 'community' | 'user';

const ACTIVITY_URL = `${import.meta.env.VITE_API_URL ?? ''}/api/activity`;

export function useActivityTracker() {
  const { user } = useSession();

  const track = useCallback(
    (
      action_type: ActionType,
      target_id: number,
      target_type: TargetType,
      metadata?: Record<string, unknown>,
    ) => {
      if (!user) return;
      const body = JSON.stringify({ action_type, target_id, target_type, metadata });
      fetch(ACTIVITY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        credentials: 'include',
      }).catch(() => {});
    },
    [user],
  );

  const trackDwell = useCallback(
    (target_id: number, target_type: TargetType, dwell_ms: number) => {
      if (!user) return;
      const body = JSON.stringify({
        action_type: 'dwell',
        target_id,
        target_type,
        metadata: { dwell_ms },
      });
      // sendBeacon survives page navigation
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ACTIVITY_URL, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(ACTIVITY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          credentials: 'include',
          keepalive: true,
        }).catch(() => {});
      }
    },
    [user],
  );

  return { track, trackDwell };
}
