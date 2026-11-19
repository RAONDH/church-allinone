@echo off
rem Church All-in-One - made by Easy Pastor Lee Kwangbok
set "PORT=5191"
"%~dp0node\node.exe" "%~dp0hub\server\launch-check.mjs"
curl -s -o nul http://localhost:5191/api/health && goto open
cd /d "%~dp0hub"
start "ChurchAllInOne (close this window to quit)" /min "%~dp0node\node.exe" server\index.mjs
for /l %%i in (1,1,40) do (
  curl -s -o nul http://localhost:5191/api/health && goto open
  ping -n 2 127.0.0.1 >nul
)
:open
start "" http://localhost:5191
