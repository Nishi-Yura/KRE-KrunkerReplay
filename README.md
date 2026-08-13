# KRE-KrunkerReplay

Krunker.io の3Dリプレイを記録し、ブラウザ上で後から自由に視点を動かして観戦できるツールです。
公式クライアントの通信やTHREE.jsのシーンを傍受し、独自の `.kre` フォーマットや `.json` としてローカルに保存します。

## 主な機能
- **自動録画**: マッチが始まると自動的に録画を開始し、終了時に保存します。
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
2. `viewer/index.html` をブラウザ（Chrome等）で開きます。
3. 画面に表示されるファイル選択ボタンから、記録済みのリプレイファイル（`.json` または `.kre`）を選択します。
4. **操作方法:**
   - `クリック`: 視点の切り替え（ローミングモード）
   - `W, A, S, D`: カメラの移動 (ローミング時)
   - `Shift / Space`: カメラの上下移動 (ローミング時)
   - プレイヤー名刺をクリックすると、そのプレイヤーの追従カメラになります。

## 使い方 (Installer / Recorder)
このツールをKrunkerクライアントにインストールして録画するには、以下の手順を実行してください。

1. Node.js がインストールされていることを確認します。
2. `installer` フォルダに移動し、依存関係をインストールします。
   ```bash
   cd installer
   npm install
   ```
3. インストールスクリプトを実行します。
   ```bash
   npm run install-kre
   # または PowerShellで .\scripts\install.ps1 を実行
   ```
4. Krunker公式クライアントを起動すると、自動的に録画モジュールが読み込まれます。
   - 録画されたファイルは `ドキュメント/KrunkerReplays/` フォルダに保存されます。

### アンインストール
録画機能をKrunkerから削除して元に戻したい場合は、以下のコマンドを実行します。
```bash
npm run uninstall-kre
```

## 開発・ビルド
ビューアー側のJSを変更した場合は、`esbuild` を使ってバンドルを再構築してください。
```bash
npx esbuild viewer/js/main.js --bundle --outfile=viewer/dist/bundle.js
```

## ライセンス
This project is open-source and available for everyone in the Krunker community.
