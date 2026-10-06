; Crochets de l'installeur NSIS de WinTool.
; Branchés par tauri.conf.json (bundle > windows > nsis > installerHooks), et
; complétés par le modèle dérivé de Tauri (tools/modele-installeur.mjs), qui
; insère WINTOOL_PAGE_DESINSTALLATION et WINTOOL_EFFACER_ARBRE.
;
; DÉSINSTALLATION — la page de WinTool remplace celle de Tauri :
;
;   ( ) Garder mes données                       rien n'est effacé
;   ( ) Tout effacer, sauf mes scripts personnels
;   ( ) Choisir ce qui est effacé : réglages, historique, journaux, catalogue,
;       autorisations des scripts, emplacements protégés, données de
;       l'interface, scripts personnels
;
; Une mise à jour, une désinstallation silencieuse ou passive n'efface rien.
;
; SÉCURITÉ. Le désinstalleur tourne en administrateur, et la plupart de ces
; dossiers sont inscriptibles par n'importe quel programme du compte. Or
; « RMDir /r » de NSIS SUIT les jonctions (vérifié) : une jonction glissée dans
; l'un d'eux vers System32 ferait vider System32. Aucune suppression ici ne
; passe donc par « RMDir /r » : WINTOOL_EFFACER_ARBRE parcourt lui-même les
; dossiers, et retire un lien rencontré sans jamais descendre dedans.

!include nsDialogs.nsh
!include FileFunc.nsh
!include LogicLib.nsh

; --- Effacement sûr ---------------------------------------------------------

; Efface un dossier et son contenu, sans jamais suivre une jonction ni un lien :
; un lien rencontré est retiré lui-même (le lien, pas sa cible). Paramètre : le
; chemin, sur la pile.
Function un.WtEffacerArbre
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  ${GetFileAttributes} "$R0" "REPARSE_POINT" $R3
  ${If} $R3 == 1
    RMDir "$R0"
    Goto wt_arbre_fin
  ${EndIf}
  ClearErrors
  FindFirst $R1 $R2 "$R0\*.*"
  wt_arbre_boucle:
    IfErrors wt_arbre_vu
    StrCmp $R2 "" wt_arbre_vu
    StrCmp $R2 "." wt_arbre_suivant
    StrCmp $R2 ".." wt_arbre_suivant
    ${If} ${FileExists} "$R0\$R2\*.*"
      Push "$R0\$R2"
      Call un.WtEffacerArbre
    ${Else}
      Delete "$R0\$R2"
    ${EndIf}
    wt_arbre_suivant:
    ClearErrors
    FindNext $R1 $R2
    Goto wt_arbre_boucle
  wt_arbre_vu:
  FindClose $R1
  RMDir "$R0"
  wt_arbre_fin:
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

!macro WINTOOL_EFFACER_ARBRE CHEMIN
  ${If} ${FileExists} "${CHEMIN}\*.*"
    Push "${CHEMIN}"
    Call un.WtEffacerArbre
  ${EndIf}
!macroend

; Les données de WinTool sous BASE (%LOCALAPPDATA%\WinTool), selon les choix
; de la page. Rien du tout si BASE est lui-même un lien.
!macro WINTOOL_EFFACER_DONNEES BASE
  Push $R8
  ${GetFileAttributes} "${BASE}" "REPARSE_POINT" $R8
  ${If} $R8 != 1
    ${If} $WtReglages == 1
      Delete "${BASE}\settings.json"
      Delete "${BASE}\settings-export.json"
    ${EndIf}
    ${If} $WtHistorique == 1
      Delete "${BASE}\history.json"
    ${EndIf}
    ${If} $WtJournaux == 1
      !insertmacro WINTOOL_EFFACER_ARBRE "${BASE}\logs"
    ${EndIf}
    ${If} $WtCatalogue == 1
      !insertmacro WINTOOL_EFFACER_ARBRE "${BASE}\sources"
    ${EndIf}
    ${If} $WtScripts == 1
      !insertmacro WINTOOL_EFFACER_ARBRE "${BASE}\scripts"
    ${EndIf}
    ; Le dossier ne part que s'il est vide : ce qui n'a pas été choisi reste.
    RMDir "${BASE}"
  ${EndIf}
  Pop $R8
!macroend

; --- La page de désinstallation ---------------------------------------------

; Texte selon la langue de l'installeur (1036 : français).
!macro WT_TEXTE VAR FR EN
  ${If} $LANGUAGE = 1036
    StrCpy ${VAR} "${FR}"
  ${Else}
    StrCpy ${VAR} "${EN}"
  ${EndIf}
!macroend

!macro WT_CASE VAR X Y FR EN
  !insertmacro WT_TEXTE $R0 "${FR}" "${EN}"
  ${NSD_CreateCheckbox} ${X} ${Y} 44% 10u "$R0"
  Pop ${VAR}
!macroend

; Insérée par le modèle dérivé à la place de la page de confirmation de Tauri,
; APRÈS la déclaration de ses variables ($PassiveMode, $UpdateMode,
; $DeleteAppDataCheckboxState) : c'est ce qui permet de les utiliser ici.
!macro WINTOOL_PAGE_DESINSTALLATION
  Var WtDialogue
  Var WtRadioGarder
  Var WtRadioSimple
  Var WtRadioAvance
  Var WtCaseReglages
  Var WtCaseHistorique
  Var WtCaseJournaux
  Var WtCaseCatalogue
  Var WtCaseApprobations
  Var WtCaseGarde
  Var WtCaseInterface
  Var WtCaseScripts
  Var WtReglages
  Var WtHistorique
  Var WtJournaux
  Var WtCatalogue
  Var WtApprobations
  Var WtGarde
  Var WtInterface
  Var WtScripts

  UninstPage custom un.WtPageCreer un.WtPageQuitter

  Function un.WtPageCreer
    ; Une mise à jour ou une désinstallation passive ne demande rien, et
    ; n'efface rien.
    ${If} $PassiveMode = 1
    ${OrIf} $UpdateMode = 1
      Abort
    ${EndIf}

    !insertmacro WT_TEXTE $R1 "Désinstaller WinTool" "Uninstall WinTool"
    !insertmacro WT_TEXTE $R2 "Que doit-il rester de WinTool sur ce PC ?" "What should remain of WinTool on this PC?"
    !insertmacro MUI_HEADER_TEXT "$R1" "$R2"

    nsDialogs::Create 1018
    Pop $WtDialogue
    ${If} $WtDialogue == error
      Abort
    ${EndIf}

    !insertmacro WT_TEXTE $R0 "Les scripts que vous avez écrits ou ajoutés vous appartiennent : ils ne sont effacés que si vous le demandez." "The scripts you wrote or added are yours: they are only deleted if you ask for it."
    ${NSD_CreateLabel} 0 0 100% 20u "$R0"
    Pop $R0

    !insertmacro WT_TEXTE $R0 "Garder mes données (pour une réinstallation, par exemple)" "Keep my data (to reinstall later, for example)"
    ${NSD_CreateRadioButton} 0 24u 100% 10u "$R0"
    Pop $WtRadioGarder
    ${NSD_AddStyle} $WtRadioGarder ${WS_GROUP}
    !insertmacro WT_TEXTE $R0 "Tout effacer, sauf mes scripts personnels" "Delete everything except my personal scripts"
    ${NSD_CreateRadioButton} 0 36u 100% 10u "$R0"
    Pop $WtRadioSimple
    !insertmacro WT_TEXTE $R0 "Choisir ce qui est effacé :" "Choose what is deleted:"
    ${NSD_CreateRadioButton} 0 48u 100% 10u "$R0"
    Pop $WtRadioAvance

    !insertmacro WT_CASE $WtCaseReglages 12u 62u "Réglages" "Settings"
    !insertmacro WT_CASE $WtCaseHistorique 56% 62u "Historique" "History"
    !insertmacro WT_CASE $WtCaseJournaux 12u 74u "Journaux" "Logs"
    !insertmacro WT_CASE $WtCaseCatalogue 56% 74u "Catalogue installé" "Installed catalogue"
    !insertmacro WT_CASE $WtCaseApprobations 12u 86u "Scripts approuvés" "Approved scripts"
    !insertmacro WT_CASE $WtCaseGarde 56% 86u "Emplacements protégés" "Protected locations"
    !insertmacro WT_CASE $WtCaseInterface 12u 98u "Données de l'interface" "Interface data"
    !insertmacro WT_CASE $WtCaseScripts 56% 98u "Mes scripts personnels" "My personal scripts"

    ${NSD_OnClick} $WtRadioGarder un.WtSurChoix
    ${NSD_OnClick} $WtRadioSimple un.WtSurChoix
    ${NSD_OnClick} $WtRadioAvance un.WtSurChoix
    ${NSD_Check} $WtRadioGarder
    ; Comme un clic : la fonction attend le contrôle sur la pile.
    Push $WtRadioGarder
    Call un.WtSurChoix

    ; Cette page est la dernière avant l'effacement : son bouton le dit.
    GetDlgItem $R0 $HWNDPARENT 1
    SendMessage $R0 ${WM_SETTEXT} 0 "STR:$(^UninstallBtn)"

    nsDialogs::Show
  FunctionEnd

  ; « Garder » décoche tout, « Tout sauf mes scripts » coche tout sauf les
  ; scripts ; dans les deux cas les cases montrent le résultat sans se
  ; modifier. « Choisir » les rend modifiables.
  Function un.WtSurChoix
    Pop $R9
    ${NSD_GetState} $WtRadioAvance $R0
    ${NSD_GetState} $WtRadioSimple $R1
    ${If} $R0 == ${BST_CHECKED}
      StrCpy $R2 1
    ${Else}
      StrCpy $R2 0
      ${If} $R1 == ${BST_CHECKED}
        StrCpy $R3 ${BST_CHECKED}
      ${Else}
        StrCpy $R3 ${BST_UNCHECKED}
      ${EndIf}
      SendMessage $WtCaseReglages ${BM_SETCHECK} $R3 0
      SendMessage $WtCaseHistorique ${BM_SETCHECK} $R3 0
      SendMessage $WtCaseJournaux ${BM_SETCHECK} $R3 0
      SendMessage $WtCaseCatalogue ${BM_SETCHECK} $R3 0
      SendMessage $WtCaseApprobations ${BM_SETCHECK} $R3 0
      SendMessage $WtCaseGarde ${BM_SETCHECK} $R3 0
      SendMessage $WtCaseInterface ${BM_SETCHECK} $R3 0
      SendMessage $WtCaseScripts ${BM_SETCHECK} ${BST_UNCHECKED} 0
    ${EndIf}
    EnableWindow $WtCaseReglages $R2
    EnableWindow $WtCaseHistorique $R2
    EnableWindow $WtCaseJournaux $R2
    EnableWindow $WtCaseCatalogue $R2
    EnableWindow $WtCaseApprobations $R2
    EnableWindow $WtCaseGarde $R2
    EnableWindow $WtCaseInterface $R2
    EnableWindow $WtCaseScripts $R2
  FunctionEnd

  Function un.WtPageQuitter
    ${NSD_GetState} $WtCaseReglages $WtReglages
    ${NSD_GetState} $WtCaseHistorique $WtHistorique
    ${NSD_GetState} $WtCaseJournaux $WtJournaux
    ${NSD_GetState} $WtCaseCatalogue $WtCatalogue
    ${NSD_GetState} $WtCaseApprobations $WtApprobations
    ${NSD_GetState} $WtCaseGarde $WtGarde
    ${NSD_GetState} $WtCaseInterface $WtInterface
    ${NSD_GetState} $WtCaseScripts $WtScripts
    ${If} $WtScripts == 1
      !insertmacro WT_TEXTE $R0 "Vos scripts personnels seront effacés définitivement, y compris ceux que vous avez écrits vous-même.$\n$\nContinuer ?" "Your personal scripts will be permanently deleted, including the ones you wrote yourself.$\n$\nContinue?"
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "$R0" IDYES wt_scripts_confirmes
      Abort
      wt_scripts_confirmes:
    ${EndIf}
    ; Les données de l'interface : c'est la section de Tauri qui les efface,
    ; par l'effacement sûr que le modèle dérivé y substitue.
    StrCpy $DeleteAppDataCheckboxState $WtInterface
  FunctionEnd
!macroend

; --- Après la désinstallation des fichiers ---------------------------------

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; Le registre 64 bits, celui qu'écrit WinTool.
    SetRegView 64
    ${If} $WtApprobations == 1
      DeleteRegKey HKLM "SOFTWARE\WinTool\Approbations"
    ${EndIf}
    ${If} $WtGarde == 1
      DeleteRegKey HKLM "SOFTWARE\WinTool\Garde"
    ${EndIf}
    DeleteRegKey /ifempty HKLM "SOFTWARE\WinTool"

    SetShellVarContext current
    !insertmacro WINTOOL_EFFACER_DONNEES "$LOCALAPPDATA\WinTool"

    ; Ancien magasin d'approbations (1.0 à 1.1.1) : un fichier nommé, puis le
    ; dossier s'il est vide.
    ${If} $WtApprobations == 1
      SetShellVarContext all
      Delete "$APPDATA\WinTool\approved.json"
      RMDir "$APPDATA\WinTool"
    ${EndIf}
  ${EndIf}
!macroend
