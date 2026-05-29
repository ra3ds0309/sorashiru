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
  
  const prompt = `以下の気象庁の台風情報JSONデータ（全体概要と詳細仕様）を読み込み、現在の台風の状況（位置、現在の勢力など）と今後の進路予想について、一般の人向けに分かりやすく3行程度の短い簡単な概要解説を日本語で作成してください。
解説以外の挨拶、前置き、余計な文、装飾（Markdownの太字 ** など）は一切含めず、解説的本文のみをそのまま出力してください。

【台風データ1（typhoon.json）】
${JSON.stringify(typhoonList)}

【台風データ2（specifications.json）】
${JSON.stringify(specifications)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

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
    rawNumber = parseInt(rawNumber.substring(2, 4), 10); // 例: 2606 -> 6
  }

  let announceTimeStr = "---";
  if (titleBlock.issue && titleBlock.issue.JST) {
    const issueDate = new Date(titleBlock.issue.JST);
    
    // 💡 サーバー（UTC環境）でも確実に日本標準時（JST）で「日」と「時」を取得する修正
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

  // 指定のフォーマットを構成
  const discordMessage = `【台風${rawNumber}号 進路予想】${announceTimeStr} 気象庁発表\n${geminiExplanation}`;

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

  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstDate = new Date(now.getTime() + jstOffset);
  const timestamp = jstDate.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '').substring(0, 13);
  
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
