@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or later from https://nodejs.org, then run this launcher again.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo GeneRecall requires Node.js 22 or later. Update Node.js and try again.
  pause
  exit /b 1
)
echo Starting GeneRecall. Open the Local URL printed below. Keep this window open while using it.
node scripts/serve.mjs
if errorlevel 1 pause
