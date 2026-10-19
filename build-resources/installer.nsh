; Assisted-installer extras for EditPro.
; electron-builder already creates the desktop shortcut, the Start Menu
; application shortcut, and the Apps & Features uninstall entry.
; This include adds a Start Menu uninstall shortcut beside the app shortcut.

!macro customInstall
  CreateShortCut "$SMPROGRAMS\${MENU_FILENAME}\Uninstall ${PRODUCT_NAME}.lnk" "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe" "" "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\${MENU_FILENAME}\Uninstall ${PRODUCT_NAME}.lnk"
!macroend
