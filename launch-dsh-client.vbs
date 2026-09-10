' Silently launch the DSH desktop client: no console window, straight to the Electron app.
Option Explicit

Dim shell, fso, root
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
shell.Run """" & root & "\node_modules\electron\dist\electron.exe"" .", 0, False
