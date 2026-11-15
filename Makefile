.PHONY: install backend frontend test snapshot build
install:
	cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt
	cd frontend && npm ci
backend:
	cd backend && . .venv/bin/activate && uvicorn app.main:app --reload --port 8000
frontend:
	cd frontend && npm run dev
test:
	cd backend && . .venv/bin/activate && MONETARY_DATA_MODE=snapshot python -m pytest -q
	cd frontend && npm run typecheck
snapshot:
	cd backend && . .venv/bin/activate && python -m scripts.build_snapshot
build:
	cd frontend && npm run build
