@echo off
cd /d "%~dp0"
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not exist venv\Scripts\python.exe (
  if not defined PY (echo PYTHON_MISSING & exit /b 9)
  %PY% -m venv venv || (echo PYTHON_MISSING & exit /b 9)
  venv\Scripts\python -m pip install -q pyhwp olefile tqdm flask six pypdf || exit /b 1
)
set FLASK_DEBUG=0
venv\Scripts\python -m flask --app app run --host 127.0.0.1 --port 5050 --no-debugger --no-reload
