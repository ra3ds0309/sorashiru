const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TYPHOON_LIST_URL = "https://www.jma.go.jp/bosai/information/data/typhoon.json";

(async () => {
  // 🌀 1. 先に台風情報が発表されているかチェック
  try {
    console.log('台風情報の発表状況を確認中...');
    const listResponse = await fetch(`${TYPHOON_LIST_URL}?t=${Date.now()}`);
    const typhoonList = await listResponse.json();

    // 台風情報がない、またはデータが空の場合はここで安全に終了する
    if (!typhoonList || typhoonList.length === 0 || !typhoonList[0].eventId) {
      console.log('現在、発表中の台風情報はありません。投稿・保存をスキップして終了します。');
      process.exit(0); 
    }
    console.log(`台風情報を検出しました（イベントID: ${typhoonList[0].eventId}）。処理を続行します。`);
  } catch (error) {
    console.error('事前チェック中にエラーが発生しました。念のため処理を続行します:', error);
  }

  const dirPath = path.join(__dirname, 'typhoon-screenshots');
  
  // 保存先フォルダがなければ作成
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

  // 2. ローカルの typhoon.html を開く
  const filePath = path.resolve(__dirname, 'typhoon.html');
  await page.goto(`file://${filePath}`, { waitUntil: 'networkidle0' });

  console.log('データの読み込みと地図の描画を待っています(5秒)...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // ファイル名に日付を付ける（例: typhoon_20260529-1230.png）
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstDate = new Date(now.getTime() + jstOffset);
  const timestamp = jstDate.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '').substring(0, 13);
  
  const filename = `typhoon_${timestamp}.png`;
  const screenshotPath = path.join(dirPath, filename);

  // 3. スクリーンショットを撮影
  await page.screenshot({ path: screenshotPath });
  console.log(`スクリーンショットを保存しました: ${screenshotPath}`);

  await browser.close();

  // 4. Discordへの送信処理
  const webhookUrl = process.env.TYPHOON_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('エラー: Webhook URL が環境変数に設定されていません。');
    process.exit(1);
  }

  console.log('Discordに画像を送信中...');
  try {
    const fileBuffer = fs.readFileSync(screenshotPath);
    const blob = new Blob([fileBuffer], { type: 'image/png' });

    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('payload_json', JSON.stringify({
      content: '🌀 **台風情報が更新されました。**'
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
