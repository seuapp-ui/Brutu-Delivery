Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & fso.GetParentFolderName(WScript.ScriptFullName) & "\iniciar-local.ps1""", 0, False
