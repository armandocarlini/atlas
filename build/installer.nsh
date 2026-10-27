; Entrada "Abrir no ATLAS" no Explorador (marco 6b). Mesmas chaves, rótulo e
; comando da integração em electron/explorer-integration.cjs; o teste
; scripts/installer-config.test.mjs mantém os dois em sincronia.
; Instalar só grava com o consentimento do usuário (instalação silenciosa: não).
; Atualizar preserva a escolha. Desinstalar remove a entrada que aponta para
; esta instalação e preserva uma que aponte para outro ATLAS.

!define ATLAS_OPEN_LABEL "Abrir no ATLAS"
!define ATLAS_OPEN_KEY "Software\Classes\Directory\shell\ATLAS.Open"
!define ATLAS_OPEN_BACKGROUND_KEY "Software\Classes\Directory\Background\shell\ATLAS.Open"
!define ATLAS_OPEN_COMMAND '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--atlas-open=%V"'

!macro atlasWriteOpenKey KEY
  WriteRegStr HKCU "${KEY}" "" "${ATLAS_OPEN_LABEL}"
  WriteRegStr HKCU "${KEY}" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "${KEY}\command" "" '${ATLAS_OPEN_COMMAND}'
!macroend

!macro atlasRemoveOpenKey KEY
  ReadRegStr $0 HKCU "${KEY}\command" ""
  StrCmp $0 '${ATLAS_OPEN_COMMAND}' 0 +2
    DeleteRegKey HKCU "${KEY}"
!macroend

!macro customInstall
  ${if} ${isUpdated}
    ; Atualização: reescreve a entrada só se o usuário já a tinha aceitado.
    ReadRegStr $0 HKCU "${ATLAS_OPEN_KEY}\command" ""
    StrCmp $0 "" atlasOpenDone
    !insertmacro atlasWriteOpenKey "${ATLAS_OPEN_KEY}"
    !insertmacro atlasWriteOpenKey "${ATLAS_OPEN_BACKGROUND_KEY}"
    Goto atlasOpenDone
  ${endIf}
  MessageBox MB_YESNO|MB_ICONQUESTION "Adicionar $\"${ATLAS_OPEN_LABEL}$\" ao menu de contexto das pastas no Explorador?$\r$\n$\r$\nVocê pode adicionar ou remover depois em Aparência e configurações." /SD IDNO IDNO atlasOpenDone
  !insertmacro atlasWriteOpenKey "${ATLAS_OPEN_KEY}"
  !insertmacro atlasWriteOpenKey "${ATLAS_OPEN_BACKGROUND_KEY}"
  atlasOpenDone:
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro atlasRemoveOpenKey "${ATLAS_OPEN_KEY}"
    !insertmacro atlasRemoveOpenKey "${ATLAS_OPEN_BACKGROUND_KEY}"
  ${endIf}
!macroend
