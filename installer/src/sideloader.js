/**
 * sideloader.js
 * Electron クライアント (Krunker 公式 / Glorp 等) の app.asar (または resources/app) に
 * 録画モジュールを組み込む / 取り除く。
 *
 * 組み込む内容 (すべてアプリの main ファイルと同じディレクトリに置く):
 *   kre-main-hook.js  メインプロセス用フック。main ファイルの先頭から require される
 *   kre-preload.js    レンダラ用 preload (フックが全セッションに登録する)
 *   kre-userscript.js 録画スクリプト本体 (recorder/kre-userscript.user.js のコピー)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const asar = require('@electron/asar');
const BackupManager = require('./backup-manager');
const { findKrunkerPath, describeInstall } = require('./krunker-finder');
const { readFuses } = require('./inspect-client');

const MARKER = '/* KRE-RECORDER */';
const HOOK_FILES = [
    ['recorder/src/kre-main-hook.js', 'kre-main-hook.js'],
    ['recorder/preload/kre-preload.js', 'kre-preload.js'],
    ['recorder/kre-userscript.user.js', 'kre-userscript.js']
];
const REPO_ROOT = path.join(__dirname, '..', '..');

function resolveInstall(krunkerPath) {
    const info = krunkerPath ? describeInstall(krunkerPath) : findKrunkerPath();
    if (!info) {
        console.error('[KRE Installer] エラー: クライアントが見つかりませんでした。インストール先を引数で指定してください。');
        console.error('  例: node installer/src/sideloader.js install "C:\\Users\\<you>\\AppData\\Local\\glorp"');
        process.exit(1);
    }
    return info;
}

/** 展開済みアプリのディレクトリに main フックを書き込む */
function patchAppDir(appRoot) {
    const pkgPath = path.join(appRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) throw new Error('package.json が見つかりません。');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.type === 'module') {
        throw new Error('このクライアントの main は ES Module のため、現在の方式では組み込めません。(inspect-client.js のレポートを共有してください)');
    }

    const mainRel = pkg.main || 'index.js';
    const mainPath = path.join(appRoot, mainRel);
    if (!fs.existsSync(mainPath)) throw new Error(`main ファイルが見つかりません: ${mainRel}`);
    const mainDir = path.dirname(mainPath);

    for (const [src, dest] of HOOK_FILES) {
        const from = path.join(REPO_ROOT, src);
        if (!fs.existsSync(from)) throw new Error(`組み込み用ファイルが見つかりません: ${src}`);
        fs.copyFileSync(from, path.join(mainDir, dest));
    }

    let content = fs.readFileSync(mainPath, 'utf8');
    if (!content.includes(MARKER)) {
        const hook = `${MARKER} try { require('./kre-main-hook'); } catch (e) { console.error('[KRE Recorder]', e); }\n`;
        // shebang と 'use strict' ディレクティブより後ろに差し込む
        // (ディレクティブより前に文を置くと strict mode が無効になり、クライアントの挙動が変わるため)
        let head = content.startsWith('#!') ? content.slice(0, content.indexOf('\n') + 1) : '';
        const directive = /^(\s*(['"])use strict\2;?[ \t]*\r?\n)/.exec(content.slice(head.length));
        if (directive) head += directive[1];
        content = head + hook + content.slice(head.length);
        fs.writeFileSync(mainPath, content, 'utf8');
    }
    return mainRel;
}

/** asar 内でアンパックされていたファイルの拡張子一覧 (再パック時に同じものをアンパックするため) */
function unpackedExtensions(asarPath) {
    const exts = new Set();
    try {
        const header = asar.getRawHeader(asarPath).header;
        (function walk(node, name) {
            if (node.files) Object.entries(node.files).forEach(([k, v]) => walk(v, k));
            else if (node.unpacked) exts.add(path.extname(name).replace('.', '') || name);
        })(header, '');
    } catch (e) { /* 古い版の @electron/asar では取得できない */ }
    return [...exts];
}

class Sideloader {
    isInstalled(info) {
        try {
            if (info.kind === 'asar') {
                return asar.listPackage(info.asarPath).some(f => f.replace(/\\/g, '/').endsWith('/kre-main-hook.js'));
            }
            return fs.readdirSync(info.appDir).some(f => f === 'kre-main-hook.js') ||
                (fs.existsSync(path.join(info.appDir, 'package.json')) && this._findHookInDir(info.appDir));
        } catch (e) {
            return false;
        }
    }

    _findHookInDir(appDir) {
        const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
        const mainDir = path.dirname(path.join(appDir, pkg.main || 'index.js'));
        return fs.existsSync(path.join(mainDir, 'kre-main-hook.js'));
    }

    /**
     * @param {string} [krunkerPath] 手動で指定するインストールディレクトリ
     */
    async install(krunkerPath) {
        console.log('[KRE Installer] クライアントを検索中...');
        const info = resolveInstall(krunkerPath);
        console.log(`[KRE Installer] 見つかりました: ${info.installDir} (${info.kind})`);

        const fuses = readFuses(info.exePath);
        if (fuses.found && fuses.fuses.EnableEmbeddedAsarIntegrityValidation === 'enabled') {
            console.error('[KRE Installer] このクライアントは asar 整合性検証が有効なため、app.asar を書き換えると起動できなくなります。中止します。');
            process.exit(1);
        }

        if (this.isInstalled(info)) {
            console.log('[KRE Installer] 既にインストール済みです。(更新する場合は一度 uninstall してください)');
            return;
        }

        if (info.kind === 'dir') return this._installDir(info);

        const backupManager = new BackupManager(info.resourcesPath);
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kre-asar-'));
        let backedUp = false;

        try {
            console.log('[KRE Installer] app.asar のバックアップを作成中...');
            backupManager.backup(info.asarPath);
            backedUp = true;
            backupManager.pruneOldBackups(3);

            console.log(`[KRE Installer] app.asar を展開中... (${tempDir})`);
            const unpackExts = unpackedExtensions(info.asarPath);
            asar.extractAll(info.asarPath, tempDir);

            console.log('[KRE Installer] 録画モジュールを組み込み中...');
            const mainRel = patchAppDir(tempDir);
            console.log(`[KRE Installer] main: ${mainRel}`);

            console.log('[KRE Installer] app.asar を再パック中...');
            const options = unpackExts.length ? { unpack: `*.{${unpackExts.join(',')}}` } : {};
            await asar.createPackageWithOptions(tempDir, info.asarPath, options);

            console.log('[KRE Installer] インストールが完了しました。クライアントを再起動してください。');
            console.log('[KRE Installer] 録画ファイル: ドキュメント/KrunkerReplays/');
        } catch (error) {
            console.error(`[KRE Installer] インストール中にエラーが発生しました: ${error.message}`);
            if (backedUp) {
                console.log('[KRE Installer] ロールバックを開始します...');
                backupManager.restore(info.asarPath);
            }
            process.exit(1);
        } finally {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        }
    }

    // resources/app (asar 未使用) の場合は元の main ファイルを .kre-bak に退避して直接書き換える
    _installDir(info) {
        const pkg = JSON.parse(fs.readFileSync(path.join(info.appDir, 'package.json'), 'utf8'));
        const mainPath = path.join(info.appDir, pkg.main || 'index.js');
        try {
            fs.copyFileSync(mainPath, mainPath + '.kre-bak');
            patchAppDir(info.appDir);
            console.log('[KRE Installer] インストールが完了しました。クライアントを再起動してください。');
        } catch (e) {
            console.error(`[KRE Installer] エラー: ${e.message}`);
            if (fs.existsSync(mainPath + '.kre-bak')) fs.copyFileSync(mainPath + '.kre-bak', mainPath);
            process.exit(1);
        }
    }

    async uninstall(krunkerPath) {
        const info = resolveInstall(krunkerPath);

        if (info.kind === 'dir') {
            const pkg = JSON.parse(fs.readFileSync(path.join(info.appDir, 'package.json'), 'utf8'));
            const mainPath = path.join(info.appDir, pkg.main || 'index.js');
            if (!fs.existsSync(mainPath + '.kre-bak')) {
                console.error('[KRE Installer] バックアップが見つからないため、アンインストールできません。');
                process.exit(1);
            }
            fs.copyFileSync(mainPath + '.kre-bak', mainPath);
            fs.unlinkSync(mainPath + '.kre-bak');
            for (const [, dest] of HOOK_FILES) {
                try { fs.unlinkSync(path.join(path.dirname(mainPath), dest)); } catch (e) { /* ignore */ }
            }
            console.log('[KRE Installer] アンインストールが完了しました。');
            return;
        }

        const backupManager = new BackupManager(info.resourcesPath);
        if (!backupManager.hasBackup()) {
            console.error('[KRE Installer] バックアップが見つからないため、アンインストールできません。');
            process.exit(1);
        }
        console.log('[KRE Installer] バックアップをリストア中...');
        if (backupManager.restore(info.asarPath)) console.log('[KRE Installer] アンインストールが完了しました。');
        else process.exit(1);
    }
}

module.exports = Sideloader;
module.exports.patchAppDir = patchAppDir;

if (require.main === module) {
    const [cmd, targetPath] = process.argv.slice(2);
    const sideloader = new Sideloader();

    if (cmd === 'install' || !cmd) sideloader.install(targetPath);
    else if (cmd === 'uninstall') sideloader.uninstall(targetPath);
    else console.error('Usage: node sideloader.js [install|uninstall] [path/to/client]');
}
