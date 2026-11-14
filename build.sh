#!/bin/sh
set -eu

mkdir -p dist
cp server.js package.json dist/
cp -R lib dist/lib
cp -R public dist/public
cp run.sh dist/run.sh
chmod 755 dist/run.sh
