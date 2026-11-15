@echo off
rem Jarvis installeren en starten met een dubbelklik (Windows).
rem   start.bat               -> web-app voor computer en telefoon (zelfde wifi)
rem   start.bat --connector   -> ook als connector voor de telefoonversie op claude.ai
setlocal
cd /d "%~dp0"

where python >nul 2>nul || (
  echo Python 3.10 of nieuwer is nodig: https://www.python.org/downloads/
  pause & exit /b 1
)

if not exist .venv (
  echo Eerste keer: Jarvis installeren...
  python -m venv .venv || (pause & exit /b 1)
)
call .venv\Scripts\activate.bat
python -m pip install -q --upgrade pip
pip install -q -r requirements.txt || (pause & exit /b 1)
pip install -q -r requirements-home.txt 2>nul || echo Let op: de Google Home-pakketten konden niet worden geinstalleerd; de rest werkt wel.

if "%ANTHROPIC_API_KEY%"=="" if exist .env (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do if "%%a"=="ANTHROPIC_API_KEY" set "ANTHROPIC_API_KEY=%%b"
)
if "%ANTHROPIC_API_KEY%"=="" (
  echo Maak een API-sleutel aan op https://console.anthropic.com
  set /p "ANTHROPIC_API_KEY=Plak je API-sleutel (begint met sk-ant-): "
)
if not exist .env (echo ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY%> .env)

if "%~1"=="" (python -m jarvis web --telefoon) else (python -m jarvis web %*)
pause
