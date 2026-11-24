; ─────────────────────────────────────────────────────────────────────────────
;  Claude Usage Monitor — Custom NSIS installer hooks
; ─────────────────────────────────────────────────────────────────────────────

!macro customInstall
  ; Overwrite the DisplayName registry entry to remove the version suffix.
  ; SHCTX resolves to HKCU for per-user installs (our default).
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" \
    "DisplayName" "Claude Usage Monitor"
!macroend

!macro customUnInstall
  ; Kill any running instance before deleting files.
  ; /F = force terminate, /T = also kill child processes (Electron renderer, GPU helper, etc.)
  DetailPrint "Stopping Claude Usage Monitor..."
  nsExec::ExecToLog 'taskkill /F /T /IM "Claude Usage Monitor.exe"'
  Sleep 4000
  ; Force-remove install directory contents. The uninstaller exe itself runs
  ; from this folder so Windows keeps the directory handle open — the empty
  ; folder will remain after uninstall. This is a known NSIS limitation.
  RMDir /r "$INSTDIR"
  ; Remove all user data — config, history, and the Claude.ai session.
  ; Electron names the userData folder after package.json "name" (claude-usage-monitor).
  ; $APPDATA resolves to the current user's AppData\Roaming folder.
  DetailPrint "Removing user data..."
  RMDir /r "$APPDATA\claude-usage-monitor"
!macroend
