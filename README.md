# KRE-KrunkerReplay

Krunker.io の3Dリプレイを記録し、ブラウザ上で後から自由に視点を動かして観戦できるツールです。
公式クライアントの通信やTHREE.jsのシーンを傍受し、独自の `.kre` フォーマットや `.json` としてローカルに保存します。

## 主な機能
- **録画**: Userscript が試合(マップ読み込み)を検知して自動で録画を開始し、ゲームの接続が切れたら保存します。`F7` で手動開始/停止もできます。
- **フル3Dリプレイ**: 自由視点カメラや各プレイヤーの3人称/1人称視点に切り替えての観戦が可能。
- **弾道の可視化 (Tracer)**: 誰がどこに撃ったかの軌道を3D空間上に正確に描画します。
- **キルログ・スコアボード**: 実際の試合中の情報に基づいたリアルタイムのUI表示。
- **ミニマップ**: 上空からのミニマップ描画機能。

## フォルダ構成
- `installer/` : Electron クライアント (Glorp など) に録画機能を組み込むインストーラと診断ツール
- `recorder/` : 録画モジュール。Userscript、Electron メインプロセス用フック、preload、保存サーバー、`.kre` ライター
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
3. krunker.io で試合に入ると自動で録画が始まり、試合を抜けて接続が切れると保存されます（200パケット未満の短い録画は破棄）。`F7` で手動の開始/停止、`F9` で自動録画のON/OFF、`F8` でデバッグ表示。
4. リプレイは `ドキュメント/KrunkerReplays/` に `.json` として保存されます。Viewer で開いてください。

## 使い方 (Glorp: WebView2 版)
最近の Glorp は Electron ではなく WebView2 (`glorp.exe` + `resources/bundle.js`) で動くため、下の「Electron クライアントへの組み込み」は使えません。
代わりに Glorp のスクリプトフォルダ (`ドキュメント\glorp\scripts`) に Userscript を置きます。

1. `START_SAVE_SERVER.bat` を起動したままにする
2. `recorder/kre-userscript.user.js` を `ドキュメント\glorp\scripts` にコピーする
3. Glorp を再起動し、試合に入って画面左上に録画ステータスが出るか確認する

## 使い方 (Electron クライアントへの組み込み)
Electron ベースのクライアント (`resources/app.asar` を持つもの) では、クライアントに録画モジュールを組み込めます。
Userscript と同じ録画スクリプトをゲームページに注入し、保存はクライアント内で直接行うので、保存サーバーは不要です。

```bash
npm install

# 1. 構造の診断 (ファイルは変更しない。kre-inspect-report.json を出力)
node installer/src/inspect-client.js "C:\Users\<you>\AppData\Local\glorp"

# 2. 組み込み (パス省略時は自動検出。事前に app.asar をバックアップします)
npm run install:client -- "C:\Users\<you>\AppData\Local\glorp"

# 元に戻す (バックアップから復元)
npm run uninstall:client -- "C:\Users\<you>\AppData\Local\glorp"
```

- 組み込み後にクライアントを再起動すると、試合開始で自動録画し、試合を抜けると `ドキュメント/KrunkerReplays/` に保存されます（画面左上に録画ステータスを表示）。
- クライアントの更新で `app.asar` が置き換わると組み込みは消えます。再度インストールしてください。
- asar 整合性検証 (Electron Fuse) が有効なクライアントは、起動できなくなるため組み込みを中止します。
- うまくいかない場合は `kre-inspect-report.json` の内容を共有してください。

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
