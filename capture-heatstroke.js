const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  // 1. 保存先フォルダ「heatstroke-screenshots/」の自動作成
  const dir = './heatstroke-screenshots';
  if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
  }

  // ファイル名用に日本時間の「今日の日付」を取得 (例: heatstroke_20260602.png)
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

  // 3. ローカルの JSON データを読み込んで発表日時と Gemini による概要を取得
  let reportTimeText = '';
  let geminiSummary = '（概要の取得に失敗しました）';
  
  try {
    const dataPath = path.join(__dirname, 'assets/heatstroke/data.json');
    if (fs.existsSync(dataPath)) {
      const rawData = fs.readFileSync(dataPath, 'utf8');
      const resData = JSON.parse(rawData);

      if (resData.status === "success" && resData.data) {
        // 🕒 JSON内のデータから発表日時を「02日11時」のような形式でパース
        if (resData.data.report_wbgt) {
          const reportDate = new Date(resData.data.report_wbgt);
          const formatter = new Intl.DateTimeFormat('ja-JP', {
            timeZone: 'Asia/Tokyo',
            day: '2-digit',
            hour: '2-digit',
            hourCycle: 'h23'
          });
          const parts = formatter.formatToParts(reportDate);
          const day = parts.find(p => p.type === 'day').value;
          const hours = parts.find(p => p.type === 'hour').value;
          reportTimeText = `${day}日${hours}時`;
        }

        // 🤖 Gemini API を使った概要の自動生成
        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (geminiApiKey) {
          console.log('🤖 Gemini API を呼び出して天気予報士風の概要を生成中...');
          
          const todayData = resData.data.today || {};
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
          
          // 気象予報士の役割を与えるプロンプト
          const prompt = `あなたは優秀な気象予報士です。環境省が発表した以下の熱中症予測データ（JSON）を読み込み、今日の熱中症の警戒状況や全体的な傾向を、テレビの天気予報のように分かりやすく親しみやすい言葉で要約した解説文（200文字〜300文字程度）を作成してください。

【注目・解説すべきポイント】
1. 特別警戒アラート（alerts.special_alert）や警戒アラート（alerts.alert）が発表されている地域があれば、必ず具体的な地域名を挙げて強い警戒を呼びかけてください。
2. 暑さ指数（WBGT）が31以上の「危険」レベル（wbgt.over31）の地域があれば、それも合わせて言及してください。
3. アラート等が出ていない地域でも、全体的な暑さの傾向を踏まえた水分補給やエアコンの使用など、具体的な対策をアドバイスしてください。

データ:
${JSON.stringify(todayData, null, 2)}`;

          const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: prompt }]
              }]
            })
          });

          if (response.ok) {
            const geminiJson = await response.json();
            if (geminiJson.candidates && geminiJson.candidates[0]?.content?.parts[0]?.text) {
              geminiSummary = geminiJson.candidates[0].content.parts[0].text.trim();
            }
          } else {
            console.error(`❌ Gemini API エラー: ${response.status} ${response.statusText}`);
          }
        } else {
          console.warn('⚠️ GEMINI_API_KEY が設定されていないため、概要の生成をスキップします。');
        }
      }
    }
  } catch (e) {
    console.error('❌ JSON読み込みまたはGemini通信中にエラーが発生しました:', e);
  }

  // 4. Discord Webhookへの送信処理
  const webhookUrl = process.env.HEATSTROKE_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('❌ エラー: HEATSTROKE_WEBHOOK_URL が設定されていません。');
    process.exit(1);
  }

  // 💬 ご指定のフォーマットでメッセージを組み立て
  const discordMessage = `☀️ **【きょうの熱中症警戒情報】** ${reportTimeText} 環境省発表\n${geminiSummary}`;

  console.log('🚀 Discordへ画像と文章を送信中...');

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
