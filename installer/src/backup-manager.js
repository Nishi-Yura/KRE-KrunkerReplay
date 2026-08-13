/**
 * backup-manager.js
 * asar改変前のバックアップ取得・リストアを管理する
 */

const fs = require('fs');
const path = require('path');

class BackupManager {
    /**
     * @param {string} resourcesPath resourcesディレクトリのパス
     */
    constructor(resourcesPath) {
        this.resourcesPath = resourcesPath;
        this.backupDir = path.join(resourcesPath, 'backup');
        
        // バックアップディレクトリが存在しない場合は作成
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    /**
     * 日時文字列を生成する (YYYYMMDD_HHMMSS)
     * @returns {string}
     */
    _getTimestamp() {
        const now = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        const YYYY = now.getFullYear();
        const MM = pad(now.getMonth() + 1);
        const DD = pad(now.getDate());
        const HH = pad(now.getHours());
        const MIN = pad(now.getMinutes());
        const SS = pad(now.getSeconds());
        return `${YYYY}${MM}${DD}_${HH}${MIN}${SS}`;
    }

    /**
     * app.asarのバックアップを取得する
     * @param {string} asarPath app.asarのパス
     * @returns {string} バックアップファイルのパス
     */
    backup(asarPath) {
        if (!fs.existsSync(asarPath)) {
            throw new Error(`バックアップ対象が見つかりません: ${asarPath}`);
        }
        
        const timestamp = this._getTimestamp();
        const backupFileName = `app.asar.bak_${timestamp}`;
        const backupFilePath = path.join(this.backupDir, backupFileName);
        
        fs.copyFileSync(asarPath, backupFilePath);
        console.log(`[KRE Installer] バックアップを作成しました: ${backupFilePath}`);
        
        return backupFilePath;
    }

    /**
     * バックアップ一覧を取得する（日付の降順）
     * @returns {string[]} バックアップファイルのパス配列
     */
    listBackups() {
        if (!fs.existsSync(this.backupDir)) return [];
        
        const files = fs.readdirSync(this.backupDir);
        const backupFiles = files
            .filter(f => f.startsWith('app.asar.bak_'))
            .map(f => path.join(this.backupDir, f));
            
        // 降順にソート（新しい順）
        return backupFiles.sort((a, b) => b.localeCompare(a));
    }

    /**
     * バックアップが存在するか確認する
     * @returns {boolean}
     */
    hasBackup() {
        return this.listBackups().length > 0;
    }

    /**
     * 最新のバックアップからリストアする
     * @param {string} asarPath リストア先のapp.asarのパス
     * @returns {boolean} リストア成功か否か
     */
    restore(asarPath) {
        const backups = this.listBackups();
        if (backups.length === 0) {
            console.error('[KRE Installer] リストア用のバックアップが見つかりません。');
            return false;
        }
        
        const latestBackup = backups[0];
        try {
            fs.copyFileSync(latestBackup, asarPath);
            console.log(`[KRE Installer] バックアップからリストアしました: ${latestBackup}`);
            return true;
        } catch (error) {
            console.error(`[KRE Installer] リストアに失敗しました: ${error.message}`);
            return false;
        }
    }

    /**
     * 古いバックアップを削除して指定した個数だけ保持する
     * @param {number} keep 保持する最大数
     */
    pruneOldBackups(keep = 3) {
        const backups = this.listBackups();
        if (backups.length <= keep) return;
        
        const toDelete = backups.slice(keep);
        for (const file of toDelete) {
            try {
                fs.unlinkSync(file);
                console.log(`[KRE Installer] 古いバックアップを削除しました: ${file}`);
            } catch (error) {
                console.warn(`[KRE Installer] 古いバックアップの削除に失敗しました: ${file}`);
            }
        }
    }
}

module.exports = BackupManager;
