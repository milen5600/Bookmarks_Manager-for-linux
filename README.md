# Bookmark Manager

A lightweight, portable graphical bookmark manager for Linux, inspired by the **Bookmark Library / Bookmark Manager** window of Mozilla Firefox.

The basic idea is simple: manage bookmarks in a standalone application without having to launch the entire browser first.

> **Status:** portable Linux desktop application  
> **UI:** HTML/CSS/JavaScript  
> **Desktop shell:** GTK3 + WebKit2GTK  
> **Platform:** Linux x86_64

---

## Why this project exists

Firefox provides a very capable bookmark management interface, but its Bookmark Library is not a separate standalone application. In order to edit bookmarks, you normally have to start Firefox first.

For a simple task such as moving, renaming, deleting, or adding a bookmark, that means starting the entire browser and its components.

**Bookmark Manager** was created to separate this particular functionality into a small standalone utility.

The result is a compact portable Bookmark Manager that can be used independently from the browser.

---

## Features

- Tree-based folder structure.
- Nested folders.
- Create, rename, and delete folders.
- Create, edit, and delete bookmarks.
- Drag & Drop for bookmarks.
- Drag & Drop for folders.
- Folder reordering.
- Moving items between folders.
- Dropping an item onto a folder to move it inside.
- Bookmark search.
- Light and dark themes.
- Import from `bookmarks.html`, including Netscape bookmark format.
- JSON import.
- Export of the selected folder.
- Export of the complete bookmark structure.
- Link checking using HTTP requests.
- Local data storage.
- Saved UI state.
- Local WebKit profile.
- No installer required for the application itself.

---

## Portable design

The application is designed to be portable.

After extraction, the structure is approximately:

```text
Bookmark_Manager/
├── bookmarks
├── bookmarks.sh
├── index.html
├── icon.png
├── css/
│   └── style.css
├── js/
│   └── bookmarks.js
└── profiles/
    └── window_state.cfg
```

`bookmarks.sh` launches the application using paths relative to the application directory.

It sets:

```text
WEBKIT_USER_DATA_DIR
WEBKIT_CACHE_DIR
```

so the WebKit profile and cache are stored inside the application directory.

This makes the application directory easy to copy or move.

### Important portable-mode clarification

Portable means that **the application files and its local data can be carried together**. It does not mean that Linux system libraries are bundled with the application.

The executable is dynamically linked against native libraries provided by the operating system. The target system therefore needs compatible GTK/WebKit runtime libraries.

---

## How the application works

### 1. HTML/CSS/JavaScript interface

The interface consists of:

- `index.html`
- `css/style.css`
- `js/bookmarks.js`

It is essentially a web application running inside a desktop WebView.

Bookmark data is stored using:

```javascript
localStorage
```

The WebView provides the browser-like environment required to run the interface as a desktop application.

### 2. Native WebView launcher

The file:

```text
bookmarks
```

is a native Linux executable which creates the application window and loads the HTML interface inside a WebKit WebView.

The native layer uses:

- GTK3
- WebKit2GTK 4.0
- JavaScriptCore GTK 4.0
- libsoup 2.4
- GLib and other standard GTK/WebKit dependencies

This provides a normal Linux desktop window while keeping the application UI implemented with HTML/CSS/JavaScript.

---

## WebView and Linux compatibility

This is the most important part when distributing the prebuilt binary.

The application **does not bundle Chromium or Firefox as its rendering engine**.

It uses the system's **WebKit2GTK**.

Therefore WebKit2GTK is a required runtime dependency.

If it is missing, the executable will fail to start. For example:

```text
error while loading shared libraries:
libwebkit2gtk-4.0.so.37:
cannot open shared object file
```

The same principle applies to the other native dependencies.

### Debian 12

For a release, it is important to document the actual build environment used for that binary.

**GLIBC compatibility is especially important.** GLIBC is part of the operating system and should not be treated as a portable application library.

Check it with:

```bash
ldd ./bookmarks
```

and:

```bash
readelf --version-info ./bookmarks | grep GLIBC
```

The supplied binary currently contains a dependency on:

```text
GLIBC_2.38
```

Therefore this particular binary should **not** be advertised as a universally compatible Debian 12 binary without further verification.

If Debian 12 support is a goal, the safest approach is to build the release binary directly on Debian 12 or against an appropriately old compatibility baseline.

---

## Native runtime dependencies

The current executable dynamically links against libraries including:

```text
libwebkit2gtk-4.0.so.37
libjavascriptcoregtk-4.0.so.18
libgtk-3.so.0
libsoup-2.4.so.1
libglib-2.0.so.0
libgio-2.0.so.0
libgobject-2.0.so.0
```

as well as the normal libraries used by the GTK/WebKit graphical stack.

Package names vary between Linux distributions.

The most reliable way to check a particular system is:

```bash
ldd ./bookmarks
```

If you see:

```text
=> not found
```

the corresponding runtime library is missing.

---

## Running the application

Make the launcher executable:

```bash
chmod +x bookmarks.sh
```

Then run:

```bash
./bookmarks.sh
```

The executable can also be launched directly:

```bash
./bookmarks
```

Using `bookmarks.sh` is recommended because it sets up the portable WebKit profile and cache directories.

---

## Command-line options

The launcher supports:

```text
--dark
--no-dark
--devtools
--private
```

Examples:

```bash
./bookmarks.sh --dark
```

```bash
./bookmarks.sh --devtools
```

`--devtools` is primarily intended for development and troubleshooting.

---

## Where are the bookmarks stored?

The application uses WebKit browser storage.

In portable mode the launcher sets:

```text
WEBKIT_USER_DATA_DIR=<application>/profiles/user
WEBKIT_CACHE_DIR=<application>/profiles/user/cache
```

This keeps the application's browser storage next to the application itself.

That is an important part of the portable design.

For safety, use the built-in Export functionality before major changes or migrations.

---

## Backups

The simplest backup is to copy the entire application directory.

The application also provides:

- Export of the current folder.
- Export of all folders.

This provides a bookmark backup independent of the WebKit profile storage.

---

## Who is this for?

Bookmark Manager is useful for people who:

- want a small standalone bookmark manager;
- do not want to launch a full browser just to edit bookmarks;
- prefer portable applications;
- use Linux;
- want their bookmark collection to be accessible independently from the browser;
- prefer a classic tree/list management interface.

---

## What this project is not

This is not a web browser.

It is not intended to replace Firefox, Chromium, or another browser.

It is not Firefox Sync.

It is not a cloud bookmark service.

It is a local GUI utility for managing a bookmark collection.

---

## Known limitations

### Linux runtime dependencies

The executable is dynamically linked against system libraries.

Therefore:

> **Portable ≠ completely independent of the Linux system.**

The application directory can be moved, but GTK/WebKit/GLIBC compatibility on the target system still needs to be considered.

### Different WebKit versions

Different Linux distributions may ship different WebKit2GTK generations and ABIs.

If the required ABI is unavailable, the prebuilt binary may not start.

### Wayland / X11

GTK and WebKit use the system's graphical backend.

Modern Linux systems may use Wayland, X11, or a combination of both.

Actual compatibility depends on GTK3, WebKit2GTK, and the installed graphics/backend libraries.

---

## Troubleshooting

If the application does not start:

```bash
ldd ./bookmarks
```

Look for:

```text
not found
```

Check GLIBC:

```bash
readelf --version-info ./bookmarks | grep GLIBC
```

Check WebKit:

```bash
ldconfig -p | grep webkit2gtk
```

Check GTK:

```bash
ldconfig -p | grep libgtk-3
```

---

## Architecture

The project is intentionally small.

It does not require a large application framework or a separate heavy browser runtime.

The architecture is essentially:

```text
HTML + CSS + JavaScript
          ↓
     WebKit2GTK
          ↓
        GTK3
          ↓
      Linux desktop
```

This keeps the application relatively simple and easy to maintain.

---

## Possible future improvements

- AppImage distribution.
- Flatpak distribution.
- DEB package.
- Packages for additional Linux distributions.
- More automatic WebKit dependency detection.
- Additional browser import/export formats.
- More keyboard shortcuts.
- More advanced link checking.
- Automatic backups.
- Additional interface preferences.

---

## Screenshots

> Add screenshots here.
![](https://raw.githubusercontent.com/milen5600/Bookmarks_Manager-for-linux/refs/heads/main/Bookmark%20Manager_001.png)
![](https://raw.githubusercontent.com/milen5600/Bookmarks_Manager-for-linux/refs/heads/main/Bookmark%20Manager_002.png)
![](https://raw.githubusercontent.com/milen5600/Bookmarks_Manager-for-linux/refs/heads/main/Bookmark%20Manager_003.png)


---

## Acknowledgements

The project started from a simple idea: managing bookmarks should not require launching the entire browser.

If you find it useful, feel free to use and share it according to the terms of the chosen license.
