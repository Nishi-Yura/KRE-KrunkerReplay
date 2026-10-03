#!/usr/bin/env node
/**
 * inspect-client.js
 * Electron クライアント (Glorp など) の構造を調べて kre-inspect-report.json に書き出す診断ツール。
 * ファイルは一切変更しない。インストール前・不具合調査用。
 *
 *   node installer/src/inspect-client.js [クライアントのインストールディレクトリ]
 *   例: node installer/src/inspect-client.js "C:\Users\<you>\AppData\Local\glorp"
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { findKrunkerPath, describeInstall, explainMissing } = require('./krunker-finder');

// Electron Fuses (electron/fuses) のセンチネルと並び順
const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
const FUSE_NAMES = [
    'RunAsNode',
    'EnableCookieEncryption',
    'EnableNodeOptionsEnvironmentVariable',
    'EnableNodeCliInspectArguments',
    'EnableEmbeddedAsarIntegrityValidation',
    'OnlyLoadAppFromAsar',
    'LoadBrowserProcessSpecificV8Snapshot',
    'GrantFileProtocolExtraPrivileges'
];

function readFuses(exePath) {
    try {
        const buf = fs.readFileSync(exePath);
        const idx = buf.indexOf(FUSE_SENTINEL);
        if (idx < 0) return { found: false };
        const base = idx + FUSE_SENTINEL.length;
        const version = buf[base];
        const length = buf[base + 1];
        const fuses = {};
        for (let i = 0; i < length; i++) {
            const state = buf[base + 2 + i];
            // '1' = 有効, '0' = 無効, 'r' = 削除済み
            fuses[FUSE_NAMES[i] || `fuse${i}`] = state === 0x31 ? 'enabled' : state === 0x30 ? 'disabled' : 'removed';
        }
        return { found: true, version, fuses };
    } catch (e) {
        return { found: false, error: e.message };
    }
}

function listDir(dir, max = 60) {
    try {
        return fs.readdirSync(dir).slice(0, max).map(f => {
            const st = fs.statSync(path.join(dir, f));
            return st.isDirectory() ? f + '/' : `${f} (${st.size})`;
        });
    } catch (e) { return [`<error: ${e.message}>`]; }
}

function inspect(info) {
    const report = {
        generatedAt: new Date().toISOString(),
        installDir: info.installDir,
        exe: path.basename(info.exePath),
        kind: info.kind,
        installDirFiles: listDir(info.installDir),
        resourcesFiles: listDir(info.resourcesPath),
        fuses: readFuses(info.exePath)
    };

    let files = [];
    let pkg = null;
    if (info.kind === 'asar') {
        const asar = require('@electron/asar');
        files = asar.listPackage(info.asarPath).map(f => f.replace(/\\/g, '/'));
        try { pkg = JSON.parse(asar.extractFile(info.asarPath, 'package.json').toString('utf8')); } catch (e) { report.packageJsonError = e.message; }
        report.asarSize = fs.statSync(info.asarPath).size;
        report.unpackedDirExists = fs.existsSync(info.asarPath + '.unpacked');
        try {
            const header = asar.getRawHeader(info.asarPath).header;
            const unpacked = [];
            (function walk(node, p) {
                if (node.files) Object.entries(node.files).forEach(([k, v]) => walk(v, p + '/' + k));
                else if (node.unpacked) unpacked.push(p);
            })(header, '');
            report.unpackedFiles = unpacked.slice(0, 40);
        } catch (e) { /* 古い @electron/asar */ }
    } else {
        pkg = JSON.parse(fs.readFileSync(path.join(info.appDir, 'package.json'), 'utf8'));
        (function walk(dir, rel, depth) {
            if (depth > 3) return;
            for (const f of fs.readdirSync(dir)) {
                if (f === 'node_modules') continue;
                const full = path.join(dir, f);
                const r = rel ? rel + '/' + f : f;
                if (fs.statSync(full).isDirectory()) walk(full, r, depth + 1); else files.push(r);
            }
        })(info.appDir, '', 0);
    }

    if (pkg) {
        report.package = {
            name: pkg.name, version: pkg.version, main: pkg.main, type: pkg.type || 'commonjs',
            electronDependency: (pkg.dependencies || {}).electron || (pkg.devDependencies || {}).electron
        };
    }
    const topLevel = files.filter(f => !f.includes('node_modules/')).slice(0, 200);
    report.appFiles = topLevel;
    report.preloadCandidates = files.filter(f => /preload/i.test(f) && !f.includes('node_modules/'));
    report.userscriptCandidates = files.filter(f => /(userscript|swapper|script)/i.test(f) && !f.includes('node_modules/')).slice(0, 40);
    report.hasKreHook = files.some(f => f.endsWith('kre-main-hook.js'));
    return report;
}

function main() {
    const target = process.argv[2];
    const info = target ? describeInstall(target) : findKrunkerPath();
    if (!info) {
        console.error('Electron クライアント (resources/app.asar と .exe) として認識できませんでした。');
        if (target) {
            console.error(`指定ディレクトリの中身:\n${explainMissing(target)}`);
            console.error('\n上の一覧を共有してください。resources フォルダを含む階層を指定し直すと認識できる場合もあります。');
        } else {
            console.error('インストール先ディレクトリを引数で指定してください。');
            console.error('例: node installer/src/inspect-client.js "C:\\Users\\<you>\\AppData\\Local\\glorp"');
        }
        process.exit(1);
    }
    const report = inspect(info);
    const out = path.join(process.cwd(), 'kre-inspect-report.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');

    console.log(`[KRE Inspect] ${info.installDir} (${info.kind})`);
    console.log(`  main        : ${report.package && report.package.main}`);
    console.log(`  version     : ${report.package && report.package.version}`);
    console.log(`  module type : ${report.package && report.package.type}`);
    console.log(`  asar整合性検証 : ${report.fuses.found ? report.fuses.fuses.EnableEmbeddedAsarIntegrityValidation : '(Fuse情報なし)'}`);
    console.log(`  preload候補  : ${report.preloadCandidates.length ? report.preloadCandidates.join(', ') : '(なし)'}`);
    console.log(`  KRE導入済み  : ${report.hasKreHook}`);
    console.log(`詳細レポート: ${out}`);
}

if (require.main === module) main();
module.exports = { inspect, readFuses };
