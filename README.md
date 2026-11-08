# Page Fiddle

https://tats-u.github.io/page-fiddle/

Page Fiddle is a lightweight Astro + SolidJS playground for writing markup and CSS with a fast, sandboxed preview.

## Features

- HTML, Markdown, and Pug markup modes
- CodeMirror editors for markup and CSS
- Title-bar controls with a settings dialog and split-pane workspace
- Secure iframe preview with:
  - iframe sandboxing
  - `script-src 'none'` CSP
  - unsafe head tags and URLs stripped before rendering
- Share URLs generated on demand with `#` + `lz-string`
- Light-mode and dark-mode UI
- Preview options for:
  - external CSS
  - page language (`lang`)
  - light-only or light-and-dark color-scheme metadata
  - additional head tags
  - additional `<html>` attributes

## Security notes

- The preview runs inside a sandboxed `iframe`.
- Unlike similar competing apps, no preview JavaScript is executed. `<script>` tags are removed and the preview CSP sets `script-src 'none'`.
- External CSS URLs must be absolute `https:` URLs.
- Additional head tags are limited to safe, non-executable tags.

## Sharing

Share URLs are created only when the **Create share URL** button is pressed. The current document state is serialized, compressed with `lz-string`, and written into the location hash.

## vs other popular online editors

CodePen and JSFiddle are well-known existing web apps that allow you to preview written HTML and CSS.
However, these services send your changes to the server every time, causing a slight delay in updating the preview. They also show ads, and most importantly, you cannot create permanent links for your content without registering, meaning you have to leave your shared content on their servers.


In contrast, this app does not retain any data on the server side. Permanent links are free, available without registration, and valid forever. Shared content is not even sent to GitHub and is processed and rendered entirely within your browser. Additionally, changes are reflected in the preview instantly. There are no plans to display ads or collect telemetry in this app, so you can use it with peace of mind. Furthermore, the deployed content is completely synced with the source code on GitHub, so you do not need to worry about maliciously embedded code. (If there were any, you would be able to find it in the source code.)

## Development

```sh
pnpm install
pnpm dev
```

## Build

```sh
pnpm build
pnpm astro check
```