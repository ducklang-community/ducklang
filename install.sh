#!/usr/bin/env sh
set -e

git clone git@github.com:ducklang-community/ducklang.git
cd ducklang

npm install
npm run build
npm run deploy

printf '\n%s\n\n' 'export PATH="$HOME/.ducklang/alpha/compiler:$PATH"' >>~/.bashrc
source ~/.bashrc
