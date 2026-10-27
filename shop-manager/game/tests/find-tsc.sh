#!/bin/sh
# 找一个可用的 TypeScript 编译器(typescript/bin/tsc),把路径打印到标准输出。找不到返回非 0。
# 查找顺序:环境变量 COCOS_TSC -> macOS 上的 Cocos Creator 安装 -> PATH 里的 tsc -> nvm 全局安装的 typescript。
if [ -n "$COCOS_TSC" ] && [ -f "$COCOS_TSC" ]; then
    echo "$COCOS_TSC"
    exit 0
fi
for p in /Applications/Cocos/Creator/*/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc \
         /Applications/CocosCreator*/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc; do
    if [ -f "$p" ]; then
        echo "$p"
        exit 0
    fi
done
if command -v tsc >/dev/null 2>&1; then
    # PATH 里的 tsc 通常是个符号链接,解析到真正的 typescript/bin/tsc
    real="$(command -v tsc)"
    if [ -L "$real" ]; then
        dir="$(cd "$(dirname "$real")" && cd "$(dirname "$(readlink "$real")")" && pwd)"
        real="$dir/$(basename "$(readlink "$real")")"
    fi
    echo "$real"
    exit 0
fi
for p in "$HOME"/.nvm/versions/node/*/lib/node_modules/typescript/bin/tsc; do
    if [ -f "$p" ]; then
        echo "$p"
        exit 0
    fi
done
echo "找不到 TypeScript 编译器。请安装 Cocos Creator,或设置环境变量 COCOS_TSC 指向 typescript/bin/tsc。" >&2
exit 1
