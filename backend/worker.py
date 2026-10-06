"""Deprecated integration worker entry point.

Google Sheets outbox processing now runs from Supabase Cron and its private
Edge worker. This module intentionally does not consume integration jobs.
"""
def run_worker(stop_event=None, poll_interval=None, session_factory=None):
    """Exit without polling: all supported outbox work is Supabase-native."""
    del stop_event, poll_interval, session_factory
    return None


def main():
    # Retained as a harmless no-op so an old process command cannot compete
    # with the Supabase Cron worker for Google Sheets jobs.
    return run_worker()


if __name__ == "__main__":
    main()
