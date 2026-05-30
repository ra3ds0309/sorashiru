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

  // タイムスタンプ作成
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
  // 🗺️ 【新規】気象庁公式のエリアマスターデータを取得
  // ==========================================
  console.log("🗺️ エリアマスターデータを取得中...");
  let areaMaster = {};
  try {
    const areaRes = await fetch("https://www.jma.go.jp/bosai/common/const/area.json");
    areaMaster = await areaRes.json();
  } catch (e) {
    console.error("⚠️ エリアマスターの取得に失敗しました。地域名はコードのまま表示されます:", e);
  }

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

  const rankData = { 5: {}, 4: {}, 3: {}, 2: {} };

  // 各JSONデータの取得とパース
  for (const jsonPath of jsonPaths) {
    try {
      let provData;
      if (jsonPath.startsWith('http')) {
        const response = await fetch(`${jsonPath}?_=${Date.now()}`);
        provData = await response.json();
      } else {
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
        if (!report || !report.areaTypes || report.areaTypes.length === 0) return;
        
        // ★ 修正：市町村(areaTypes[1])は無視し、一次細分区域(areaTypes[0])のみを対象にする
        const primaryAreaType = report.areaTypes[0];
        if (!primaryAreaType || !primaryAreaType.areas) return;
        
        primaryAreaType.areas.forEach(area => {
          const areaCode = area.code || (area.area && area.area.code);
          if (!areaCode || !area.warnings) return;

          // ★ 【新規】エリアマスターから「静岡県」＋「中部」のような日本語名を自動生成
          let areaName = areaCode;
          if (areaMaster.class10s && areaMaster.class10s[areaCode]) {
            const class10 = areaMaster.class10s[areaCode];
            const parentCode = class10.parent; // 親（府県予報区コード、例: 220000）
            const parentName = (areaMaster.offices && areaMaster.offices[parentCode]) ? areaMaster.offices[parentCode].name : "";
            areaName = parentName + class10.name; // 例: 「静岡県」＋「中部」＝「静岡県中部」
          }

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

  contentText = contentText.trim();

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
    // 🚀 4. Discord Webhook 送信
    // ==========================================
    console.log("🚀 Discordへメッセージと画像を送信中...");
    const imageBuffer = fs.readFileSync(screenshotPath);
    
    const formData = new FormData();
    const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
    formData.append('files[0]', imageBlob, filename);

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
      console.log("✅ Discordへの通知が正常に完了しました！");
    } else {
      console.error(`❌ Discordへの送信に失敗しました: ${res.status} ${res.statusText}`);
    }

  } catch (error) {
    console.error("❌ 処理中にエラーが発生しました:", error);
    if (browser) await browser.close();
  }
}

captureAndNotify();
