/**
 * sideloader.js
 * asarの展開・改変・再パックを自動化する
 */

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');
const os = require('os');
const BackupManager = require('./backup-manager');
const { findKrunkerPath } = require('./krunker-finder');

class Sideloader {
    /**
     * Krunkerがインストールされているか確認し、対象をインストールする
     * @param {string} [krunkerPath] 手動で指定するKrunkerのパス（省略可）
     */
    async install(krunkerPath) {
        console.log('[KRE Installer] Krunkerパスの検索中...');
        const krunkerInfo = krunkerPath 
            ? { installDir: krunkerPath, asarPath: path.join(krunkerPath, 'resources', 'app.asar'), resourcesPath: path.join(krunkerPath, 'resources') }
            : findKrunkerPath();

        if (!krunkerInfo || !fs.existsSync(krunkerInfo.asarPath)) {
            console.error('[KRE Installer] エラー: Krunkerが見つかりませんでした。');
            process.exit(1);
        }

        console.log(`[KRE Installer] Krunkerが見つかりました: ${krunkerInfo.installDir}`);
        
        if (this.verifyInstall(krunkerInfo.installDir)) {
            console.log('[KRE Installer] 既にインストール済みです。');
            return;
        }

        const backupManager = new BackupManager(krunkerInfo.resourcesPath);
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kre-asar-'));

        try {
            // 1. バックアップ取得
            console.log('[KRE Installer] app.asar のバックアップを作成中...');
            backupManager.backup(krunkerInfo.asarPath);
            backupManager.pruneOldBackups(3);

            // 2. app.asarを展開
            console.log(`[KRE Installer] app.asar を一時ディレクトリに展開中... (${tempDir})`);
            asar.extractAll(krunkerInfo.asarPath, tempDir);

            // 3. main.js の改変
            console.log('[KRE Installer] main.js を書き換え中...');
            const mainJsPath = path.join(tempDir, 'src', 'main.js'); // main.jsがsrc/内にあるか直下にあるか推測。Krunkerは通常src内
            let targetMainJs = fs.existsSync(mainJsPath) ? mainJsPath : path.join(tempDir, 'main.js');
            
            if (!fs.existsSync(targetMainJs)) {
                throw new Error('main.jsが見つかりません。');
            }

            let mainContent = fs.readFileSync(targetMainJs, 'utf8');
            // ファイルの先頭にrequireを追記
            mainContent = `require('./recorder-preload');\n` + mainContent;
            fs.writeFileSync(targetMainJs, mainContent, 'utf8');

            // 4. recorder-preload.js をコピー
            console.log('[KRE Installer] preloadスクリプトをコピー中...');
            // ../../recorder/preload-injector.js のパスを特定
            const preloadInjectorPath = path.join(__dirname, '..', '..', 'recorder', 'preload-injector.js');
            const destPreloadPath = path.join(path.dirname(targetMainJs), 'recorder-preload.js');
            
            if (fs.existsSync(preloadInjectorPath)) {
                fs.copyFileSync(preloadInjectorPath, destPreloadPath);
            } else {
                console.warn('[KRE Installer] 警告: preload-injector.js が見つかりません。ダミーのファイルを作成します。');
                fs.writeFileSync(destPreloadPath, '// preload-injector.js not found at install time', 'utf8');
            }

            // 5. & 6. asarを再パックして置き換え
            console.log('[KRE Installer] app.asar を再パック中...');
            await asar.createPackage(tempDir, krunkerInfo.asarPath);
            console.log('[KRE Installer] インストールが正常に完了しました！');
            
        } catch (error) {
            console.error(`[KRE Installer] インストール中にエラーが発生しました: ${error.message}`);
            console.log('[KRE Installer] ロールバックを開始します...');
            backupManager.restore(krunkerInfo.asarPath);
            process.exit(1);
        } finally {
            // 一時ディレクトリの削除
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (e) {
                // ignore
            }
        }
    }

    /**
     * アンインストール（バックアップからリストア）
     * @param {string} [krunkerPath]
     */
    async uninstall(krunkerPath) {
        console.log('[KRE Installer] Krunkerパスの検索中...');
        const krunkerInfo = krunkerPath 
            ? { installDir: krunkerPath, asarPath: path.join(krunkerPath, 'resources', 'app.asar'), resourcesPath: path.join(krunkerPath, 'resources') }
            : findKrunkerPath();

        if (!krunkerInfo || !fs.existsSync(krunkerInfo.asarPath)) {
            console.error('[KRE Installer] エラー: Krunkerが見つかりませんでした。');
            process.exit(1);
        }

        const backupManager = new BackupManager(krunkerInfo.resourcesPath);
        if (!backupManager.hasBackup()) {
            console.error('[KRE Installer] バックアップが見つからないため、アンインストールできません。');
            process.exit(1);
        }

        console.log('[KRE Installer] バックアップをリストア中...');
        const success = backupManager.restore(krunkerInfo.asarPath);
        if (success) {
            console.log('[KRE Installer] アンインストールが完了しました。');
        } else {
            process.exit(1);
        }
    }

    /**
     * インストール済みかどうかチェック
     * @param {string} krunkerDir Krunkerのインストールディレクトリ
     * @returns {boolean}
     */
    verifyInstall(krunkerDir) {
        if (!krunkerDir) return false;
        
        try {
            const resourcesPath = path.join(krunkerDir, 'resources');
            const asarPath = path.join(resourcesPath, 'app.asar');
            
            // 簡易的にasarのサイズをチェックするか、asarを覗き見る
            // ここでは簡易チェックとしてバックアップが存在すればインストール済みとみなす
            const backupDir = path.join(resourcesPath, 'backup');
            if (fs.existsSync(backupDir)) {
                const files = fs.readdirSync(backupDir);
                if (files.some(f => f.startsWith('app.asar.bak_'))) {
                    return true;
                }
            }
            return false;
        } catch (e) {
            return false;
        }
    }
}

module.exports = Sideloader;

// CLI実行時
if (require.main === module) {
    const args = process.argv.slice(2);
    const cmd = args[0];
    const targetPath = args[1]; // 手動パス用

    const sideloader = new Sideloader();
    
    if (cmd === 'install' || !cmd) {
        sideloader.install(targetPath);
    } else if (cmd === 'uninstall') {
        sideloader.uninstall(targetPath);
    } else {
        console.error('Usage: node sideloader.js [install|uninstall] [path/to/krunker]');
    }
}
