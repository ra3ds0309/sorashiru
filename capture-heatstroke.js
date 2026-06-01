const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  // 1. 保存先フォルダ「heatstroke-screenshots/」の自動作成
  const dir = './heatstroke-screenshots';
  if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
  }

  // ファイル名用に日本時間の「今日の日付」を取得 (例: heatstroke_20260601.png)
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstDate = new Date(now.getTime() + jstOffset);
  const yyyymmdd = jstDate.toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `heatstroke_${yyyymmdd}.png`;
  const screenshotPath = path.join(dir, filename);

  console.log('🌐 ブラウザを起動して画面を読み込んでいます...');
  
  // 2. Puppeteerでブラウザを起動（16:9 サイズ指定）
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // 同時起動しているローカルサーバーのURLを開く
  await page.goto('http://localhost:8080/heatstroke.html', { waitUntil: 'networkidle0' });

  // データの読み込みと地図の色塗りが完全に終わるまで3秒待機
  await new Promise(resolve => setTimeout(resolve, 3000));

  // スクリーンショット撮影
  await page.screenshot({ path: screenshotPath });
  console.log(`📸 スクリーンショットを保存しました: ${screenshotPath}`);

  await browser.close();

  // 3. Discord Webhookへの送信処理
  const webhookUrl = process.env.HEATSTROKE_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('❌ エラー: HEATSTROKE_WEBHOOK_URL が設定されていません。');
    process.exit(1);
  }

  // 💬 Discordに一緒に投稿する文章（ここを自由に変更できます）
  const discordMessage = `☀️ **【そらしる熱中症警戒情報】**\n本日（予測）の熱中症警戒情報のマップをお届けします。各自警戒してください。`;

  console.log('🚀 Discordへ画像と文章を送信中...');

  // フォームデータを作成して画像とテキストを詰め込む
  const formData = new FormData();
  formData.append('content', discordMessage);

  const fileBuffer = fs.readFileSync(screenshotPath);
  const blob = new Blob([fileBuffer], { type: 'image/png' });
  formData.append('file', blob, filename);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      console.log('✅ Discordへの通知が正常に完了しました！');
    } else {
      console.error(`❌ Discord通知失敗: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error('❌ Discord送信中に通信エラーが発生しました:', error);
  }
})();
