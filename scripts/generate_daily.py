"""Wrapper that runs full daily generation: posts then comments.

Optional Phase 3 flags:
  --sync-relationships  Run generate_relationships.py before posts (one-time or periodic top-up)
  --build-memory        Run build_user_memory.py after comments (incremental)
"""

import argparse
import subprocess
import sys


def run(cmd: list, label: str) -> bool:
    print(f"\n=== {label} ===")
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print(f"{label} failed (exit {result.returncode}).")
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Run full daily content generation")
    parser.add_argument("--date", default="today", help="Date in YYYY-MM-DD format or 'today'")
    parser.add_argument("--count", type=int, default=None, help="Number of posts (default: use settings)")
    parser.add_argument("--community", default=None, help="Only generate for this community slug")
    parser.add_argument("--sync-relationships", action="store_true",
                        help="Run generate_relationships.py first (Phase 3: build relationship graph)")
    parser.add_argument("--build-memory", action="store_true",
                        help="Run build_user_memory.py after comments (Phase 3: update user memory)")
    parser.add_argument("--no-abort-on-failure", action="store_true",
                        help="Continue even if a step fails")
    args = parser.parse_args()

    post_cmd = [sys.executable, "generate_posts.py", "--date", args.date]
    if args.count is not None:
        post_cmd += ["--count", str(args.count)]
    if args.community:
        post_cmd += ["--community", args.community]

    comment_cmd = [sys.executable, "generate_comments.py", "--date", args.date]
    if args.community:
        comment_cmd += ["--community", args.community]

    # Step 0 (optional): sync relationship graph
    if args.sync_relationships:
        ok = run([sys.executable, "generate_relationships.py"], "Step 0: Syncing user relationships")
        if not ok and not args.no_abort_on_failure:
            print("Aborting.")
            sys.exit(1)

    # Step 1: generate posts
    ok = run(post_cmd, f"Step 1: Generating posts for {args.date}")
    if not ok:
        print("Post generation failed. Aborting.")
        sys.exit(1)

    # Step 2: generate comments
    ok = run(comment_cmd, f"Step 2: Generating comments for {args.date}")
    if not ok and not args.no_abort_on_failure:
        print("Comment generation failed.")
        sys.exit(1)

    # Step 3 (optional): build user memory (runs after content exists)
    if args.build_memory:
        run(
            [sys.executable, "build_user_memory.py", "--all-users", "--incremental"],
            "Step 3: Building user memory (incremental)",
        )

    print("\n=== Daily generation complete ===")


if __name__ == "__main__":
    main()
