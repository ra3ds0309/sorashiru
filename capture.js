const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  // 保存先フォルダの確認（なければ自動作成）
  const dir = './screenshots';
  if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log('ブラウザを起動中...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.browserContexts()[0]?.pages()[0] || await browser.newPage();

  // 画面サイズをぴったり 1920x1080 に固定
  await page.setViewport({ width: 1920, height: 1080 });

  console.log('そらしる天気ページを読み込み中...');
  // Actions内で立ち上がっているローカルサーバーにアクセス
  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle0' });

  // 💡 気象庁のAPI通信（非同期処理）が終わり、ピンが画面に全件パースされるまで念のため3秒待つ
  console.log('データの同期完了を待機中...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 日本時間ベースでファイル名を作成 (例: weather_20260521_1730.png)
  const now = new Date(Date.now() + ((new Date().getTimezoneOffset() + 540) * 60 * 1000));
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  
  const filename = `weather_${yyyy}${mm}${dd}_${hh}${min}.png`;
  const screenshotPath = path.join(dir, filename);

  console.log(`${filename} を撮影中...`);
  await page.screenshot({ path: screenshotPath });

  console.log(`保存完了しました: ${screenshotPath}`);
  await browser.close();
})();
