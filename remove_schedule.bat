@echo off
schtasks /Delete /TN "FleetMind Night Build" /F
schtasks /Delete /TN "FleetMind Day Task" /F
echo Removed both FleetMind scheduled runs.
pause
