@echo off
REM Run once. Creates two daily Windows tasks for FleetMind.
schtasks /Create /TN "FleetMind Night Build" /TR "%~dp0night.bat" /SC DAILY /ST 03:00 /F
schtasks /Create /TN "FleetMind Day Task" /TR "%~dp0day.bat" /SC DAILY /ST 14:00 /F
echo.
echo Done. Night run 03:00, day run 14:00. Keep the PC on and set Sleep to Never.
pause
