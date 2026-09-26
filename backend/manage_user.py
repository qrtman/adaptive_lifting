"""Operator commands for manually managing user access."""

import argparse
import json
import sys
import uuid

from .database import AuditEvent, SessionLocal, User


def promote_coach(email: str) -> int:
    normalized_email = email.strip().lower()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == normalized_email).one_or_none()
        if user is None:
            print(f"No account found for {normalized_email}.", file=sys.stderr)
            return 1
        if user.role == "COACH":
            print(f"{normalized_email} is already a coach; no change necessary.")
            return 0
        if user.role != "ATHLETE":
            print(f"Cannot promote account with role {user.role!r}.", file=sys.stderr)
            return 1

        user.role = "COACH"
        db.add(AuditEvent(
            id=str(uuid.uuid4()),
            actor_user_id=None,
            event_type="COACH_PROMOTED",
            resource_type="User",
            resource_id=user.id,
            metadata_json=json.dumps({"email": normalized_email}),
        ))
        db.commit()
        print(f"Promoted {normalized_email} to coach.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Manage Adaptive Lifting user access")
    subparsers = parser.add_subparsers(dest="command", required=True)
    promote_parser = subparsers.add_parser("promote-coach", help="Promote an athlete account to coach")
    promote_parser.add_argument("email", help="Email address of the existing account")
    args = parser.parse_args(argv)

    if args.command == "promote-coach":
        return promote_coach(args.email)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
