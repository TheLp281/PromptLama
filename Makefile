.PHONY: run run-production lint format install clean

run:
	@echo Starting the VoiceAI app...
	@if [ -f venv/bin/python ]; then \
		venv/bin/python -m uvicorn main:app --reload --host 0.0.0.0; \
	else \
		venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0; \
	fi

run-production:
	@echo Starting the VoiceAI app...
	@if [ -f venv/bin/python ]; then \
		venv/bin/python -m uvicorn main:app --host 0.0.0.0; \
	else \
		venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0; \
	fi


lint:
	@echo Running Ruff linter...
	@if [ -f venv/bin/python ]; then \
		venv/bin/python -m ruff check . --fix; \
	else \
		venv\Scripts\python.exe -m ruff check . --fix; \
	fi

format:
	@echo Formatting code with Ruff...
	@if [ -f venv/bin/python ]; then \
		venv/bin/python -m ruff format .; \
	else \
		venv\Scripts\python.exe -m ruff format .; \
	fi
	npx prettier static/index.html --write
	npx prettier static/main.js --write


install:
	@echo Installing dependencies...
	python -m venv venv
	@if [ -f venv/bin/python ]; then \
		venv/bin/python -m pip install -r requirements.txt; \
	else \
		venv\Scripts\python.exe -m pip install -r requirements.txt; \
	fi

clean:
	@echo Cleaning up...
	python -c "import os, pathlib; [p.unlink() for p in pathlib.Path('.').rglob('*.pyc')]; [p.rmdir() for p in pathlib.Path('.').rglob('__pycache__') if p.is_dir()]"
