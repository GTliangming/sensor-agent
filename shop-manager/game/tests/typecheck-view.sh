#!/bin/sh
# 对 view/ 和 platform/ 做完整类型检查(run.sh 只检查 core)。
# 需要 Cocos 的类型声明:用 Cocos Creator 打开本工程一次,它会生成 game/temp/tsconfig.cocos.json 和 game/temp/declarations。
set -e
cd "$(dirname "$0")/.."
if [ ! -f temp/tsconfig.cocos.json ]; then
    echo "缺少 temp/tsconfig.cocos.json:请先用 Cocos Creator 打开一次本工程(它会自动生成)。" >&2
    exit 1
fi
TSC="$(sh tests/find-tsc.sh)"
node "$TSC" -p tsconfig.json --noEmit
echo "view/platform 类型检查通过"
