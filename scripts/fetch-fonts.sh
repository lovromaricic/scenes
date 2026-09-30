#!/usr/bin/env bash
# Downloads the built-in video fonts (all SIL Open Font License) from their Fontsource npm
# packages and copies the Latin woff2 files and licences into static/fonts. Run once; the files
# are committed so the app never loads fonts from the internet.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
out=static/fonts
mkdir -p "$out"

# id  package  faces (weight-style …)
fonts=(
	"geist geist 400-normal 600-normal 700-normal"
	"instrument-serif instrument-serif 400-normal 400-italic"
	"oswald oswald 500-normal 700-normal"
	"nunito nunito 400-normal 700-normal 800-normal 400-italic 700-italic"
	"lora lora 400-normal 700-normal 400-italic 700-italic"
	"jetbrains-mono jetbrains-mono 400-normal 700-normal 400-italic"
	"caveat caveat 400-normal 700-normal"
	"anton anton 400-normal"
	"playfair-display playfair-display 400-normal 700-normal 400-italic 700-italic"
	"space-grotesk space-grotesk 400-normal 700-normal"
)

for entry in "${fonts[@]}"; do
	read -r id pkg faces <<<"$entry"
	(cd "$tmp" && npm pack "@fontsource/$pkg@5" --silent >/dev/null && tar -xzf fontsource-$pkg-*.tgz && mv package "$pkg")
	mkdir -p "$out/$id"
	for face in $faces; do
		cp "$tmp/$pkg/files/$pkg-latin-$face.woff2" "$out/$id/$face.woff2"
	done
	cp "$tmp/$pkg/LICENSE" "$out/$id/LICENSE.txt"
done
rm -rf "$tmp"
du -sh "$out"
