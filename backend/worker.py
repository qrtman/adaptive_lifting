"""Standalone process for database-backed integration jobs.

Run with ``python -m backend.worker``. Keep this process separate from Uvicorn:
API worker count must not change the number of integration consumers.
"""
import signal
import threading


def run_worker(stop_event=None, poll_interval=None, session_factory=None):
    """Run the outbox consumer until asked to stop; return after an idle poll."""
    from .main import on_startup
    from .integrations import OUTBOX_POLL_SECONDS, process_next_outbox_job

    # Apply the same fail-closed migration/configuration checks as the API.
    on_startup()
    stop_event = stop_event or threading.Event()
    interval = OUTBOX_POLL_SECONDS if poll_interval is None else poll_interval
    print("[adaptive_lifting] Starting standalone integration worker", flush=True)
    while not stop_event.is_set():
        try:
            processed = process_next_outbox_job(session_factory)
        except Exception as exc:
            # A transient DB/provider error should not permanently kill consumption.
            print(f"[WORKER ERROR] Outbox exception: {exc}", flush=True)
            processed = False
        if not processed:
            stop_event.wait(interval)


def main():
    stop_event = threading.Event()

    def request_shutdown(signum, _frame):
        print(f"[adaptive_lifting] Received signal {signum}; stopping worker", flush=True)
        stop_event.set()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)
    run_worker(stop_event=stop_event)


if __name__ == "__main__":
    main()
