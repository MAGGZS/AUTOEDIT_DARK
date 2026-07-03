@echo off
echo Iniciando AutoEdit...

:: Inicia o backend em uma janela separada
start "AutoEdit Backend" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

:: Aguarda o backend subir
timeout /t 3 /nobreak >nul

:: Inicia o frontend
start "AutoEdit Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Backend: http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Pressione qualquer tecla para fechar esta janela (os servidores continuam rodando).
pause
