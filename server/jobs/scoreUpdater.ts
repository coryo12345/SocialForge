import db from '../db.js';

function newVotesForAge(currentScore: number, ageHours: number): number {
  const baseActivity = Math.sqrt(currentScore + 1) * 3;
  const decay = Math.exp(-ageHours / 4);
  return Math.floor(baseActivity * decay * (0.5 + Math.random()));
}

function runScoreUpdate() {
  const startedAt = Math.floor(Date.now() / 1000);
  const logId = (
    db
      .prepare(`INSERT INTO jobs_log (job_name, started_at, status) VALUES ('scoreUpdater', ?, 'running')`)
      .run(startedAt) as { lastInsertRowid: number }
  ).lastInsertRowid;

  try {
    const now = startedAt;

    // Posts published in the last 6 hours
    const recentPosts = db
      .prepare(
        `SELECT id, score, scheduled_at FROM posts
         WHERE scheduled_at > ? AND scheduled_at <= ? AND is_removed = 0`,
      )
      .all(now - 6 * 3600, now) as { id: number; score: number; scheduled_at: number }[];

    const updatePost = db.prepare(
      `UPDATE posts
       SET upvote_count   = upvote_count   + ?,
           downvote_count = downvote_count + ?,
           score          = upvote_count   + ? - downvote_count - ?
       WHERE id = ?`,
    );

    const applyPostVotes = db.transaction(() => {
      for (const post of recentPosts) {
        const ageHours = (now - post.scheduled_at) / 3600;
        const total = newVotesForAge(post.score, ageHours);
        if (total <= 0) continue;
        const ups = Math.round(total * 0.7);
        const downs = total - ups;
        updatePost.run(ups, downs, ups, downs, post.id);
      }
    });
    applyPostVotes();

    // Comments published in the last 3 hours
    const recentComments = db
      .prepare(
        `SELECT id, score, scheduled_at FROM comments
         WHERE scheduled_at > ? AND scheduled_at <= ? AND is_removed = 0`,
      )
      .all(now - 3 * 3600, now) as { id: number; score: number; scheduled_at: number }[];

    const updateComment = db.prepare(
      `UPDATE comments
       SET upvote_count   = upvote_count   + ?,
           downvote_count = downvote_count + ?,
           score          = upvote_count   + ? - downvote_count - ?
       WHERE id = ?`,
    );

    const applyCommentVotes = db.transaction(() => {
      for (const comment of recentComments) {
        const ageHours = (now - comment.scheduled_at) / 3600;
        const total = newVotesForAge(comment.score, ageHours);
        if (total <= 0) continue;
        const ups = Math.round(total * 0.7);
        const downs = total - ups;
        updateComment.run(ups, downs, ups, downs, comment.id);
      }
    });
    applyCommentVotes();

    db.prepare(
      `UPDATE jobs_log SET finished_at = ?, status = 'success', message = ? WHERE id = ?`,
    ).run(
      Math.floor(Date.now() / 1000),
      `Updated ${recentPosts.length} posts, ${recentComments.length} comments`,
      logId,
    );

    console.log(
      `[scoreUpdater] Updated ${recentPosts.length} posts, ${recentComments.length} comments`,
    );
  } catch (err) {
    db.prepare(
      `UPDATE jobs_log SET finished_at = ?, status = 'error', message = ? WHERE id = ?`,
    ).run(Math.floor(Date.now() / 1000), String(err), logId);
    console.error('[scoreUpdater] Error:', err);
  }
}

export function startScoreUpdater() {
  const intervalRow = db
    .prepare(`SELECT value FROM settings WHERE key = 'score_update_interval_minutes'`)
    .get() as { value: string } | undefined;
  const intervalMs = (parseInt(intervalRow?.value ?? '15') || 15) * 60_000;

  console.log(`[scoreUpdater] Starting — interval ${intervalMs / 60_000}min`);
  runScoreUpdate(); // run once immediately on startup
  setInterval(runScoreUpdate, intervalMs);
}
