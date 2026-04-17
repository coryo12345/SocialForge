"""Wrapper that runs full daily generation: posts then comments."""

import argparse
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description="Run full daily content generation")
    parser.add_argument("--date", default="today", help="Date in YYYY-MM-DD format or 'today'")
    parser.add_argument("--count", type=int, default=None, help="Number of posts (default: use settings)")
    parser.add_argument("--community", default=None, help="Only generate for this community slug")
    args = parser.parse_args()

    post_cmd = [sys.executable, "generate_posts.py", "--date", args.date]
    if args.count is not None:
        post_cmd += ["--count", str(args.count)]
    if args.community:
        post_cmd += ["--community", args.community]

    comment_cmd = [sys.executable, "generate_comments.py", "--date", args.date]
    if args.community:
        comment_cmd += ["--community", args.community]

    print(f"=== Step 1: Generating posts for {args.date} ===")
    result = subprocess.run(post_cmd, check=False)
    if result.returncode != 0:
        print("Post generation failed. Aborting.")
        sys.exit(result.returncode)

    print(f"\n=== Step 2: Generating comments for {args.date} ===")
    result = subprocess.run(comment_cmd, check=False)
    if result.returncode != 0:
        print("Comment generation failed.")
        sys.exit(result.returncode)

    print("\n=== Daily generation complete ===")


if __name__ == "__main__":
    main()
