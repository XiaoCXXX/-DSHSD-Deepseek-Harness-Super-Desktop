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
