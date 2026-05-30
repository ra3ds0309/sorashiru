const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function captureAndNotify() {
  const webhookUrl = process.env.WARNING_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("❌ エラー: 環境変数 WARNING_WEBHOOK_URL が設定されていません。");
    return;
  }

  // 1. スクリーンショット保存用フォルダの作成
  const screenshotDir = path.join(__dirname, 'warning-screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  // タイムスタンプ作成 (ファイル名用: YYYYMMDD_HHMMSS)
  const now = new Date();
  const timestamp = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  
  const filename = `warning_${timestamp}.png`;
  const screenshotPath = path.join(screenshotDir, filename);

  console.log("🌐 ブラウザを起動中...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--allow-file-access-from-files'
    ]
  });

  try {
    const page = await browser.newPage();
    // 画面サイズを 16:9 (1920x1080) に固定
    await page.setViewport({ width: 1920, height: 1080 });

    // 2. warning.html を絶対パスのファイルURLに変換して読み込み
    const htmlPath = path.join(__dirname, 'warning.html');
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`warning.html が見つかりません: ${htmlPath}`);
    }
    const fileUrl = pathToFileURL(htmlPath).href;
    
    console.log(`📄 ページを読み込み中: ${fileUrl}`);
    await page.goto(fileUrl, { waitUntil: 'networkidle2' });

    // データの反映を待つ（3秒）
    console.log("⏳ データの反映を待っています (3秒)...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // スクリーンショットを撮影してフォルダに保存
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`📸 スクリーンショットを保存しました: ${screenshotPath}`);

    await browser.close();

    // 3. Discordへ画像付きでWebhook送信 (埋め込みなし・通常メッセージ形式)
    console.log("🚀 Discordへメッセージと画像を送信中...");
    const imageBuffer = fs.readFileSync(screenshotPath);
    
    // FormDataの組み立て
    const formData = new FormData();
    const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
    formData.append('files[0]', imageBlob, filename);

    // ★埋め込み(embeds)を廃止し、通常のメッセージ(content)として送信
    const payload = {
      username: "そらしる警報注意報",
      content: `⚠️ **【気象警報・注意報】現在の地図状況**`
    };
    formData.append('payload_json', JSON.stringify(payload));

    // Webhookの実行
    const res = await fetch(webhookUrl, {
      method: 'POST',
      body: formData // Content-Typeは自動設定されます
    });

    if (res.ok) {
      console.log("✅ Discordへの通常メッセージ通知が正常に完了しました！");
    } else {
      console.error(`❌ Discordへの送信に失敗しました: ${res.status} ${res.statusText}`);
    }

  } catch (error) {
    console.error("❌ 処理中にエラーが発生しました:", error);
    if (browser) await browser.close();
  }
}

captureAndNotify();
