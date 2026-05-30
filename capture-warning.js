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

  // タイムスタンプ作成 (ファイル名用)
  const now = new Date();
  const timestamp = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  
  const filename = `warning_${timestamp}.png`;
  const screenshotPath = path.join(screenshotDir, filename);

  // ==========================================
  // 📊 2. 気象データのリアルタイム解析・テキスト作成
  // ==========================================
  console.log("📊 気象データを解析中...");
  
  // code.txt の読み込みとランク判定
  const codeMap = {};
  try {
    const codePath = path.join(__dirname, 'assets/warning/code.txt');
    const text = fs.readFileSync(codePath, 'utf8');
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line) return;
      
      const match = line.match(/^([^:]+):([^\[]+)\[#([^\]]+)\]/);
      if (match) {
        const code = match[1].trim();
        const name = match[2].trim();
        
        let rank = 0;
        if (name.includes('特別警報') || name.includes('レベル5')) rank = 5;
        else if (name.includes('危険') || name.includes('レベル4')) rank = 4;
        else if (name.includes('警報') || name.includes('レベル3')) rank = 3;
        else if (name.includes('注意報') || name.includes('レベル2')) rank = 2;
        
        codeMap[code] = { name, rank };
      }
    });
  } catch (e) {
    console.error("❌ code.txt の読み込みに失敗しました:", e);
    return;
  }

  // list.txt の読み込み
  let jsonPaths = [];
  try {
    const listPath = path.join(__dirname, 'assets/warning/list.txt');
    const text = fs.readFileSync(listPath, 'utf8');
    jsonPaths = text.split('\n').map(p => p.trim()).filter(p => p.length > 0);
  } catch (e) {
    console.error("❌ list.txt の読み込みに失敗しました:", e);
    return;
  }

  // ランクごとの地域別発表情報格納用
  const rankData = { 5: {}, 4: {}, 3: {}, 2: {} };

  // 各JSONデータの取得とパース
  for (const jsonPath of jsonPaths) {
    try {
      let provData;
      if (jsonPath.startsWith('http')) {
        const response = await fetch(`${jsonPath}?_=${Date.now()}`);
        provData = await response.json();
      } else {
        // ローカルパスまたは気象庁URLの自動判定
        let localPath = path.join(__dirname, jsonPath);
        if (!fs.existsSync(localPath)) {
          localPath = path.join(__dirname, 'assets', 'warning', jsonPath);
        }
        
        if (fs.existsSync(localPath)) {
          provData = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } else {
          const url = `https://www.jma.go.jp/bosai/warning/data/warning/${jsonPath}`;
          const response = await fetch(`${url}?_=${Date.now()}`);
          provData = await response.json();
        }
      }

      const reports = Array.isArray(provData) ? provData : [provData];
      
      reports.forEach(report => {
        if (!report || !report.areaTypes) return;
        
        report.areaTypes.forEach(type => {
          if (!type.areas) return;
          
          type.areas.forEach(area => {
            const areaCode = area.code || (area.area && area.area.code);
            const areaName = area.name || (area.area && area.area.name) || areaCode;
            
            if (!areaCode || !area.warnings) return;

            area.warnings.forEach(warn => {
              if (warn.status === "発表" || warn.status === "継続" || warn.status === "切替") {
                const meta = codeMap[warn.code];
                if (meta && rankData[meta.rank]) {
                  if (!rankData[meta.rank][areaName]) {
                    rankData[meta.rank][areaName] = new Set();
                  }
                  rankData[meta.rank][areaName].add(meta.name);
                }
              }
            });
          });
        });
      });
    } catch (e) {
      console.error(`❌ 気象データの解析に失敗しました (${jsonPath}):`, e);
    }
  }

  // 指定フォーマットでテキストを組み立て
  let contentText = `**【現在の警報・注意報】**\n現在発表されている警報・注意報をお伝えします。\n\n`;

  const categories = [
    { rank: 5, label: "特別警報" },
    { rank: 4, label: "危険警報" },
    { rank: 3, label: "警報" },
    { rank: 2, label: "注意報" }
  ];

  categories.forEach(cat => {
    contentText += `＜${cat.label}＞\n`;
    const areas = Object.keys(rankData[cat.rank]);
    
    if (areas.length === 0) {
      contentText += `現在、発表されていません。\n\n`;
    } else {
      areas.forEach(areaName => {
        const warns = Array.from(rankData[cat.rank][areaName]);
        if (warns.length > 0) {
          contentText += `${areaName}：${warns.join('、')}\n`;
        }
      });
      contentText += `\n`;
    }
  });

  contentText = contentText.trim(); // 末尾の余分な改行をカット

  // Discordの文字数制限(2000文字)対策
  if (contentText.length > 2000) {
    contentText = contentText.substring(0, 1950) + "\n...（文字数超過のため省略）";
  }

  // ==========================================
  // 🌐 3. ブラウザ起動・スクリーンショット撮影
  // ==========================================
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
    await page.setViewport({ width: 1920, height: 1080 });

    const htmlPath = path.join(__dirname, 'warning.html');
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`warning.html が見つかりません: ${htmlPath}`);
    }
    const fileUrl = pathToFileURL(htmlPath).href;
    
    console.log(`📄 ページを読み込み中: ${fileUrl}`);
    await page.goto(fileUrl, { waitUntil: 'networkidle2' });

    console.log("⏳ 地図の描画待機中 (3秒)...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`📸 スクリーンショットを保存しました: ${screenshotPath}`);

    await browser.close();

    // ==========================================
    // 🚀 4. Discord Webhook 送信 (メッセージ＋画像)
    // ==========================================
    console.log("🚀 Discordへメッセージと画像を送信中...");
    const imageBuffer = fs.readFileSync(screenshotPath);
    
    const formData = new FormData();
    const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
    formData.append('files[0]', imageBlob, filename);

    // 生成した見やすいテキストを content に指定
    const payload = {
      username: "そらしる警報注意報",
      content: contentText
    };
    formData.append('payload_json', JSON.stringify(payload));

    const res = await fetch(webhookUrl, {
      method: 'POST',
      body: formData
    });

    if (res.ok) {
      console.log("✅ Discordへの通知が正常に完了しました！
