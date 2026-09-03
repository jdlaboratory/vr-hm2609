#!/usr/bin/env bash
# ===================================================================
#  360 Virtual Tour - macOS / Linux launcher
#
#  Double-click this file in Finder. It starts a small local web
#  server and opens the tour in your browser. Press Ctrl+C in the
#  Terminal window to stop it.
#
#  FIRST TIME ONLY: macOS will not run a file it does not consider
#  executable. Open Terminal in this folder once and run:
#
#      chmod +x start-macos.command
#
#  Pass --edit to open the hotspot editor instead:
#      ./start-macos.command --edit
# ===================================================================

set -u
cd "$(dirname "$0")" || exit 1

printf '\n  Starting the 360 Virtual Tour...\n\n'

# On a Mac without the Xcode Command Line Tools, /usr/bin/python3 is a stub
# that pops up an installer prompt instead of running. Detect that and move on
# to Node rather than interrupting the user with a dialog.
python3_is_real() {
    command -v python3 >/dev/null 2>&1 || return 1
    if [ "$(command -v python3)" = "/usr/bin/python3" ] && [ "$(uname)" = "Darwin" ]; then
        xcode-select -p >/dev/null 2>&1 || return 1
    fi
    python3 -c 'pass' >/dev/null 2>&1
}

if python3_is_real; then
    python3 "tools/serve.py" "$@"
elif command -v node >/dev/null 2>&1 && node -e '0' >/dev/null 2>&1; then
    node "tools/serve.js" "$@"
elif command -v python >/dev/null 2>&1 && python -c 'import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)' >/dev/null 2>&1; then
    python "tools/serve.py" "$@"
else
    cat <<'MESSAGE'
  Neither Python 3 nor Node.js was found on this computer.

  Install either one (both are free) and run this file again:

      Python    https://www.python.org/downloads/
      Node.js   https://nodejs.org/

  On a Mac you can also get Python by installing Apple's command line
  tools, which are free and already on your system:

      xcode-select --install

  Nothing else needs to be installed - the tour itself has no
  dependencies. The server is only needed because browsers block local
  pages from reading config/tour.json directly.

MESSAGE
    read -r -p "  Press Return to close this window. " _
    exit 1
fi

printf '\n  The server has stopped.\n\n'
