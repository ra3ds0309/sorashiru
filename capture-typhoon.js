const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

(async () => {
  const dirPath = path.join(__dirname, 'typhoon-screenshots');
  
  // 1. 保存先フォルダがなければ作成
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  console.log('ブラウザを起動中...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // 天気予報と同じ1920x1080のサイズに設定
  await page.setViewport({ width: 1920, height: 1080 });

  // 2. ローカルの typhoon.html を開く
  const filePath = path.resolve(__dirname, 'typhoon.html');
  console.log(`ファイルを開いています: ${filePath}`);
  await page.goto(`file://${filePath}`, { waitUntil: 'networkidle0' });

  // 地図のタイルやJMAからのデータ取得・描画を完全に待つため5秒待機
  console.log('データの読み込みと地図の描画を待っています(5秒)...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // ファイル名に日付を付ける（例: typhoon_20260529-1530.png）
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // JST time
  const jstDate = new Date(now.getTime() + jstOffset);
  const timestamp = jstDate.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '').substring(0, 13);
  
  const filename = `typhoon_${timestamp}.png`;
  const screenshotPath = path.join(dirPath, filename);

  // 3. スクリーンショットを撮影
  await page.screenshot({ path: screenshotPath });
  console.log(`スクリーンショットを保存しました: ${screenshotPath}`);

  await browser.close();

  // 4. Discordへの送信処理
  const webhookUrl = process.env.TYPHOON_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('エラー: Webhook URL (TYPHOON_WEBHOOK_URL) が環境変数に設定されていません。');
    process.exit(1);
  }

  console.log('Discordに画像を送信中...');
  try {
    const fileBuffer = fs.readFileSync(screenshotPath);
    const blob = new Blob([fileBuffer], { type: 'image/png' });

    // FormData を作成（Node.js標準機能）
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('payload_json', JSON.stringify({
      content: '🌀 **台風情報が更新されました。**'
    }));

    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      console.log('Discordへの通知に成功しました！');
    } else {
      console.error(`Discordへの送信に失敗しました。ステータスコード: ${response.status}`);
    }
  } catch (error) {
    console.error('Discord送信中にエラーが発生しました:', error);
  }
})();
