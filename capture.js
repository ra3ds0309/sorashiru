const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// 27都市のデータ取得先マッピング
const cityUrlMap = {
  "旭川": "https://www.jma.go.jp/bosai/forecast/data/forecast/012000.json",
  "札幌": "https://www.jma.go.jp/bosai/forecast/data/forecast/016000.json",
  "青森": "https://www.jma.go.jp/bosai/forecast/data/forecast/020000.json",
  "盛岡": "https://www.jma.go.jp/bosai/forecast/data/forecast/030000.json",
  "仙台": "https://www.jma.go.jp/bosai/forecast/data/forecast/040000.json",
  "山形": "https://www.jma.go.jp/bosai/forecast/data/forecast/060000.json",
  "水戸": "https://www.jma.go.jp/bosai/forecast/data/forecast/080000.json",
  "宇都宮": "https://www.jma.go.jp/bosai/forecast/data/forecast/090000.json",
  "東京": "https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json",
  "伊豆諸島": "https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json",
  "小笠原諸島": "https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json",
  "静岡": "https://www.jma.go.jp/bosai/forecast/data/forecast/220000.json",
  "長野": "https://www.jma.go.jp/bosai/forecast/data/forecast/200000.json",
  "金沢": "https://www.jma.go.jp/bosai/forecast/data/forecast/170000.json",
  "名古屋": "https://www.jma.go.jp/bosai/forecast/data/forecast/230000.json",
  "大阪": "https://www.jma.go.jp/bosai/forecast/data/forecast/270000.json",
  "高松": "https://www.jma.go.jp/bosai/forecast/data/forecast/370000.json",
  "高知": "https://www.jma.go.jp/bosai/forecast/data/forecast/390000.json",
  "松江": "https://www.jma.go.jp/bosai/forecast/data/forecast/320000.json",
  "山口": "https://www.jma.go.jp/bosai/forecast/data/forecast/350000.json",
  "福岡": "https://www.jma.go.jp/bosai/forecast/data/forecast/400000.json",
  "熊本": "https://www.jma.go.jp/bosai/forecast/data/forecast/430000.json",
  "鹿児島": "https://www.jma.go.jp/bosai/forecast/data/forecast/460100.json",
  "奄美": "https://www.jma.go.jp/bosai/forecast/data/forecast/460100.json",
  "那覇": "https://www.jma.go.jp/bosai/forecast/data/forecast/471000.json",
  "大東島": "https://www.jma.go.jp/bosai/forecast/data/forecast/472000.json",
  "石垣島": "https://www.jma.go.jp/bosai/forecast/data/forecast/474000.json"
};

(async () => {
  const dir = './screenshots';
  if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
  }

  // 先にバックグラウンドで気象庁のリアルタイムデータをまとめてフェッチ・解析する
  console.log('気象庁のデータを収集しています...');
  const weatherTextList = [];
  
  // 1時間引いた値（5時か17時発表か）をベースに、JSON内の配列インデックス(きょう=0, あす=1)を決める
  const nowTime = new Date(Date.now() + ((new Date().getTimezoneOffset() + 540) * 60 * 1000));
  const isTomorrowTarget = nowTime.getHours() >= 12; // 12時以降の実行（18時など）なら「あす」を対象とする
  const targetIndex = isTomorrowTarget ? 1 : 0;

  for (const [cityName, url] of Object.entries(cityUrlMap)) {
    try {
      const response = await fetch(url);
      const data = await response.json();
      // 気象庁JSONの構造から、該当都市のエリアに一致する天気テキストを抽出
      const timeSeries = data[0].timeSeries[0];
      
      // 基本的に1番目のエリア代表データを取得（伊豆諸島・小笠原・奄美などはインデックスを調整して正確に捕捉）
      let areaIndex = 0;
      if (cityName === "伊豆諸島") areaIndex = 1;
      if (cityName === "小笠原諸島") areaIndex = 2;
      if (cityName === "奄美") areaIndex = 1;

      const weatherText = timeSeries.areas[areaIndex]?.weathers?.[targetIndex] || "不明";
      // 余計な改行やスペースをトリミング
      const cleanWeather = weatherText.replace(/\s+/g, '');
      weatherTextList.push(`${cityName}:${cleanWeather}`);
    } catch (e) {
      weatherTextList.push(`${cityName}:データ取得エラー`);
    }
  }
  const rawDataString = weatherTextList.join(', ');

  console.log('ブラウザを起動中...');
  const browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--lang=ja,ja-JP']
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

  const yyyy = nowTime.getFullYear();
  const mm = String(nowTime.getMonth() + 1).padStart(2, '0');
  const dd = String(nowTime.getDate()).padStart(2, '0');
  const hh = String(nowTime.getHours()).padStart(2, '0');
  const min = String(nowTime.getMinutes()).padStart(2, '0');
  
  const filename = `weather_${yyyy}${mm}${dd}_${hh}${min}`;
  const screenshotPath = path.join(dir, `${filename}.png`);

  console.log(`${filename}.png を撮影中...`);
  await page.screenshot({ path: screenshotPath });
  console.log(`保存完了しました: ${screenshotPath}`);
  
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `filepath=${screenshotPath}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `filename=${filename}.png\n`);
    // ✨【ここが重要】気象庁からパースした純粋な「全27都市のリアルな天気データ」を完璧に渡す
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `raw_data=${rawDataString}\n`);
    console.log('GitHub Actionsへ出力データを正常に引き渡しました。');
  }

  await browser.close();
})();
