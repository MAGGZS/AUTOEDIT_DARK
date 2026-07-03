@echo off
echo ============================================
echo  AutoEdit - Script de Instalacao
echo ============================================

echo.
echo [1/4] Verificando Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERRO: Python nao encontrado. Instale Python 3.11+ em https://python.org
    pause & exit /b 1
)

echo [2/4] Verificando FFmpeg...
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo AVISO: FFmpeg nao encontrado no PATH.
    echo Baixe em https://www.gyan.dev/ffmpeg/builds/ e adicione ao PATH do sistema.
    echo Pressione qualquer tecla para continuar mesmo assim...
    pause
)

echo [3/4] Instalando dependencias Python...
cd backend
python -m pip install -r requirements.txt
cd ..

echo [4/4] Instalando dependencias Node.js...
cd frontend
npm install
cd ..

echo.
echo ============================================
echo  Instalacao concluida!
echo  Execute start.bat para iniciar o sistema.
echo ============================================
pause
