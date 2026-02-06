@echo off
title MongoDiff - Comparador de Bases de Datos
color 0B

:: Asegurar que el directorio de trabajo es donde está el .bat
cd /d "%~dp0"

echo ===================================================
echo    INICIANDO MONGODIFF (MODO DESARROLLO)
echo ===================================================
echo.

if not exist "node_modules" (
    echo [!] Instalando dependencias globales...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Fallo al instalar dependencias globales.
        pause
        exit /b 1
    )
)

if not exist "backend\node_modules" (
    echo [!] Instalando dependencias del backend...
    pushd backend
    call npm install
    if errorlevel 1 (
        echo [ERROR] Fallo al instalar dependencias del backend.
        popd
        pause
        exit /b 1
    )
    popd
)

if not exist "frontend\node_modules" (
    echo [!] Instalando dependencias del frontend...
    pushd frontend
    call npm install
    if errorlevel 1 (
        echo [ERROR] Fallo al instalar dependencias del frontend.
        popd
        pause
        exit /b 1
    )
    popd
)

echo.
echo [1/2] Iniciando servidores (Backend + Frontend)...
echo.
echo    - Backend:  http://localhost:5000
echo    - Frontend: http://localhost:5173
echo.

:: Abrir navegador después de un breve retardo
echo [2/2] Abriendo navegador...
start "" http://localhost:5173

:: Iniciar ambos servidores con concurrently
npm run dev

pause
