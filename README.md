# KRE-KrunkerReplay

Krunker.io の3Dリプレイを記録し、ブラウザ上で後から自由に視点を動かして観戦できるツールです。
公式クライアントの通信やTHREE.jsのシーンを傍受し、独自の `.kre` フォーマットや `.json` としてローカルに保存します。

## 主な機能
- **録画**: Userscript で `F7` を押して録画開始/停止（手動）。Electron 組み込み版の自動録画は実験的です。
- **フル3Dリプレイ**: 自由視点カメラや各プレイヤーの3人称/1人称視点に切り替えての観戦が可能。
- **弾道の可視化 (Tracer)**: 誰がどこに撃ったかの軌道を3D空間上に正確に描画します。
- **キルログ・スコアボード**: 実際の試合中の情報に基づいたリアルタイムのUI表示。
- **ミニマップ**: 上空からのミニマップ描画機能。

## フォルダ構成
- `installer/` : Krunker公式クライアントに録画機能を組み込むためのインストーラ (Electron asar書き換えツール)
- `recorder/` : バックグラウンドで動作し、Krunker内の座標やイベントを収集・保存する記録モジュール
- `viewer/` : 記録されたリプレイファイル（JSON）を読み込み、THREE.jsを使ってブラウザ上で再生するビューアー
- `shared/` : レコーダーとビューアーで共通の定数や型定義（未使用部分も含む）

## 使い方 (Viewer)
1. リポジトリをダウンロード（またはクローン）します。
2. `viewer/index.html` をブラウザ（Chrome等）で開きます（`npm run viewer` でローカルサーバー起動も可）。
3. 「ファイルを選択」ボタン、またはウィンドウへのドラッグ＆ドロップで、記録済みのリプレイ（`.json` / `.kre`）を読み込みます。マップ(`.json`)や地形(`.obj`)を後から追加で読み込むこともできます。
4. **操作方法:**
   - `F` / `1` / `3`（または上部ボタン）: 自由視点 / 1人称 / 3人称
   - `W A S D`: カメラ移動（自由視点）、`E` / `Q`: 上昇 / 下降、`Shift`: 3倍速
   - ドラッグ: 視点回転（自由視点）、ホイール: 前後移動（自由視点）/ 距離調整（3人称）
   - `Space`: 再生/一時停止、`←` / `→`: 5秒戻る/進む、タイムラインのドラッグでシーク
   - `Tab`: スコアボード
   - 右側のプレイヤーカードをクリックすると、そのプレイヤーの追従視点になります。

## 使い方 (録画: Userscript + 保存サーバー)
実際に動作する録画手順です。

1. Node.js をインストールし、`START_SAVE_SERVER.bat` を実行して保存サーバーを起動します（`node recorder/src/kre-save-server.js` でも可）。起動したままにしてください。
2. ブラウザ拡張 Tampermonkey などに `recorder/kre-userscript.user.js` を登録します。
3. krunker.io で試合に入り、`F7` で録画開始、もう一度 `F7` で停止して保存します（`F8` でデバッグ表示）。
4. リプレイは `ドキュメント/KrunkerReplays/` に `.json` として保存されます。Viewer で開いてください。

## 使い方 (Installer / Recorder: 実験的)
`installer/` は Krunker 公式クライアントの `app.asar` に `recorder/preload/preload-injector.js` を組み込む試験的なツールです。録画ロジック自体は未完成のため、通常は上記の Userscript を使用してください。

```bash
npm install
npm run install:client     # 組み込み
npm run uninstall:client   # バックアップから復元
```

## マップ変換 (GLB)
マップJSONを頂点カラー付きの GLB に変換できます。
```bash
npm run convert:map -- map.json map.glb
npm run convert:map -- -d path/to/maps   # ディレクトリ内の .json を一括変換
```

## 開発・ビルド
ビューアー側のJSを変更した場合は、`esbuild` を使ってバンドルを再構築してください。
```bash
npm install
npx esbuild viewer/js/main.js --bundle --outfile=viewer/dist/bundle.js
```

## ライセンス
This project is open-source and available for everyone in the Krunker community.
