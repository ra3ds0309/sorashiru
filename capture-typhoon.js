const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TYPHOON_LIST_URL = "https://www.jma.go.jp/bosai/information/data/typhoon.json";
const TYPHOON_DETAIL_BASE = "https://www.jma.go.jp/bosai/typhoon/data/";

// 🤖 Gemini APIを使って台風の概要解説を生成する関数
async function generateGeminiExplanation(typhoonList, specifications) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('警告: GEMINI_API_KEY が設定されていないため、AI解説をスキップします。');
    return '（AI解説を取得できませんでした）';
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  // 💡 【エラー対策】過去の不要な履歴データを省き、最新の「実況」と「予報」だけに絞り込んでデータサイズを劇的に削減
  const minimizedSpecs = specifications.filter((block, index) => {
    if (index === 0) return true; // タイトルブロックは残す
    const partName = block.part?.jp || block.part;
    return partName === "実況" || partName === "予報";
  });

  // 💡 プロンプトをシンプルに改良。「台風○号は〜」などの前置きや主語を省く指示をダイレクトに伝えています。
  const prompt = `以下の台風データをもとに、現在の状況と今後の進路予想について、一般向けに分かりやすく3行程度の短い文章で要約を作成してください。
「台風○号は」などの主語や前置きは一切省き、具体的な現在の位置や状況（例：「現在、〇〇の南にあって…」など）から直接書き始めてください。解説文のみを出力し、Markdownの太字(**)や挨拶は含めないでください。

【台風データ】
${JSON.stringify({ summary: typhoonList, details: minimizedSpecs })}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text.trim();
  } catch (error) {
    console.error('Gemini APIの呼び出し中にエラーが発生しました:', error);
    return '（AI解説の生成中にエラーが発生しました）';
  }
}

(async () => {
  let typhoonList;
  let specifications;

  // 🌀 1. 台風情報の発表状況を確認してデータを取得
  try {
    console.log('台風情報の発表状況を確認中...');
    const listResponse = await fetch(`${TYPHOON_LIST_URL}?t=${Date.now()}`);
    typhoonList = await listResponse.json();

    if (!typhoonList || typhoonList.length === 0 || !typhoonList[0].eventId) {
      console.log('現在、発表中の台風情報はありません。投稿・保存をスキップして終了します。');
      process.exit(0); 
    }

    const eventId = typhoonList[0].eventId;
    console.log(`台風情報を検出しました（イベントID: ${eventId}）。詳細データを取得します...`);

    const detailUrl = `${TYPHOON_DETAIL_BASE}${eventId}/specifications.json?t=${Date.now()}`;
    const detailResponse = await fetch(detailUrl);
    specifications = await detailResponse.json();

  } catch (error) {
    console.error('データ取得中にエラーが発生しました:', error);
    process.exit(1);
  }

  // 🤖 2. Gemini API から簡単な解説を生成
  console.log('Gemini APIによる概要解説を生成中...');
  const geminiExplanation = await generateGeminiExplanation(typhoonList, specifications);

  // ✍️ 3. Discord投稿用のタイトル構文を組み立て
  const titleBlock = specifications[0];
  let rawNumber = titleBlock.typhoonNumber ? String(titleBlock.typhoonNumber) : "--";
  if (rawNumber.length === 4) {
    rawNumber = parseInt(rawNumber.substring(2, 4), 10); 
  }

  let announceTimeStr = "---";
  if (titleBlock.issue && titleBlock.issue.JST) {
    const issueDate = new Date(titleBlock.issue.JST);
    
    const jstFormatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      day: 'numeric',
      hour: 'numeric',
      hour12: false
    });
    const parts = jstFormatter.formatToParts(issueDate);
    const day = parts.find(p => p.type === 'day').value;
    const hours = parts.find(p => p.type === 'hour').value;
    
    announceTimeStr = `${day}日${hours}時`;
  }

  // 💡 タイトルブロックを ** で囲み、Discord上で確実に太字になるよう変更
  const discordMessage = `**【台風${rawNumber}号 進路予想】** ${announceTimeStr} 気象庁発表\n${geminiExplanation}`;

  // 📸 4. スクショ撮影処理
  const dirPath = path.join(__dirname, 'typhoon-screenshots');
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  console.log('ブラウザを起動中...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const filePath = path.resolve(__dirname, 'typhoon.html');
  await page.goto(`file://${filePath}`, { waitUntil: 'networkidle0' });

  console.log('地図の描画を待っています(5秒)...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 💡 【UTC対策】実行環境（ローカル/サーバー）を問わず、100%確実に「日本時間（JST）」でファイル名を作るロジックに修正
  const now = new Date();
  const fileDateFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const fParts = fileDateFormatter.formatToParts(now);
  const year = fParts.find(p => p.type === 'year').value;
  const month = fParts.find(p => p.type === 'month').value;
  const dayStr = fParts.find(p => p.type === 'day').value;
  const hourStr = fParts.find(p => p.type === 'hour').value;
  const minStr = fParts.find(p => p.type === 'minute').value;
  
  const timestamp = `${year}-${month}-${dayStr}_${hourStr}${minStr}`;
  const filename = `typhoon_${timestamp}.png`;
  const screenshotPath = path.join(dirPath, filename);

  await page.screenshot({ path: screenshotPath });
  console.log(`スクリーンショットを保存しました: ${screenshotPath}`);
  await browser.close();

  // 🚀 5. Discordへの送信処理
  const webhookUrl = process.env.TYPHOON_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('エラー: Webhook URL が環境変数に設定されていません。');
    process.exit(1);
  }

  console.log('Discordに画像とAI解説を送信中...');
  try {
    const fileBuffer = fs.readFileSync(screenshotPath);
    const blob = new Blob([fileBuffer], { type: 'image/png' });

    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('payload_json', JSON.stringify({
      content: discordMessage
    }));

    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      console.log('Discordへの通知に成功しました！');
    } else {
      console.error(`Discordへの送信に失敗しました。ステータス: ${response.status}`);
    }
  } catch (error) {
    console.error('Discord送信中にエラーが発生しました:', error);
  }
})();
