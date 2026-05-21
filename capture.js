const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  const dir = './screenshots';
  if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log('ブラウザを起動中...');
  const browser = await puppeteer.launch({
    headless: true,
    // 💡 ヘッドレス環境でのエラーや言語問題を回避するオプション群
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--lang=ja,ja-JP'
    ]
  });

  const page = await browser.browserContexts()[0]?.pages()[0] || await browser.newPage();

  // 画面サイズをぴったり 1920x1080 に固定
  await page.setViewport({ width: 1920, height: 1080 });

  // 💡 日本語フォントが化けないようにブラウザの言語を日本語に強制設定
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });

  console.log('そらしる天気ページを読み込み中...');
  await page.goto('http://localhost:8080/index.html', { 
    waitUntil: 'networkidle0', // 通信が完全に止まるまで待つ
    timeout: 60000 
  });

  console.log('気象庁データの同期とDOMの完全描写を待機中...');
  // 💡 index.html 側で window.weatherDataLoaded = true になるまでループ待機（最大15秒）
  try {
    await page.waitForFunction(() => window.weatherDataLoaded === true, { timeout: 15000 });
    // フラグが立ってから、画像アセットなどの最終レンダリング安定のためにあと2秒だけ待つ
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (e) {
    console.log('⚠️ 描写完了フラグがタイムアウトしました。このままスクショを試みます。');
  }

  // 日本時間ベースでファイル名を作成
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
