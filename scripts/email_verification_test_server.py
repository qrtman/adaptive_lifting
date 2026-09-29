"""Isolated Playwright backend. Never opens the application's normal database."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
database_path = Path(os.environ['E2E_TEST_DATABASE']).resolve()
if database_path.name != 'adaptive-email-verification-e2e.sqlite' or os.environ.get('APP_ENV') != 'test':
    raise RuntimeError('Disposable verification test database and APP_ENV=test required')
database_path.parent.mkdir(parents=True, exist_ok=True)
os.environ['DATABASE_URL'] = 'sqlite:///' + database_path.as_posix()

from alembic import command
from alembic.config import Config
command.upgrade(Config(str(ROOT / 'alembic.ini')), 'head')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('backend.main:app', host='127.0.0.1', port=8123, access_log=False)
