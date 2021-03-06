#!/usr/bin/env sh
set -e

git clone git@github.com:ducklang-community/ducklang.git
cd ducklang

npm install
npm run build
npm run deploy

printf '\n%s\n\n' 'export PATH="$HOME/.ducklang/alpha/compiler:$PATH"' >>~/.bashrc

# Run:
#
#     source ~/.bashrc
#
# to include 'dklg' to your path
#
printf '\n%s!\n%s:\n\n    %s\n\n%s.\n\n' 'Ducklang is ready' 'Run' 'source ~/.bashrc' "to include 'dklg' to your path"
