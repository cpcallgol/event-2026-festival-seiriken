@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo 紅華祭 整理券 - 公開版（GitHub Pages：makosana と cpcallgol）を更新します
echo.

if not exist ".git" (
  echo このフォルダーはGitリポジトリではありません。
  goto fail
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git が見つかりません。
  goto fail
)

rem このPCにビルド環境（以前のビルドで作った一時フォルダー）があれば、先に online を作り直す
set "NODE_DIR=%TEMP%\seiriken-build\node-v24.22.0-win-x64"
set "BUILD_SRC=%TEMP%\seiriken-build\source"
if not exist "%NODE_DIR%\node.exe" goto nobuild
if not exist "%BUILD_SRC%\node_modules\vite" goto nobuild
if not exist "source\.env.online" goto nobuild

echo [1/4] オンライン版をビルドしています...
robocopy "source" "%BUILD_SRC%" /E /XD node_modules /NFL /NDL /NJH /NJS /NP >nul
set "SEIRIKEN_OUTPUT=%CD%"
"%NODE_DIR%\node.exe" "%BUILD_SRC%\build-online.mjs"
if errorlevel 1 (
  echo ビルドに失敗しました。上に表示された内容を確認してください。
  goto fail
)
goto commit

:nobuild
echo [1/4] このPCにはビルド環境がないため、今ある online フォルダーをそのまま公開します。
echo       （source を書き換えた場合は、先にビルドしてください）

:commit
echo.
echo [2/4] 変更を記録しています...
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"') do set "TODAY=%%i"
for /f "tokens=2" %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"') do set "NOWTIME=%%i"
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -q -m "更新 %TODAY% %NOWTIME%"
  if errorlevel 1 goto fail
) else (
  echo       変更はありません。
)

rem 公開ページ（gh-pages）の中身は online フォルダー。1回だけ切り出して、両方の公開先に同じものを送る
set "SPLIT="
for /f %%i in ('git subtree split --prefix online 2^>nul') do set "SPLIT=%%i"
if not defined SPLIT (
  echo online フォルダーを公開用に切り出せませんでした。
  goto fail
)

echo.
echo [3/4] makosana の公開先に送っています（main と 公開ページ）...
git push origin main
if errorlevel 1 goto fail
git push origin %SPLIT%:refs/heads/gh-pages
if errorlevel 1 goto fail

echo.
set "FESTIVAL=ok"
git remote get-url festival >nul 2>nul
if errorlevel 1 (
  set "FESTIVAL=none"
  echo [4/4] cpcallgol の公開先は登録されていないので、とばします。
  goto done
)
echo [4/4] cpcallgol の公開先に送っています（main と 公開ページ）...
git push festival main
if errorlevel 1 set "FESTIVAL=fail"
if "%FESTIVAL%"=="ok" git push festival %SPLIT%:refs/heads/gh-pages
if errorlevel 1 set "FESTIVAL=fail"

:done
echo.
echo 完了しました。1〜2分後に反映されます。
echo   来場者用: https://makosana.github.io/koukasai_seiriken/
echo   運営画面: https://makosana.github.io/koukasai_seiriken/#/admin
if "%FESTIVAL%"=="ok" (
  echo   来場者用: https://cpcallgol.github.io/event-2026-festival-seiriken/
  echo   運営画面: https://cpcallgol.github.io/event-2026-festival-seiriken/#/admin
)
if "%FESTIVAL%"=="fail" (
  echo.
  echo ※ makosana には公開できましたが、cpcallgol には送れませんでした。
  echo    このPCでログインしている GitHub のアカウントに、cpcallgol のリポジトリへ書き込む権限があるか確かめてください。
  echo    権限を直してから、もう一度 publish.bat を実行すれば、両方に送られます。
)
echo.
echo 掲示するQRは、どちらか片方のURLにそろえてください（整理券はURLごとに保存されるため）。
echo.
pause
endlocal
exit /b 0

:fail
echo.
echo 更新できませんでした。上に表示された内容を確認してください。
pause
endlocal
exit /b 1
