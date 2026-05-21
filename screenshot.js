const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 1. 簡易的な静的ファイルサーバーを立ち上げる（ローカルのindex.htmlやassetsを読み込むため）
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  
  // URLパラメータ（?t=...）をカット
  filePath = filePath.split('?')[0];

  const extname = path.extname(filePath);
  let contentType = 'text/html';
  if (extname === '.js') contentType = 'text/javascript';
  if (extname === '.css') contentType = 'text/css';
  if (extname === '.png') contentType = 'image/png';
  if (extname === '.jpg' || extname === '.jpeg') contentType = 'image/jpeg';
  if (extname === '.svg') contentType = 'image/svg+xml';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end('File not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(8080, async () => {
  console.log('Local server started at http://localhost:8080');

  // 2. Puppeteerでブラウザを起動してスクショ撮影
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // 画面サイズを1920x1080に固定
    await page.setViewport({ width: 1920, height: 1080 });

    // ページを開き、気象庁データの非同期通信(Web API)が完了するまで十分に待つ
    await page.goto('http://localhost:8080', { waitUntil: 'networkidle0' });
    
    // 念のためデータ描写の安全マージンとしてさらに3秒待機
    await new Promise(resolve => setTimeout(resolve, 3000));

    // スクショを保存
    await page.screenshot({ path: 'weather_live.png' });
    console.log('Screenshot successfully saved as weather_live.png');

    await browser.close();
  } catch (err) {
    console.error('Puppeteer error:', err);
  } finally {
    server.close();
  }
});
