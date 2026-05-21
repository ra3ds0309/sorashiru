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
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--lang=ja,ja-JP'
    ]
  });

  const page = await browser.browserContexts()[0]?.pages()[0] || await browser.newPage();

  await page.setViewport({ width: 1920, height: 1080 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });

  console.log('公開されている そらしる天気ページ を読み込み中...');
  await page.goto('https://ra3ds0309.github.io/sorashiru/whether.html', { 
    waitUntil: 'networkidle0', 
    timeout: 60000 
  });

  console.log('気象庁データの同期とDOMの完全描写を待機中...');
  try {
    await page.waitForFunction(() => window.weatherDataLoaded === true, { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (e) {
    console.log('⚠️ 描写完了フラグがタイムアウトしました。このままスクショを試みます。');
  }

  // ✨【追加】Geminiに渡すために、ブラウザ内の targetCities の配置と、そこから生成されたデータをテキストとして回収する
  const weatherSummaryRaw = await page.evaluate(async () => {
    if (typeof targetCities === 'undefined') return "データなし";
    
    // 各都市のピンからテキスト（最低・最高気温など）や状況を簡単に配列化
    const results = [];
    const pins = document.querySelectorAll('.city-pin');
    
    targetCities.forEach((city, index) => {
      const pin = pins[index];
      if (pin) {
        const tempText = pin.querySelector('.city-temp')?.innerText?.replace(/\s+/g, '/') || '--/--';
        results.push(`${city.name}: ${tempText}`);
      }
    });
    return results.join(', ');
  });

  // 日本時間ベースでファイル名を作成
  const now = new Date(Date.now() + ((new Date().getTimezoneOffset() + 540) * 60 * 1000));
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  
  const filename = `weather_${yyyy}${mm}${dd}_${hh}${min}`;
  const screenshotPath = path.join(dir, `${filename}.png`);

  console.log(`${filename}.png を撮影中...`);
  await page.screenshot({ path: screenshotPath });

  console.log(`保存完了しました: ${screenshotPath}`);
  
  // GITHUB_OUTPUTへ出力データを書き込み
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `filepath=${screenshotPath}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `filename=${filename}.png\n`);
    // ✨【追加】回収した生データをYAML側のGeminiステップへ引き渡す
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `raw_data=${weatherSummaryRaw}\n`);
    console.log('GitHub Actionsへ出力データを正常に引き渡しました。');
  }

  await browser.close();
})();
