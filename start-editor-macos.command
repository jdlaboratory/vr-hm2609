#!/usr/bin/env bash
# ===================================================================
#  360 Virtual Tour - editor launcher (macOS / Linux)
#
#  Double-click this file to open the tour in the editor set up for
#  working on it:
#
#    --autosave  every change you make is written to config/tour.json
#                by itself; no Save button to remember
#    --live      editing index.html, css/ or js/ updates the open page
#                without a manual reload
#
#  config/tour.json.bak keeps the tour as it was when you started, so
#  there is always a way back.
#
#  This is start-macos.command with those flags, and nothing else. Use
#  the plain start-macos.command when showing the tour to anyone: that
#  one serves the site read-only and cannot be made to overwrite it.
#
#  FIRST TIME ONLY: macOS will not run a file it does not consider
#  executable. Open Terminal in this folder once and run:
#
#      chmod +x start-editor-macos.command
#
#  Extra flags still work, e.g.
#      ./start-editor-macos.command --port 9000
# ===================================================================

set -u
cd "$(dirname "$0")" || exit 1

if [ ! -f "start-macos.command" ]; then
    printf '\n  start-macos.command was not found next to this file.\n'
    printf '  Both launchers have to sit in the project folder together.\n\n'
    read -r -p "  Press Return to close this window. " _
    exit 1
fi

cat <<'BANNER'

  ================================================================
   EDITOR MODE - autosave and live reload are ON

   Every edit is written straight to config/tour.json.
   Changes to index.html, css/ or js/ update the page as you save.
   config/tour.json.bak holds the tour as it was when you started.
  ================================================================
BANNER

# Run it through bash rather than executing it directly, so this file is
# the only one that ever needs chmod +x.
bash "start-macos.command" --autosave --live "$@"
