; Crochets de l'installeur NSIS de WinTool.
; Branches par tauri.conf.json : bundle > windows > nsis > installerHooks.
;
; DESINSTALLATION, case « Supprimer les donnees de l'application » cochee, hors
; mise a jour : Tauri efface deja les donnees de l'interface
; (%LOCALAPPDATA%\com.wintool.app). Ce crochet efface le reste de ce que WinTool
; ecrit :
;
;   HKLM\SOFTWARE\WinTool\Approbations     magasin d'approbations (1.2+)
;   %LOCALAPPDATA%\WinTool                 reglages, historique, journaux,
;                                          catalogue installe
;   %ProgramData%\WinTool\approved.json    ancien magasin (1.0 a 1.1.1)
;
; Les SCRIPTS PERSONNELS de l'utilisateur sont conserves : ce sont ses
; creations, pas des traces de WinTool. Leur dossier n'est retire que s'il
; est vide.
;
; Aucune suppression recursive, et rien du tout si l'un des dossiers vises est
; une jonction ou un lien. Le desinstalleur tourne en administrateur, alors que
; ces dossiers sont inscriptibles par n'importe quel programme du compte : une
; jonction glissee a la place de « logs » ferait sinon effacer, avec les droits
; de l'administrateur, le dossier vers lequel elle pointe (specification 12.4).

!include FileFunc.nsh

; $R9 passe a 1 si CHEMIN existe et est un point d'analyse (jonction, lien).
!macro WINTOOL_SI_LIEN CHEMIN
  ${If} ${FileExists} "${CHEMIN}\*.*"
    ${GetFileAttributes} "${CHEMIN}" "REPARSE_POINT" $R8
    ${If} $R8 == 1
      StrCpy $R9 1
    ${EndIf}
  ${EndIf}
!macroend

; Efface les donnees de WinTool sous BASE (%LOCALAPPDATA%\WinTool), sans
; jamais descendre dans un dossier qui serait un lien.
!macro WINTOOL_EFFACER_DONNEES BASE
  Push $R8
  Push $R9
  StrCpy $R9 0
  !insertmacro WINTOOL_SI_LIEN "${BASE}"
  !insertmacro WINTOOL_SI_LIEN "${BASE}\logs"
  !insertmacro WINTOOL_SI_LIEN "${BASE}\sources"
  !insertmacro WINTOOL_SI_LIEN "${BASE}\sources\officiel"
  !insertmacro WINTOOL_SI_LIEN "${BASE}\scripts"
  ${If} $R9 = 0
    Delete "${BASE}\settings.json"
    Delete "${BASE}\settings-export.json"
    Delete "${BASE}\history.json"
    Delete "${BASE}\logs\*.*"
    RMDir "${BASE}\logs"
    Delete "${BASE}\sources\officiel\*.*"
    RMDir "${BASE}\sources\officiel"
    RMDir "${BASE}\sources"
    ; Les scripts personnels restent : le dossier ne part que s'il est vide.
    RMDir "${BASE}\scripts"
    RMDir "${BASE}"
  ${EndIf}
  Pop $R9
  Pop $R8
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ; Le registre 64 bits, celui qu'ecrit WinTool.
    SetRegView 64
    DeleteRegKey HKLM "SOFTWARE\WinTool\Approbations"
    DeleteRegKey /ifempty HKLM "SOFTWARE\WinTool"

    SetShellVarContext current
    !insertmacro WINTOOL_EFFACER_DONNEES "$LOCALAPPDATA\WinTool"

    ; Ancien magasin d'approbations. Un fichier nomme, puis le dossier s'il est
    ; vide : meme dans un dossier detourne, rien d'autre ne peut etre vise.
    SetShellVarContext all
    Delete "$APPDATA\WinTool\approved.json"
    RMDir "$APPDATA\WinTool"
  ${EndIf}
!macroend
