; 构建期自检：把 electron-builder 真正传给 makensis 的「快捷方式名 / 卸载项名」打到构建日志里。
;
; 为什么要这么做：安装程序的 NSIS 头部是 LZMA 压实的，装完之后才能看到快捷方式叫什么。
; 这个 include 让 `!echo` 在**编译期**把实际取值吐出来，构建日志里就能直接核对，
; 不用真的往系统里装一遍。
;
; 由 electron-builder.config.js 的 nsis.include 引入。

!ifdef SHORTCUT_NAME
  !echo "[nsis] SHORTCUT_NAME=${SHORTCUT_NAME}"
!else
  !echo "[nsis] SHORTCUT_NAME=<undefined>"
!endif

!ifdef UNINSTALL_DISPLAY_NAME
  !echo "[nsis] UNINSTALL_DISPLAY_NAME=${UNINSTALL_DISPLAY_NAME}"
!else
  !echo "[nsis] UNINSTALL_DISPLAY_NAME=<undefined>"
!endif

; ============================================================================
; 覆盖「应用正在运行」的检查
; ============================================================================
;
; 为什么需要：
;   electron-builder 默认用
;     Get-CimInstance Win32_Process | ? { $_.Path.StartsWith($INSTDIR) }
;   判断应用是否还在跑，然后 taskkill **同名进程**、复查、最多重试一次，
;   仍关不掉就弹「无法关闭，请手动关闭后重试」并退出安装。
;
;   我们的客户端一次会拉起 **9 个 Electron 进程**（主进程 / GPU / 渲染 /
;   工具进程 / DSH 服务子进程），可执行路径全都在安装目录下。
;   只 taskkill 同名进程时，残留的子进程会让复查一直判定「还在运行」，
;   于是用户看到那句提示、安装卡住。
;
; 这里改成按「安装目录前缀」把整批进程都结束，并给 Electron 收尾留时间。
; 宏名 customCheckAppRunning 是 electron-builder 的约定：
;   定义它之后，默认实现就不会被插入（见 allowOnlyOneInstallerInstance.nsh）。

; 循环计数器。NSIS 的 Var 是全局声明，放在顶层避免在宏里重复定义。
Var DshsdKillRound

; 寻找「可执行路径属于本安装目录」的进程并全部结束。
; 判据与 electron-builder 默认实现一致（都看 $INSTDIR 前缀），
; 区别在于我们对**全部匹配进程**动手，而不只是同名的那个。
;
; 注意：这两个宏必须定义在**顶层** —— NSIS 不允许在一个宏里再定义宏
; （会报 "can't define a macro inside a macro!"，实测踩过）。
!macro DSHSD_KILL_APP_DIR
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
!macroend


; 判断「还有没有属于安装目录的进程」。
;
; 用 PowerShell 的**退出码**表达结果（0=还有进程，1=没有），而不是把计数读回来
; 再解析字符串 —— nsExec::ExecToStack 取回文本后要 TrimNewlines 之类的处理，
; 而那些宏依赖额外的 include，在这个上下文里不一定可用（实测报
; "Error in macro DSHSD_COUNT_APP_DIR on macroline 4"）。
; 用退出码就只涉及 nsExec::Exec + Pop，没有任何额外依赖。
;
;   exit 0 → 还有 ≥1 个进程（要继续等/继续杀）
;   exit 1 → 干净了
!macro DSHSD_APP_DIR_BUSY _OUT
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "if (@(Get-CimInstance Win32_Process | Where-Object { $$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase') }).Count -gt 0) { exit 0 } else { exit 1 }"`
  Pop ${_OUT}
!macroend

!macro customCheckAppRunning
  ; 变量在顶层声明（见上面的 Var）
  StrCpy $DshsdKillRound 0

  dshsd_kill_loop:
    IntOp $DshsdKillRound $DshsdKillRound + 1

    ; 先看有没有在跑的；没有就直接放行，别白白等几秒
    !insertmacro DSHSD_APP_DIR_BUSY $R0
    ${If} $R0 != 0
      Goto dshsd_check_done
    ${EndIf}

    !insertmacro DSHSD_KILL_APP_DIR
    ; 给 Electron 的子进程留退出时间：它要收尾日志、停掉 DSH 服务
    Sleep 1500

    !insertmacro DSHSD_APP_DIR_BUSY $R0
    ${If} $R0 != 0
      Goto dshsd_check_done
    ${EndIf}

    ${If} $DshsdKillRound < 4
      Sleep 1000
      Goto dshsd_kill_loop
    ${EndIf}

    ; 反复杀不掉：多半是提权运行的实例（普通权限杀不动），或文件被占用。
    ; 此时才提示用户，并保留「重试」让安装器再走一遍上面的流程。
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY dshsd_kill_loop
    Quit

  dshsd_check_done:
!macroend

!echo "[nsis] customCheckAppRunning 已定义（按安装目录整树结束进程）"

