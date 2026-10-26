#!/bin/sh
# 运行 core 层检查:用 Cocos 自带的 TypeScript 编译,再用 node 自带的测试运行器执行。
# 不需要 npm install。若 Cocos 装在别处,用环境变量 COCOS_TSC 指向 typescript/bin/tsc。
set -e
cd "$(dirname "$0")"
TSC="${COCOS_TSC:-/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

# 1. ES5 降级兼容检查:微信小游戏构建会把代码降级编译,对 Set/Map 做展开或 for-of 会在微信里出错
#    (浏览器预览不会暴露)。以 ES5 为目标编译 core,这类写法会直接报编译错误。
node "$TSC" -p tsconfig.es5.json

# 2. 单元测试
node "$TSC" -p tsconfig.json --outDir "$OUT"
node --test "$OUT"/tests/core/*.test.js
