const fs = require('fs');
const path = require('path');
const semver = require('semver');
const selectorsMap = require('../config/selector_map.json');

/**
 * clientPathからpackage.jsonを読み込みバージョン文字列を返す
 * @param {string} clientPath クライアントのパス
 * @returns {string|null} バージョン文字列、またはエラー時はnull
 */
function checkVersion(clientPath) {
  try {
    const pkgPath = path.join(clientPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || null;
  } catch (error) {
    console.error('バージョン確認中にエラーが発生しました:', error);
    return null;
  }
}

/**
 * バージョンに対応するセレクタを返す（semverで照合）
 * @param {string} version バージョン文字列
 * @returns {Object|false} セレクタオブジェクト、見つからない場合はfalse
 */
function getSelectors(version) {
  if (!version) return false;
  
  for (const [range, selectors] of Object.entries(selectorsMap.versions)) {
    if (semver.satisfies(version, range)) {
      return selectors;
    }
  }
  
  // マッチしない場合はフォールバックを返す
  console.warn(`未対応のバージョンです: ${version}。フォールバックセレクタを使用します。`);
  return selectorsMap.fallback;
}

module.exports = { checkVersion, getSelectors };
