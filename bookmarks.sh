#!/usr/bin/bash
# Стартира Bookmark Manager чрез компилирания webview-launcher (тук: ./bookmarks).
# Скриптът е преносим - всички пътища са относителни спрямо папката, в която се намира.

home="$(dirname "$(readlink -f "$0")")"
cd "$home" || exit 1

# WebKit пази localStorage/IndexedDB/бисквитки тук - вътре в проекта, не в $HOME,
# затова цялата папка може да се копира/премества без загуба на данните на отметките.
export WEBKIT_USER_DATA_DIR="$home/profiles/user"
export WEBKIT_CACHE_DIR="$home/profiles/user/cache"
mkdir -p "$home/profiles/user/cache"

ARGS=(
    --base-dir "$home"
    --url "index.html"
    --title "Bookmark Manager"
    --profile "user"
    --profile-dir "$home/profiles"
    --width 1150
    --height 720
)
DARK_ARG=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dark)
            DARK_ARG=(--dark)
            shift
            ;;
        --no-dark)
            DARK_ARG=()
            shift
            ;;
        --devtools)
            ARGS+=(--devtools)
            shift
            ;;
        --private)
            ARGS+=(--private)
            shift
            ;;
        *)
            echo "Непознат параметър: $1" >&2
            exit 2
            ;;
    esac
done

exec ./bookmarks "${ARGS[@]}" "${DARK_ARG[@]}"
