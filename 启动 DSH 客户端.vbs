' 静默启动 DSH 桌面客户端：不弹黑框，直接拉起 Electron 应用。
Option Explicit

Dim shell, fso, root
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
shell.Run """" & root & "\node_modules\electron\dist\electron.exe"" .", 0, False
