#!/bin/bash

set -e

REGISTRY="https://registry.npmjs.com"

# 升级版本
echo "当前版本: $(node -p "require('./package.json').version")"
read -p "升级类型 (patch/minor/major) [patch]: " VERSION_TYPE
VERSION_TYPE=${VERSION_TYPE:-patch}

npm version $VERSION_TYPE --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "新版本: $NEW_VERSION"

# 编译
echo ""
echo "编译中..."
rm -rf dist
npm run build

# 发布
echo ""
echo "发布到 npm..."
npm publish --registry $REGISTRY

# 提交版本号变更
git add package.json package-lock.json
git commit -m "chore: release v${NEW_VERSION}"
git tag "v${NEW_VERSION}"

echo ""
echo "✅ ahs-zentao@${NEW_VERSION} 发布成功"
