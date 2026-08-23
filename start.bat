@echo off
setlocal

echo ============================================
echo  FLAXY - Iniciando
echo ============================================

set "BACKEND_PORT=8000"
set "FRONTEND_PORT=5173"

:: Renders simultaneos de FFmpeg. 1 e o ideal na maioria das maquinas: dois
:: encoders disputando a mesma CPU/GPU terminam mais devagar que em fila.
if not defined FLAXY_MAX_CONCURRENT set "FLAXY_MAX_CONCURRENT=1"

:: Bind em 127.0.0.1 e nao em 0.0.0.0: a API nao tem autenticacao e aceita
:: qualquer origem (CORS *), entao expo-la na rede local libera os seus arquivos
:: para qualquer maquina do wi-fi. Para acessar de outro dispositivo de
:: proposito, troque por 0.0.0.0 e ajuste VITE_API_URL no frontend.
start "FLAXY Backend" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 127.0.0.1 --port %BACKEND_PORT% --reload"

:: Espera o backend responder de verdade, em vez de chutar 3 segundos.
:: /health so passa a existir depois que a aplicacao terminou de subir.
where curl >nul 2>&1
if errorlevel 1 (
    echo curl nao encontrado - aguardando tempo fixo...
    call :sleep 5
    goto :frontend
)

echo.
echo Aguardando o backend responder...
set /a TRIES=0

:wait
curl -s -f -m 2 http://127.0.0.1:%BACKEND_PORT%/health >nul 2>&1
if not errorlevel 1 goto :ready
set /a TRIES+=1
if %TRIES% GEQ 30 (
    echo.
    echo AVISO: o backend nao respondeu em 30 tentativas.
    echo Veja o erro na janela "FLAXY Backend".
    goto :frontend
)
call :sleep 1
goto :wait

:ready
echo Backend no ar.

:: /health responde {"status":"ok","ffmpeg":true|false} - ffmpeg e o unico
:: campo booleano, entao achar "false" na resposta ja identifica o problema.
curl -s -m 2 http://127.0.0.1:%BACKEND_PORT%/health | find "false" >nul
if not errorlevel 1 (
    echo.
    echo AVISO: FFmpeg nao esta no PATH. O processamento vai falhar.
    echo Baixe em https://www.gyan.dev/ffmpeg/builds/ e adicione a pasta bin ao PATH.
)

:frontend
start "FLAXY Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
call :sleep 4
start "" http://localhost:%FRONTEND_PORT%

echo.
echo ============================================
echo   Frontend: http://localhost:%FRONTEND_PORT%
echo   Backend:  http://localhost:%BACKEND_PORT%
echo   API docs: http://localhost:%BACKEND_PORT%/docs
echo.
echo   Renders simultaneos: %FLAXY_MAX_CONCURRENT%
echo ============================================
echo.
echo Os servidores continuam rodando nas outras duas janelas.
echo Fechar esta janela nao para nada.
pause
endlocal
exit /b

:: Pausa de N segundos. `timeout` seria mais legivel, mas aborta quando o
:: script roda sem console interativo, e ai o laco de espera giraria sem pausa.
:sleep
:: ping -n N espera N-1 segundos (o intervalo fica ENTRE os envios), entao
:: soma-se 1 para que "call :sleep 3" realmente pause 3 segundos.
setlocal
set /a "_S=%~1+1"
ping -n %_S% -w 1000 127.0.0.1 >nul 2>&1
endlocal
exit /b
